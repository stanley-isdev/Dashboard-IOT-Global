import { useMemo } from 'react';
import { useParams } from 'react-router';
import { usePlant, useRetryState } from '../api/queries';
import { useConfig } from '../config/AppContext';
import {
  deriveConnection,
  useFreezeDetector,
  useNow,
  useRecovery,
} from '../domain/connectionState';
import { toMeasure } from '../domain/measure';
import { BUCKET_ORDER, bucketToken, siteToken } from '../domain/status';
import { useI18n } from '../i18n/I18nProvider';
import { formatInt } from '../i18n/format';
import { useDisplayZone } from '../state/useDisplayZone';
import { useFilters } from '../state/useFilters';
import { usePublishExport } from '../state/exportStore';
import { plantExportDoc } from '../domain/exportDoc';
import { ConnectionBanner } from '../components/feedback/ConnectionBanner';
import { HardErrorState, LoadingState } from '../components/feedback/HardErrorState';
import { PanelEmpty } from '../components/feedback/PanelEmpty';
import { GrafanaLink } from '../components/common/GrafanaLink';
import { useShellConnection } from '../components/layout/AppShell';
import { KpiCard } from '../components/kpi/KpiCard';
import { HourlyOutputTable } from '../components/machines/HourlyOutputTable';
import { MachineGrid } from '../components/machines/MachineGrid';
import { ShiftChip } from '../components/primitives/ShiftChip';
import { StatusGlyph } from '../components/primitives/StatusGlyph';

