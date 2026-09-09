import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useCompany, useRetryState } from '../api/queries';
import { useConfig } from '../config/AppContext';
import {
  deriveConnection,
  useFreezeDetector,
  useNow,
  useRecovery,
} from '../domain/connectionState';
import { toMeasure } from '../domain/measure';
import { isReporting, siteToken } from '../domain/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/en';
import { formatInt, formatPct } from '../i18n/format';
import { useDisplayZone } from '../state/useDisplayZone';
import { useFilters, useLinkWithFilters } from '../state/useFilters';
import { usePublishExport } from '../state/exportStore';
import { companyExportDoc } from '../domain/exportDoc';
import { useTrendWindow } from '../domain/trendWindow';
import { AlertList } from '../components/alerts/AlertList';
import { TrendChart } from '../components/charts/TrendChart';
import { ConnectionBanner } from '../components/feedback/ConnectionBanner';
import { HardErrorState, LoadingState } from '../components/feedback/HardErrorState';
import { PanelEmpty } from '../components/feedback/PanelEmpty';
import { GrafanaLink } from '../components/common/GrafanaLink';
import { useShellConnection } from '../components/layout/AppShell';
import { KpiCard } from '../components/kpi/KpiCard';
import { ShiftBreakdownTable } from '../components/machines/ShiftBreakdownTable';
import { Flag } from '../components/primitives/Flag';
import { ShiftChip } from '../components/primitives/ShiftChip';
import { StatusGlyph } from '../components/primitives/StatusGlyph';

/**
 * One base, drilled into from a pin or a ranking row.
 *
 * ## Laid out as the global board is laid out
 *
 * Three blocks, in the overview's own order and with the overview's own frame:
 * an identity strip, a KPI strip, then ONE card holding every panel with an
 * even band of card showing around each of them - see `.deck` and `.boardwrap`.
 *
 * It used to be five separate cards floating on the page tint, each spaced from
 * the next by whatever margin was written inline at its call site (--sp-4 under
 * the header, --sp-3 under the first grid, nothing under the KPI row), and the
 * header's panel carried a `.panel-head` with its bottom margin zeroed - which
 * still drew the head's full-width hairline across the bottom of a card with
 * nothing underneath it. Nothing on the page related it to the board the reader
 * had just come from.
 *
 * What is NOT borrowed from the overview is the tab strip. There the tabs buy a
 * single-screen board, and that is the overview's whole job: be read at a glance
 * by someone who will not scroll. A drill-down's job is the opposite - somebody
 * is here because they want the detail - so all four panels stay on screen at
 * once and the region scrolls, as it did before.
 *
 * ## The two panels that have no height of their own
 *
 * Panels in a grid row stretch to the taller of the pair, so the %OA chart used
 * to be exactly as tall as the stop list beside it happened to be: four open
 * stops left it about 90px of plot, which cannot show a shift-sized dip. The
 * chart now carries a floor and the list a ceiling (`.panel--trend`,
 * `.panel--alerts`), and both tables scroll inside their panels rather than
 * setting the height of the row they sit in.
 */
