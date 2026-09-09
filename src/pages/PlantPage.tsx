import { useMemo } from 'react';
import { useParams } from 'react-router';
import { usePlant, useRetryState } from '../api/queries';
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

/**
 * One plant, drilled into from a base.
 *
 * ## Laid out as the base page is, which is laid out as the board is
 *
 * The same three blocks in the same three places: an unboxed heading with a
 * hairline under it, a KPI strip, then one deck card holding every panel with
 * an even band of card around each. See `.scope-head` and `.deck`, and
 * CompanyPage for why a drill-down borrows the board's frame and not its
 * fixed-height flex model.
 *
 * This page was the same stack of loose cards the base page used to be - a
 * boxed header whose `.panel-head` hairline was drawn across the bottom of a
 * card with nothing under it, and two panels spaced by `--sp-4` written inline
 * at the call site.
 *
 * The deck stacks here rather than splitting in two (`.deck--stack`): a shift's
 * hourly output is one column per hour, and the census is an auto-filling grid
 * of 15rem tiles. Neither has a sensible half width.
 *
 * ## The strip is six cards of two kinds
 *
 * A real KpiCard for the census total, then five hand-built tiles for the
 * buckets - which KpiCard has no shape for, because each carries a status glyph
 * tinted by its own token rather than one of the six decorative marks. Both
 * kinds now take `.kpi--feature`, so the six read as one row and as the same
 * component the base page and the global board use.
 *
 * That mix is also why `.kpi__definition` had to learn `margin-top: auto`: the
 * total captions through `.kpi__foot`, the buckets through `.kpi__definition`,
 * the six are grid siblings stretched to one height, and with only one of the
 * two classes pinned to the bottom edge the row of captions sat at two
 * different heights.
 */
export function PlantPage() {
  const { companyCode = '', plantCode = '' } = useParams();
  const { t, lang } = useI18n();
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
        timeZone={displayZone()}
        onRetry={() => void refetch()}
        recovery={recovery}
      />

      {/* Drill-downs are taller than one screen by nature, so this region scrolls
          inside the locked frame rather than the page growing. `.scope-view` is
          what spaces the three blocks below - one --shell-gap between each. */}
      <div
        className={`view view--scroll scope-view${connection.degraded ? ' is-stale' : ''}`}
        aria-busy={isPending}
      >
        <header className="scope-head">
          <div className="scope-head__names">
            {/* The page's heading. No flag beside it, unlike a base: a plant
                code belongs to the company one level up, and the country is
                already on that page and in the breadcrumb above this one. */}
            <h2 className="scope-head__code">{plant.code}</h2>
            <span className="scope-head__name">{plant.label}</span>
          </div>

          <div className="scope-head__meta">
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
        </header>

        {/*
          The full machine census, as an exhaustive partition. Running plus
          Stopped does not equal Total on this shop floor - No Plan, Order End
          and 4M Change are real states - and a strip that hides them is how
          section 16's reconciliation against Grafana fails with nobody able to
          say which category is wrong.

          Six across, which is `.kpis`' own default, so there is no inline
          `gridTemplateColumns` here any more: an inline style outranks every
          rule in the stylesheet, so the stacked columns at the narrow
          breakpoints never used to reach this page.
        */}
        <div className="kpis">
          <KpiCard
            labelKey="kpi.machines"
            measure={toMeasure(plant.counts.total, plant.status)}
            format={int}
            coverage={coverage}
            /* The same mark the base page and the global strip give this same
               figure, so the census total is one object across all three. */
            mark="gear"
          />
          {BUCKET_ORDER.map((bucket) => {
            const bt = bucketToken(bucket);
            const value = plant.counts[bucket];
            return (
              /* Label, then figure, then caption - the same order KpiCard
                 renders, so a hand-built card and a real one look alike. */
              <div className="kpi kpi--feature" key={bucket}>
                <div className="kpi__head">
                  {/*
                   * The bucket's own status glyph is this tile's subject mark,
                   * and it is deliberately not one of KpiMark's six: those are
                   * decoration in the brand orange - see the note on
                   * `.kpi__mark` - where this shape carries the meaning and the
                   * tone carries the tier. `showLabel` prints the word from the
                   * token's own key, which is the key this used to translate by
                   * hand beside a glyph that was already emitting it to a
                   * screen reader.
                   */}
                  <div className="kpi__label">
                    <StatusGlyph token={bt} showLabel />
                  </div>
                </div>
                <div className="kpi__value" style={{ color: bt.inkVar }}>
                  {int(value)}
                </div>
                <div className="kpi__definition">
                  {machineStatusesIn(bucket, plant.counts.by_status)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="deck deck--stack">
          {data.output ? (
            <section className="panel">
              <div className="panel-head">
                <h2>{data.output.shift_label}</h2>
                <span className="sub">
                  {t('table.hours', { count: data.output.buckets.length })}
                </span>
              </div>
              {/* HourlyOutputTable scrolls itself sideways: it is one column per
                  hour and a twelve-hour shift is thirteen columns, which is
                  wider than the panel at the iPad viewport. */}
              <HourlyOutputTable output={data.output} timeZone={displayZone(company.timezone)} />
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-head">
              {/* Named for what the grid holds. This head read `table.plant` -
                  "Plant" - over a grid of machine tiles, on the one page where
                  the plant is the container rather than the subject. */}
              <h2>{t('table.machines')}</h2>
              <span className="sub">{int(data.machines.length)}</span>
            </div>
            {/*
             * Two causes, two answers - and the decision lives here rather than
             * in MachineGrid because the filters do.
             *
             * An empty machine list means either that Process excluded every
             * machine this plant runs, or that the plant has none reporting.
             * MachineGrid printed "No telemetry yet" for both, which over a
             * plant that is reporting perfectly - because somebody left a
             * process picked - sends an engineer to check a gateway that is fine.
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
      </div>
    </>
  );
}

/**
 * Composition line under each bucket tile, e.g. "Mass Pro 20 · Dandori 2".
 *
 * The statuses stay in English in both locales, which is the same rule the base
 * page's TOTAL caption follows: they are the identifiers the source system
 * reports and what the operator reads off the andon, not English words being
 * translated. See the note at the top of th.ts.
 *
 * It used to take `t` and immediately `void` it - a translator threaded through
 * a function that had already decided not to translate. The parameter is gone;
 * the rule it was hedging against is written down instead.
 */
function machineStatusesIn(bucket: string, byStatus: Record<string, number>): string {
  const members: Record<string, string[]> = {
    running: ['Mass Pro', 'Dandori'],
    stopped: ['Stop'],
    idle: ['No Plan', 'Order End'],
    other: ['4M Change'],
    no_data: ['Offline'],
  };
  return (members[bucket] ?? [])
    .filter((s) => (byStatus[s] ?? 0) > 0)
    .map((s) => `${s} ${byStatus[s]}`)
    .join(' · ');
}
