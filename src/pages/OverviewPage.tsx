import { useCallback, useMemo, useState } from 'react';
import { useOverview, useRetryState } from '../api/queries';
import {
  deriveConnection,
  useFreezeDetector,
  useNow,
  useRecovery,
} from '../domain/connectionState';
import { useConfig } from '../config/AppContext';
import { useI18n } from '../i18n/I18nProvider';
import { REGION_NONE, type CompanySummary } from '../api/contract';
import type { TKey } from '../i18n/en';
import { useFilters } from '../state/useFilters';
import { useSelection } from '../state/selectionStore';
import { usePublishExport } from '../state/exportStore';
import { overviewExportDoc } from '../domain/exportDoc';
import { useTrendWindow } from '../domain/trendWindow';
import { BaseDrawer } from '../components/base/BaseDrawer';
import { KpiStrip } from '../components/kpi/KpiStrip';
import { RankingTable } from '../components/table/RankingTable';
import { StatusSummary } from '../components/table/StatusSummary';
import { TrendChart } from '../components/charts/TrendChart';
import { AlertList } from '../components/alerts/AlertList';
import { AlertsLimitPicker } from '../components/layout/AlertsLimitPicker';
import { WorldMap } from '../components/map/WorldMap';
import { ConnectionBanner } from '../components/feedback/ConnectionBanner';
import {
  EmptyState,
  HardErrorState,
  LoadingState,
} from '../components/feedback/HardErrorState';
import { DataQualityFooter } from '../components/feedback/DataQualityFooter';
import { useShellConnection } from '../components/layout/AppShell';

/**
 * The global board.
 *
 * Laid out as exactly one 1180 x 820 viewport: masthead, filter row, KPI strip,
 * one board. Nothing below the fold, because this screen's job is to be read at
 * a glance by someone who is not going to scroll it.
 *
 * ## Two boards behind one tab strip
 *
 * The tab strip moved up a level. It used to sit inside the left panel's head
 * and switch that panel between three views - map, trend, stops - while the
 * ranking stayed put beside it. Now it sits above the whole board and switches
 * the board itself:
 *
 *   Fleet Overview      the map and the ranking, side by side
 *   Executive Analytics the %OA trend and the open stops, side by side
 *
 * That split is the one the two halves already had. The map and the ranking are
 * both answers to "which base", read together - the reader looks up a pin and
 * then finds its row. The trend and the stops are both answers to "what
 * happened", and neither is read at the same moment as a pin. Pairing them the
 * old way meant the ranking was permanently on screen next to a panel that was
 * only sometimes about bases, and the trend had to share a column with a map.
 *
 * Each half also gets the whole board width now rather than one column of it.
 * The chart in particular had about 120px of plot in the old arrangement, which
 * is not enough vertical resolution to see a shift-sized dip.
 *
 * The stop count rides on the Executive Analytics tab, so the one fact that must
 * not be hidden behind a tap is not.
 *
 * Both boards stay mounted and the inactive one is `hidden`. That is for the map
 * specifically: unmounting it tears down the Leaflet instance, so every visit to
 * the other tab would reset the pan and zoom, and the label placement pass would
 * re-run from scratch - visible as the nine cards jumping into position. WorldMap
 * keeps a ResizeObserver on its container, so the 0 -> full size transition when
 * a board is shown again invalidates the map size on its own.
 */

type Board = 'fleet' | 'analytics';

/*
 * The map's site list before anything has loaded.
 *
 * A module constant rather than a `[]` written at the call site, because the map
 * is memoised and a fresh literal every render is a prop that never compares
 * equal - which would hand it back the per-second re-render the memo is there to
 * stop, for the one state where there is nothing to draw anyway.
 */
const NO_COMPANIES: CompanySummary[] = [];

const BOARDS: { id: Board; tabKey: TKey }[] = [
  { id: 'fleet', tabKey: 'board.fleet' },
  { id: 'analytics', tabKey: 'board.analytics' },
];

