import { useParams } from 'react-router';
import { usePlant } from '../api/queries';
import { useConfig } from '../config/AppContext';
import { deriveConnection, useFreezeDetector, useNow } from '../domain/connectionState';
import { toMeasure } from '../domain/measure';
import { BUCKET_ORDER, bucketToken, siteToken } from '../domain/status';
import { useI18n } from '../i18n/I18nProvider';
import { formatInt } from '../i18n/format';
import { useFilters } from '../state/useFilters';
import { ConnectionBanner } from '../components/feedback/ConnectionBanner';
import { HardErrorState } from '../components/feedback/HardErrorState';
import { GrafanaLink } from '../components/common/GrafanaLink';
import { Breadcrumb } from '../components/layout/Breadcrumb';
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
  const [filters] = useFilters();

  const query = usePlant(companyCode, plantCode, {
    range: filters.range,
    process: filters.process,
    shift: 'current',
  });
  const { data, isError, isPending, error, refetch } = query;

  const now = useNow();
  const frozen = useFreezeDetector(data?.meta.generated_at);
  const connection = deriveConnection(
    { envelope: data?.meta, freshness: data?.freshness, isError, isPending, nowMs: now },
    frozen,
  );
  useShellConnection(connection, null);

  if (!data && isError) return <HardErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="skeleton" style={{ height: '24rem' }} />;

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
      />

      <Breadcrumb
        trail={[
          { label: t('nav.overview'), to: '/overview' },
          { label: company.code, to: `/company/${company.code}` },
          { label: `${plant.code} ${plant.label}` },
        ]}
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
              <ShiftChip shift={data.shift} timezone={company.timezone} nowMs={now} variant="header" />
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
          <MachineGrid machines={data.machines} />
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
