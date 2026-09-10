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
import { siteToken } from '../domain/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/en';
import { formatInt, formatPct } from '../i18n/format';
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
 * ## The strip is six KpiCards, and used to be six census tiles
 *
 * It was TOTAL plus one hand-built tile per status bucket - Running, Stopped,
 * Idle, Other, No data - drawn as an exhaustive partition of the census on the
 * argument that a strip which hides a bucket is how a reconciliation against
 * Grafana fails with nobody able to say which category is wrong. What that cost
 * was every figure this page exists to report: on a plant running normally
 * three of the six cards read 0, and the two numbers a production manager comes
 * here for - %OA and %AR - were nowhere on the strip at all. Measured at THS
 * 6332 on 2026-09-10: 26 / 21 / 5 / 0 / 0 / 0.
 *
 * So the partition is kept and compressed rather than dropped. STOP is now
 * every counted machine that is not running, exactly as the overview strip
 * computes it, and the statuses folded into it are named in its caption and
 * again in its info panel - so Idle, Other and No data are one line lower
 * rather than gone. ORDER END, which was never in any bucket because it sits
 * outside TOTAL, becomes a card of its own instead of a footnote nobody could
 * find. The freed slots go to %OA and %AR.
 *
 * The six cards are now the overview's own six, minus NEEDING ATTENTION - a
 * fleet-level count with nothing to say about one plant - plus ORDER END. Same
 * order, same marks, same strings, so a reader arriving from the board two
 * levels up meets the same objects.
 */
/*
 * The two statuses RUNNING is made of, and therefore the two STOP is not.
 *
 * A local copy, as on the overview strip and the base page, and for the reason
 * recorded there: the server's bucket map has five buckets where this card has
 * two sides, so borrowing it would tie the arithmetic to a classification it
 * does not use. The pair is also the settled part of the status enum - whether
 * `4M Change` counts as running has never been decided - so anything that is
 * not one of these two is, for this strip, not running.
 */
const RUNNING_STATUSES = new Set(['Mass Pro', 'Dandori']);

/**
 * The statuses behind one headline figure, largest first: "Stop 5 · No Plan 2".
 *
 * The names stay English in both locales, which is the rule the whole board
 * follows for machine states: they are the identifiers the source system
 * reports and what the operator reads off the andon and off Grafana, not
 * English words being translated. See the note at the top of th.ts.
 *
 * Read off the payload's own keys rather than a hand-kept membership list -
 * which is what the bucket tiles this replaced used - so a status the source
 * system starts reporting appears on the day it lands instead of falling into
 * an "Other" tile nobody can decompose.
 */