export function PlantPage() {
  const { companyCode = '', plantCode = '' } = useParams();
  const { t, lang } = useI18n();
  const cfg = useConfig();
  const displayZone = useDisplayZone();
  const [filters, setFilters] = useFilters();

  const query = usePlant(companyCode, plantCode, {
    range: filters.range,
    process: filters.process,
    shift: 'current',
  });
  const { data, isError, isPending, error, refetch } = query;

  const now = useNow();
  const frozen = useFreezeDetector(data?.meta.generated_at);
  const connection = deriveConnection(
    { envelope: data?.meta, freshness: data?.freshness, isError, isPending, error, nowMs: now },
    frozen,
  );
  useShellConnection(connection);

  /* What the board is doing about a failure, for the error page to say out loud.
     Read unconditionally because it is a hook; only the error branch uses it. */
  const retry = useRetryState(query);

  /* The outage that just ended, if one did. Reports the gap it left in the
     trend; takes itself off after eight seconds. */
  const recovery = useRecovery(connection.state, now);

  /* The Export button in the filter row photographs whichever board is on screen -
     here, the machine-level list - and this names the file it writes. Memoised
     on the payload for the reason the store gives: the value is what the
     publish effect keys on. */
  const exportDoc = useMemo(() => (data ? plantExportDoc(data) : null), [data]);
  usePublishExport(exportDoc);

  if (!data && isError) {
    return (
      <HardErrorState
        error={error}
        onRetry={() => void refetch()}
        retry={retry}
        siteCode={plantCode}
      />
    );
  }
  /* The plant code, not its name: the name is in the payload this is waiting
     for, and the code is what the reader typed or tapped to get here. */
  if (!data) return <LoadingState name={plantCode} />;

  const { plant, company } = data;
  const token = siteToken(plant.status);
  const coverage = { reporting: plant.counts.total > 0 ? 1 : 0, total: 1 };
  const int = (v: number) => formatInt(v, lang);

  return (
    <>
      <ConnectionBanner
        info={connection}
        referenceTimezone={cfg.referenceTimezone}
        onRetry={() => void refetch()}
        recovery={recovery}
      />

      {/* Drill-downs are taller than one screen by nature, so this region scrolls
          inside the locked frame rather than the page growing. */}
      <div
        className={`view view--scroll${connection.degraded ? ' is-stale' : ''}`}
        aria-busy={isPending}
      >
        <header className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h2>
              {plant.code} <span className="rank-table__sub">{plant.label}</span>
            </h2>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="chip" style={{ color: token.inkVar }}>
                <StatusGlyph token={token} showLabel />
              </span>
              <ShiftChip
                shift={data.shift}
                timeZone={displayZone(company.timezone)}
                nowMs={now}
                variant="header"
              />
              <GrafanaLink url={plant.grafana_url} />
            </div>
          </div>
        </header>

        {/*
          The full machine census, as an exhaustive partition. Running plus
          Stopped does not equal Total on this shop floor - No Plan, Order End
          and 4M Change are real states - and a strip that hides them is how
          section 16's reconciliation against Grafana fails with nobody able to
          say which category is wrong.
        */}
        <div className="kpis" style={{ gridTemplateColumns: `repeat(${BUCKET_ORDER.length + 1}, 1fr)` }}>
          <KpiCard
            labelKey="kpi.machines"
            measure={toMeasure(plant.counts.total, plant.status)}
            format={int}
            coverage={coverage}
          />
          {BUCKET_ORDER.map((bucket) => {
            const bt = bucketToken(bucket);
            const value = plant.counts[bucket];
            return (
              /* Label, then figure, then caption - the same order KpiCard
                 renders, so a hand-built card and a real one look alike. */
              <div className="kpi" key={bucket}>
                <div className="kpi__head">
                  <div className="kpi__label">
                    <StatusGlyph token={bt} /> {t(bt.labelKey as never)}
                  </div>
                </div>
                <div className="kpi__value" style={{ color: bt.inkVar }}>
                  {int(value)}
                </div>
                <div className="kpi__definition">
                  {machineStatusesIn(bucket, plant.counts.by_status, t)}
                </div>
              </div>
            );
          })}
        </div>

        {data.output ? (
          <section className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="panel-head">
              <h2>{data.output.shift_label}</h2>
              <span className="sub">{data.output.buckets.length} buckets</span>
            </div>
            <HourlyOutputTable output={data.output} />
          </section>
        ) : null}

        <section className="panel">
          <div className="panel-head">
            <h2>{t('table.plant')}</h2>
            <span className="sub">{int(data.machines.length)}</span>
          </div>
          {/*
           * Two causes, two answers - and the decision lives here rather than
           * in MachineGrid because the filters do.
           *
           * An empty machine list means either that Process excluded every
           * machine this plant runs, or that the plant has none reporting.
           * MachineGrid printed "No telemetry yet" for both, which over a plant
           * that is reporting perfectly - because somebody left a process
           * picked - sends an engineer to check a gateway that is fine.
           *
           * Process and nothing else, and that is checked rather than assumed:
           * PlantQuery in DashboardApi.ts carries `range`, `process` and
           * `shift`, so those are the only parameters that reach this payload.
           * Region and Lamp are both in the filter row above and neither is
           * sent here, so naming either in this message would send the reader
           * to clear a control that is not the cause. THS 6332 runs Injection
           * and Surface, so asking it for Assembly is the way in.
           */}
          {data.machines.length === 0 && filters.process !== 'all' ? (
            <PanelEmpty
              message={t('empty.panel.machines', { process: filters.process })}
              action={{
                label: t('empty.panel.clearProcess'),
                onClick: () => setFilters({ process: 'all' }),
              }}
            />
          ) : data.machines.length === 0 ? (
            <PanelEmpty glyph="database" message={t('site.neverConnected')} />
          ) : (
            <MachineGrid machines={data.machines} />
          )}
        </section>
      </div>
    </>
  );
}

/** Composition line under each bucket tile, e.g. "Mass Pro 20 · Dandori 2". */
function machineStatusesIn(
  bucket: string,
  byStatus: Record<string, number>,
  t: (key: never) => string,
): string {
  const members: Record<string, string[]> = {
    running: ['Mass Pro', 'Dandori'],
    stopped: ['Stop'],
    idle: ['No Plan', 'Order End'],
    other: ['4M Change'],
    no_data: ['Offline'],
  };
  void t;
  return (members[bucket] ?? [])
    .filter((s) => (byStatus[s] ?? 0) > 0)
    .map((s) => `${s} ${byStatus[s]}`)
    .join(' · ');
}