/*
 * There are no tab glyphs.
 *
 * Each tab carried an inline SVG - a globe for the nine sites, a trace for what
 * happened over the range - on the argument that a reader at arm's length picks
 * up a shape before a word. That reasoning holds where the shape is the only
 * mark, and it stopped holding here once the tabs were drawn as real folder
 * tabs: the tab in front is already the one thing on the board carrying a shape,
 * a value step and an ink step all at once, and a glyph inside it was a fourth
 * signal saying nothing the other three did not. Both were `aria-hidden`, so
 * nothing is lost to a screen reader either.
 */

export function OverviewPage() {
  const { t } = useI18n();
  const cfg = useConfig();
  const [filters, setFilters] = useFilters();
  const { query, violations } = useOverview(filters);
  const { data, isError, isPending, error, refetch } = query;
  const [board, setBoard] = useState<Board>('fleet');
  /*
   * Deliberately not persisted, and deliberately not in the URL. The board is
   * left running on a wall for days and this is a "let me look at that for a
   * moment" state, not a preference - a kiosk that reloads overnight into a map
   * with no ranking beside it is a fault report in the morning.
   */
  const [mapExpanded, setMapExpanded] = useState(false);
  /* Stable, because the map is memoised and an inline arrow is a changed prop
     on every one of the clock's ticks below. */
  const toggleMap = useCallback(() => setMapExpanded((v) => !v), []);

  /*
   * The base whose drawer is open, resolved against the payload on every render
   * rather than captured when it was tapped.
   *
   * That is the whole reason the store holds a code and not an object: the board
   * polls every thirty seconds, and a drawer holding its own copy of a
   * CompanySummary would sit there quoting figures the KPI strip behind it had
   * already replaced. Looking it up here means the drawer is as fresh as the rest
   * of the board, and a base that leaves the payload - a region filter narrowed
   * past it - closes the drawer by simply not being found.
   */
  const selected = useSelection((sel) => sel.selected);
  const selectedCompany = data?.companies.find((c) => c.code === selected) ?? null;

  const now = useNow();
  const frozen = useFreezeDetector(data?.meta.generated_at);
  const connection = deriveConnection(
    { envelope: data?.meta, freshness: data?.freshness, isError, isPending, error, nowMs: now },
    frozen,
  );

  // Feeds the badge in the top bar, which lives above the router outlet.
  useShellConnection(connection);

  /* What the board is doing about a failure, for the error page to say out loud.
     Read unconditionally because it is a hook; only the error branch uses it. */
  const retry = useRetryState(query);

  /* The outage that just ended, if one did. Reports the gap it left in the
     trend; takes itself off after eight seconds. */
  const recovery = useRecovery(connection.state, now);

  /*
   * Names the file the Export button prints, in the same row as the filters
   * above. The board itself is the content - see ExportButton - so the one
   * thing the top bar cannot work out for itself is what to call it.
   *
   * Memoised on the payload rather than rebuilt per render: the value is what
   * the publish effect keys on, so recomputing it every render would
   * re-register the name on every clock tick. The payload reference is stable
   * between polls, which makes this run once per payload.
   */
  const exportDoc = useMemo(() => (data ? overviewExportDoc(data) : null), [data]);
  usePublishExport(exportDoc);

  /*
   * The trend, cut to the window the time picker is showing.
   *
   * The head above it has named the picked range since the tabs were split, and
   * until now the line under it was the payload's fixed 24 hourly buckets
   * whatever was picked - so "Last 8h" retitled the panel and moved nothing.
   * Narrowing is something this end can do honestly (24 buckets contain the
   * last 8), widening is not, and `windowTrend` does the first and refuses the
   * second. See src/domain/trendWindow.ts.
   *
   * The average, the peak, the low and the table twin are all derived inside
   * TrendChart from the array it is handed, so they follow the window with the
   * line rather than staying on a day's figures under an eight-hour title.
   */
  const {
    points: trend,
    rangeLabel: trendRange,
  } = useTrendWindow(
    data?.trend,
    filters.range,
    // The served window wins over the quick range when the calendar set one.
    filters.from && filters.to ? { from: filters.from, to: filters.to } : null,
  );

  const alerts = useMemo(
    () => data?.alerts.slice(0, filters.alertsLimit) ?? [],
    [data?.alerts, filters.alertsLimit],
  );

  /*
   * The three states with no board at all, in the order they have to be tested.
   *
   * Failure first: `isError` with no payload is the one case where inventing
   * anything - a zero, a blank grid, a remembered figure - is the failure
   * section 14 forbids. Everywhere else the last good payload stays on screen
   * under a banner, which is what ConnectionBanner below is for.
   *
   * Then the first load, which used to fall through to the board and render six
   * skeleton cards above three empty panels. The strip still renders skeletons
   * on a *refetch* - see SkeletonKpi, which is what holds the row's height - but
   * a cold board with nothing in it at all should say so rather than looking
   * like a board that has finished loading nothing.
   *
   * Then the empty result, which is not a failure and must not be drawn as one:
   * the server answered 200 with an empty list because the filters asked for
   * nothing. `region=none` is the common way in - untick every base in the
   * Region menu - and until now it produced a screen indistinguishable from a
   * dead backend.
   */
  if (!data && isError) {
    return <HardErrorState error={error} onRetry={() => void refetch()} retry={retry} />;
  }

  if (!data) return <LoadingState />;

  if (data.companies.length === 0) {
    return (
      <EmptyState
        noRegion={filters.region === REGION_NONE}
        onSelectAll={() => setFilters({ region: 'all' })}
        /* Everything that can narrow the board to nothing, back to its default.
           `process` is in here because Assembly against a base that runs none
           is the other way to reach an empty board. */
        onClear={() => setFilters({ region: 'all', plant: 'all', zone: 'all', process: 'all' })}
      />
    );
  }

  /* Roving arrow keys, because a tablist that only responds to Tab is not one. */
  const onTabKey = (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const i = BOARDS.findIndex((b) => b.id === board);
    const next = BOARDS[(i + delta + BOARDS.length) % BOARDS.length];
    setBoard(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <>
      <ConnectionBanner
        info={connection}
        referenceTimezone={cfg.referenceTimezone}
        onRetry={() => void refetch()}
        recovery={recovery}
      />

      <div
        className={`view${connection.degraded && data ? ' is-stale' : ''}`}
        aria-busy={isPending}
      >
        <KpiStrip data={data} />

        {/*
         * The tabs, seated on the board's own top edge rather than floating
         * above it: the active one has to look like the front of the surface
         * underneath, which is why this row overlaps the board by a pixel
         * instead of sitting in the gap.
         *
         * The other end of this row used to carry the fleet's machine mix -
         * Mass Pro, Dandori, Stop, Order End. It came off because this is an
         * executive board: RUNNING already prints "Mass Pro/Dandori" and STOP
         * prints "Unplanned stop" one band above, so the strip restated the two
         * headline figures in smaller type, and the only facts it added - how
         * much of running is changeover, and how many machines have finished
         * their order - are shift-floor questions that belong on the plant page.
         * The machines it named are still accounted for: TOTAL MACHINE carries
         * the rest of the census beside its figure, which is what keeps
         * RUNNING + STOP visibly adding up to TOTAL.
         */}
        <div className="boardbar">
          <div
            className="boardtabs"
            role="tablist"
            aria-label={t('view.select')}
            onKeyDown={onTabKey}
          >
            {/*
             * No counts on the tabs.
             *
             * They carried one each - bases on Fleet, open stops on Analytics -
             * and two discs of the same shape reading two unrelated quantities
             * is what made them a puzzle rather than a number. Both facts are
             * still on the board, each beside the thing it counts: "9 Bases
             * Global" over the map, and the alert count on the ALERTS head.
             */}
            {BOARDS.map((b) => (
              <button
                key={b.id}
                type="button"
                id={`tab-${b.id}`}
                className="boardtabs__btn"
                role="tab"
                aria-selected={b.id === board}
                aria-controls={`panel-${b.id}`}
                tabIndex={b.id === board ? 0 : -1}
                onClick={() => setBoard(b.id)}
              >
                {t(b.tabKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="boardwrap">
          {/*
           * Expanded, the fleet board is one column and the ranking is
           * `hidden` rather than merely narrow.
           *
           * Narrowing it to a sliver was the first attempt and it is the wrong
           * trade: the ranking is a seven-column table with a plant-count chip,
           * and squeezed it turns into ellipses, which is a panel that occupies
           * space while answering nothing. The map is being expanded because
           * someone wants to look at geography - give them the width and put
           * the table back in one tap.
           */}
          <div
            className={`board board--fleet${mapExpanded ? ' board--map' : ''}`}
            id="panel-fleet"
            role="tabpanel"
            aria-labelledby="tab-fleet"
            hidden={board !== 'fleet'}
          >
            <section className="panel panel--map">
              <div className="panel-head">
                {/*
                 * Title and the methodology opener, grouped. The opener sits
                 * right after the title rather than out at the right edge - it
                 * has to be somewhere always visible (%OA excludes downtime,
                 * D-19, and the group figure is weighted, D-20), and the base
                 * count that used to share this head has been dropped.
                 */}
                <div className="panel-head__titrow">
                  <h2>{t('map.title')}</h2>
                  {data ? <DataQualityFooter payload={data} violations={violations} /> : null}
                </div>
              </div>

              <div className="panel__body">
                <WorldMap
                  companies={data?.companies ?? NO_COMPANIES}
                  targetOa={data?.target_oa ?? 95}
                  tierPolicy={data?.tier_policy}
                  expanded={mapExpanded}
                  onToggleExpand={toggleMap}
                />
              </div>
            </section>

            <section className="panel panel--rank" hidden={mapExpanded}>
              <div className="panel-head">
                <h2>{t('table.title')}</h2>
                {/* The head's right-hand end, which the artboard leaves empty.
                    It takes the fleet's tier counts rather than a control: the
                    order is set on the column heads inside the table, and this
                    is the one place on the panel where a summary is always
                    visible even when the rows have been scrolled or expanded. */}
                <StatusSummary data={data} />
              </div>
              <RankingTable data={data} />
            </section>
          </div>

          <div
            className="board board--analytics"
            id="panel-analytics"
            role="tabpanel"
            aria-labelledby="tab-analytics"
            hidden={board !== 'analytics'}
          >
            <section className="panel">
              <div className="panel-head">
                <h2>{t('trend.tab', { range: trendRange })}</h2>
              </div>

              <div className="panel__body">
                {data ? (
                  <TrendChart
                    points={trend}
                    target={data.target_oa}
                    warnAt={data.tier_policy.warn_at}
                    referenceTimezone={cfg.referenceTimezone}
                  />
                ) : (
                  <div className="skeleton" style={{ flex: 1, minHeight: 0 }} />
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>{t('alerts.tab')}</h2>
                <div className="panel-head__aside toppicker-slot">
                  <AlertsLimitPicker />
                </div>
              </div>

              {/*
                * The Top-N cut, made here rather than asked for.
                *
                * The payload always carries the widest cut the picker offers -
                * see the note in useOverview - so changing Top-N is a slice of
                * an array already on the machine: instant, no request, and
                * nothing outside this panel moves. The rows themselves are
                * still the server's ranking, in the server's order; this end
                * only stops reading early.
                */}
              <div className="panel__scroll">
                <AlertList alerts={alerts} />
              </div>
            </section>
          </div>
        </div>
      </div>

      {/*
       * Outside `.view`, deliberately. Inside it the drawer would be clipped by
       * the board's own overflow and dimmed by the `is-stale` desaturation that
       * `.view` carries when a poll goes quiet - a panel the reader just asked
       * for should not fade because the data behind it is a minute old. It says
       * so itself instead, through the same MeasureValue arms as everything else.
       */}
      <BaseDrawer
        company={selectedCompany}
        targetOa={data?.target_oa ?? 95}
        qtyUnit={data?.qty_unit ?? 'pcs'}
        nowMs={now}
      />
    </>
  );
}