function statusLine(
  byStatus: Record<string, number>,
  keep: (status: string) => boolean,
  int: (n: number) => string,
): string {
  return Object.entries(byStatus)
    .filter(([status, n]) => n > 0 && keep(status))
    .sort((a, b) => b[1] - a[1])
    .map(([status, n]) => `${status} ${int(n)}`)
    .join(' · ');
}

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
  const pct = (v: number) => formatPct(v, lang);

  /*
   * What the three census cards are made of.
   *
   * `notRunning` is TOTAL minus RUNNING and not `counts.stopped`, which is the
   * `Stop` status alone. The payload is untouched by that choice - the server
   * must keep answering "how many machines are stopped" truthfully - it is a
   * presentation rule, and the same one the overview strip applies: TOTAL over
   * RUNNING 21 and STOP 5 with a machine in `Warning` unaccounted for reads as
   * an arithmetic error, and naming the leftover "1 Other" explained nothing.
   * What it costs is that a machine in `No Plan`, `4M Change`, `Pending`,
   * `Alarm` or `Warning` now counts toward the figure somebody escalates on, so
   * the caption and the info panel both break the figure back down by status.
   *
   * `orderEnd` counts ORDERS, not machines, and that is the one thing a reader
   * of this strip has to know about it: it is the production board's `Order
   * End` cards - every order finished since midnight, site clock - so a machine
   * that ran three of them today is three of this number and one of TOTAL. It
   * therefore sits beside the census and is never added to it. See
   * `Counts.finished_orders`, which carries the whole derivation.
   */
  const machines = plant.counts.total;
  const share = (n: number) => (machines > 0 ? pct((n / machines) * 100) : undefined);
  const notRunning = machines - plant.counts.running;
  const orderEnd = plant.counts.finished_orders;
  const runningLine = statusLine(plant.counts.by_status, (s) => RUNNING_STATUSES.has(s), int);
  const notRunningLine = statusLine(plant.counts.by_status, (s) => !RUNNING_STATUSES.has(s), int);

  /* D-07: a plant may carry its own target, and null means inherit the group
     value. The pill beside %OA is the denominator that figure is read against,
     so it has to be the target this plant is actually judged on. */
  const targetOa = plant.target_oa ?? data.target_oa;

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
          The census, then the two figures the plant is judged on, then the part
          of the census that sits outside the total. See the note at the top of
          this file for what this replaced and what the compression costs.

          Six across, which is `.kpis`' own default, so there is no inline
          `gridTemplateColumns` here any more: an inline style outranks every
          rule in the stylesheet, so the stacked columns at the narrow
          breakpoints never used to reach this page.
        */}
        <div className="kpis">
          <KpiCard
            labelKey="kpi.machines"
            measure={toMeasure(machines, plant.status)}
            format={int}
            coverage={coverage}
            /* No caption. This card had one for a release - "N observed",
               TOTAL plus ORDER END - written while ORDER END was believed to
               count machines. It counts orders, so the sum was two different
               units added together and the line was simply false. The two
               figures are related, but not by addition, and the ORDER END card
               says so itself. */
            /* The rule behind the figure, behind the ⓘ. This is the card the
               question gets asked of first, because TOTAL is the one number on
               the strip that is not read off a machine - it is a rule about
               which machines count, and on this plant that rule leaves one
               state out. Same panel as the overview strip's own TOTAL card. */
            infoKey="kpi.machines.source"
            /* The same mark the base page and the global strip give this same
               figure, so the census total is one object across all three. */
            mark="gear"
          />

          <KpiCard
            labelKey="kpi.running"
            measure={toMeasure(plant.counts.running, plant.status)}
            format={int}
            tone="good"
            coverage={coverage}
            meta={share(plant.counts.running)}
            metaTone="good"
            /* The split, not the definition: this caption is what the bucket
               tile printed - "Mass Pro 20 · Dandori 1" - and it is the part
               that changes what the number means, since twenty-one running with
               one mid-mould-change is a different shift from twenty-one
               producing. The definition is on the label as a tooltip. */
            foot={runningLine === '' ? undefined : runningLine}
            /* The caption already prints the split; the panel says why Dandori
               is on this side of the line at all - a mould change is a manned
               machine being worked on, not a stop - and where 4M Change went.
               The two figures are the payload's own, so they tick in the panel
               like every other live number there. */
            infoKey="kpi.running.source"
            infoParams={{
              massPro: int(plant.counts.by_status['Mass Pro'] ?? 0),
              dandori: int(plant.counts.by_status.Dandori ?? 0),
            }}
            mark="play"
          />

          <KpiCard
            labelKey="kpi.stopped"
            measure={toMeasure(notRunning, plant.status)}
            format={int}
            tone="critical"
            coverage={coverage}
            meta={share(notRunning)}
            metaTone="critical"
            /* The statuses folded in, in the caption where the tile used to
               print them, and again in the panel below - a reader who wants to
               know whether "5" is five stops or four stops and a machine with
               no plan must be able to find out without leaving the page. */
            foot={notRunningLine === '' ? undefined : notRunningLine}
            infoKey="kpi.stopped.source"
            infoParams={{ breakdown: notRunningLine || '-' }}
            mark="stop"
          />

          <KpiCard
            labelKey="kpi.oa"
            measure={toMeasure(plant.kpi.oa_pct, plant.status, { asOf: plant.last_seen })}
            tier={plant.kpi.oa_tier}
            coverage={coverage}
            /* Beside the figure and not in the head: "Avg %OA" plus a target
               pill on one line is what renders as "Av…" at a sixth of this
               strip. The foot stays put, so the bottom line of all six cards
               still reads across as one line. */
            meta={t('kpi.targetShort', { target: targetOa })}
            metaAt="figure"
            definitionKey="kpi.oa.definition"
            infoKey="kpi.oa.source"
            infoWide
            infoParams={{
              machines:
                plant.kpi.oa_machine_count === undefined
                  ? '-'
                  : int(plant.kpi.oa_machine_count),
              total: int(machines),
            }}
            mark="gauge"
          />

          {/* The plant board's own name for %Achievement - see 'kpi.ar' in
              en.ts. Everything explaining the number is the achievement card's:
              the plan pill, the actual caption and the whole info panel. */}
          <KpiCard
            labelKey="kpi.ar"
            measure={toMeasure(plant.kpi.achievement_pct, plant.status, {
              asOf: plant.last_seen,
              naReasonKey: 'measure.noPlan',
            })}
            coverage={coverage}
            meta={t('kpi.achievement.planShort', {
              qty: plant.kpi.plan_qty === null ? '-' : int(plant.kpi.plan_qty),
            })}
            metaAt="figure"
            /* Section 8.5: Shot and Pcs are swapped in the source data often
               enough that the unit is always read from the payload. */
            foot={t('kpi.achievement.actualUnit', {
              qty: plant.kpi.actual_qty === null ? '-' : int(plant.kpi.actual_qty),
              unit: t(`unit.${data.qty_unit}` as TKey),
            })}
            infoKey="kpi.achievement.source"
            infoParams={{
              actual: plant.kpi.actual_qty === null ? '-' : int(plant.kpi.actual_qty),
              plan: plant.kpi.plan_qty === null ? '-' : int(plant.kpi.plan_qty),
            }}
            mark="target"
          />

          {/* Neutral, deliberately. A finished order is not a fault and not an
              achievement - and this is the one card on the strip that does not
              count machines, which is why its caption spends itself on the unit
              rather than on a definition. */}
          <KpiCard
            labelKey="kpi.orderEnd"
            measure={toMeasure(orderEnd, plant.status)}
            format={int}
            coverage={coverage}
            definitionKey="kpi.orderEnd.definition"
            infoKey="kpi.orderEnd.source"
            mark="flag"
          />
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