export function CompanyPage() {
  const { companyCode = '' } = useParams();
  const { t, lang } = useI18n();
  const cfg = useConfig();
  const displayZone = useDisplayZone();
  const [filters, setFilters] = useFilters();
  const link = useLinkWithFilters();

  const query = useCompany(companyCode, { range: filters.range, process: filters.process });
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
     here, this base with the lamps and zones under it - and this names the file
     it writes. Memoised on the payload for the reason the store gives: the
     value is what the publish effect keys on. */
  const exportDoc = useMemo(() => (data ? companyExportDoc(data) : null), [data]);
  usePublishExport(exportDoc);

  /* Same window and the same caption as the global board's trend, from the same
     hook: this panel used to be titled "Trend" with no span at all, which left
     the time picker in the bar above it governing the figures beside it and
     apparently nothing here. See src/domain/trendWindow.ts. */
  const {
    points: trend,
    rangeLabel: trendRange,
    span: trendSpan,
  } = useTrendWindow(
    data?.trend,
    filters.range,
    // The served window wins over the quick range when the calendar set one.
    filters.from && filters.to ? { from: filters.from, to: filters.to } : null,
  );

  if (!data && isError) {
    return (
      <HardErrorState
        error={error}
        onRetry={() => void refetch()}
        retry={retry}
        siteCode={companyCode}
      />
    );
  }

  /* The company code, not its name: the name is in the payload this is waiting
     for, and the code is what the reader tapped to get here. */
  if (!data) return <LoadingState name={companyCode} />;

  const c = data.company;
  const reporting = isReporting(c.status);
  const token = siteToken(c.status);
  const coverage = { reporting: reporting ? 1 : 0, total: 1 };
  const int = (v: number) => formatInt(v, lang);

  /* Whether there is a census to draw at all. Named because the plant panel
     below tests it twice, picking between two different empty states for two
     different causes - see the long note there. */
  const hasCensus = c.counts.total > 0;

  return (
    <>
      <ConnectionBanner
        info={connection}
        referenceTimezone={cfg.referenceTimezone}
        onRetry={() => void refetch()}
        recovery={recovery}
      />

      {/* Drill-downs are taller than one screen by nature, so this region scrolls
          inside the locked frame rather than the page growing. `.scope-view` is
          what spaces the three blocks below - one --shell-gap between each,
          replacing the inline margins they used to carry one by one. */}
      <div
        className={`view view--scroll scope-view${connection.degraded ? ' is-stale' : ''}`}
        aria-busy={isPending}
      >
        <header className="scope-head">
          <div className="scope-head__id">
            {/* Sized off the code beside it rather than in rem, so the pair
                scales together in kiosk density. */}
            <Flag code={c.country_code} countryName={c.country_code} size="1.75em" />
            <div className="scope-head__names">
              {/* The page's heading, and a real one: this is the only h2 on the
                  page that names the thing the whole screen is about. */}
              <h2 className="scope-head__code">{c.code}</h2>
              <span className="scope-head__name">
                {lang === 'th' ? (c.name_th ?? c.name) : c.name}
              </span>
            </div>
          </div>

          {/* The three qualifiers on every figure below: is this base reporting,
              which shift is on, and the way out to Grafana. */}
          <div className="scope-head__meta">
            <span className="chip" style={{ color: token.inkVar }}>
              <StatusGlyph token={token} showLabel />
            </span>
            <ShiftChip
              shift={c.shift}
              timeZone={displayZone(c.timezone)}
              nowMs={now}
              variant="header"
            />
            <GrafanaLink url={c.grafana_url} />
          </div>
        </header>

        {/* Four cards, and the count is a class rather than an inline
            `gridTemplateColumns`: an inline style outranks every rule in the
            stylesheet, so the stacked columns at the narrow breakpoints never
            reached this page. See `.kpis--4`. */}
        <div className="kpis kpis--4">
          <KpiCard
            labelKey="kpi.machines"
            measure={toMeasure(c.counts.total, c.status)}
            format={int}
            coverage={coverage}
          />
          <KpiCard
            labelKey="kpi.running"
            measure={toMeasure(c.counts.running, c.status)}
            format={int}
            tier="good"
            coverage={coverage}
            definitionKey="kpi.running.definition"
          />
          <KpiCard
            labelKey="kpi.oa"
            measure={toMeasure(c.kpi.oa_pct, c.status, { asOf: c.last_seen })}
            tier={c.kpi.oa_tier}
            coverage={coverage}
            definitionKey="kpi.oa.definition"
          />
          <KpiCard
            labelKey="kpi.achievement"
            measure={toMeasure(c.kpi.achievement_pct, c.status, {
              asOf: c.last_seen,
              naReasonKey: 'measure.noPlan',
            })}
            coverage={coverage}
            foot={
              <>
                {t('kpi.achievement.actual', {
                  qty: c.kpi.actual_qty === null ? '-' : int(c.kpi.actual_qty),
                })}
                {' / '}
                {/* The unit was missing here, so this card printed the
                    placeholder "{unit}" verbatim. Section 8.5: Shot and Pcs get
                    swapped in the source data, so it is always read from the
                    payload rather than assumed. */}
                {t('kpi.achievement.plan', {
                  qty: c.kpi.plan_qty === null ? '-' : int(c.kpi.plan_qty),
                  unit: t(`unit.${data.qty_unit}` as TKey),
                })}
              </>
            }
          />
        </div>

        {/*
          One card, four panels, one band of card between every pair of edges.
          Row one answers "where in this base"; row two answers "what happened".
          That is the same split the overview's two boards make, minus the tabs -
          see the note at the top of this file.
        */}
        <div className="deck">
          <section className="panel panel--plants">
            <div className="panel-head">
              {/* No count in this head. A bare figure at the far right of a
                  panel whose rows a reader can count on one hand is a riddle,
                  not a fact - and the plant panel's rows carry their own
                  identity anyway. */}
              <h2>{t('table.plant')}</h2>
            </div>
            {/*
             * Two causes, two answers - and until now one sentence for both.
             *
             * A base with nothing in scope means either that Process excluded
             * every machine it runs, or that the base itself has none
             * reporting. The first is something the reader did and can undo;
             * the second is a fact about the site. Printing the site's status
             * mark for both told an engineer to go and look at a gateway
             * because somebody had left a process picked.
             *
             * The test is the CENSUS, not `plants.length`, and that distinction
             * is load-bearing: `plants` comes off master data, so THS lists its
             * four lamps whatever the filters say and an empty array is
             * unreachable. Measured against the real endpoint on 2026-09-07,
             * `?process=Assembly` returns all four plants with `counts.total`
             * of 0 - which is the state a reader is actually in, and the one
             * the old condition could never have caught.
             *
             * Process and nothing else, checked against ScopeQuery in
             * DashboardApi.ts rather than assumed: this route is sent `range`
             * and `process` only. The Lamp filter is in the row above and reads
             * as though it ought to be the cause here, but it is never sent to
             * this endpoint, so offering to clear it would be a dead end.
             */}
            {!hasCensus && filters.process !== 'all' ? (
              <PanelEmpty
                message={t('empty.panel.plants', { process: filters.process })}
                action={{
                  label: t('empty.panel.clearProcess'),
                  onClick: () => setFilters({ process: 'all' }),
                }}
              />
            ) : !hasCensus ? (
              <PanelEmpty
                /* Not the funnel: nothing was filtered out. The cylinder says
                   the store was read and holds nothing for this base, which is
                   what "no telemetry yet" means. */
                glyph="database"
                message={t('site.neverConnected')}
              />
            ) : (
              /* Scrolls in place, like the overview's ranking. The panel is one
                 half of a grid row, and a base with a long lamp list would
                 otherwise set the height of the shift table beside it. */
              <div className="panel__scroll">
                <table className="rank-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('table.plant')}</th>
                      <th scope="col">{t('table.runStop')}</th>
                      <th scope="col">{t('table.oa')}</th>
                      <th scope="col">{t('table.achv')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.plants.map((p) => (
                      <tr key={p.code}>
                        <td>
                          <Link to={link(`/company/${c.code}/plant/${p.code}`)}>
                            <span className="rank-table__name">
                              <span>{p.code}</span>
                              <span className="rank-table__sub">{p.label}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="mono">
                          {int(p.counts.running)} / {int(p.counts.stopped)}
                        </td>
                        <td className="mono">
                          {p.kpi.oa_pct === null ? '-' : formatPct(p.kpi.oa_pct, lang)}
                        </td>
                        <td className="mono">
                          {p.kpi.achievement_pct === null
                            ? t('measure.noPlan')
                            : formatPct(p.kpi.achievement_pct, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel panel--shifts">
            <div className="panel-head">
              {/* Named for the table under it, not for the control above it: the
                  head used to read `filter.range` - "Range" - which is the time
                  picker in the toolbar, while the rows below are a per-shift
                  breakdown of output, plan and %OA. */}
              <h2>{t('shift.breakdown')}</h2>
              {/* Only the one state the rows cannot report for themselves. This
                  head used to read "2 of 2" whenever a pattern WAS configured -
                  the same figure twice, a ratio that can never be anything but
                  1 - and every row below already prints its own "1 of 2". */}
              {data.shift_config ? null : (
                <span className="sub">{t('shift.notConfigured')}</span>
              )}
            </div>
            <div className="panel__scroll">
              <ShiftBreakdownTable
                rows={data.shift_breakdown}
                timeZone={displayZone(c.timezone)}
              />
            </div>
          </section>

          <section className="panel panel--trend">
            <div className="panel-head">
              <h2>{`${t('trend.title')} · ${trendRange}`}</h2>
              <span className="sub">{t('trend.subSite', { span: trendSpan })}</span>
            </div>
            {/* One site, so the chart follows the reader's time mode like
                everything else on this page. Contrast the fleet chart on the
                overview, which has nine clocks under it and no local reading. */}
            <TrendChart
              points={trend}
              target={data.target_oa}
              warnAt={data.tier_policy.warn_at}
              timeZone={displayZone(c.timezone)}
            />
          </section>

          <section className="panel panel--alerts">
            <div className="panel-head">
              <h2>{t('alerts.title')}</h2>
            </div>
            {/* The scroll wrapper the overview's copy of this list has always
                had, and `.alert-row` is already drawn for it: the row reserves
                6px on its right for the scrollbar thumb, so without a scroll
                container that inset was padding against nothing and the clock
                sat 6px short of the panel edge for no reason. */}
            <div className="panel__scroll">
              <AlertList alerts={data.alerts} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
