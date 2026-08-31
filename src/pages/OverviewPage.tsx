import { useState, type ReactNode } from 'react';
import { useOverview } from '../api/queries';
import { deriveConnection, useFreezeDetector, useNow } from '../domain/connectionState';
import { useConfig } from '../config/AppContext';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/en';
import { useFilters } from '../state/useFilters';
import { useSelection } from '../state/selectionStore';
import { BaseDrawer } from '../components/base/BaseDrawer';
import { KpiStrip } from '../components/kpi/KpiStrip';
import { RankingTable } from '../components/table/RankingTable';
import { StatusSummary } from '../components/table/StatusSummary';
import { TrendChart } from '../components/charts/TrendChart';
import { AlertList } from '../components/alerts/AlertList';
import { WorldMap } from '../components/map/WorldMap';
import { ConnectionBanner } from '../components/feedback/ConnectionBanner';
import { HardErrorState } from '../components/feedback/HardErrorState';
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

const BOARDS: { id: Board; tabKey: TKey }[] = [
  { id: 'fleet', tabKey: 'board.fleet' },
  { id: 'analytics', tabKey: 'board.analytics' },
];

/**
 * The tab glyphs.
 *
 * Two inline SVGs rather than an icon set or a sprite: these are the only two
 * icons on the board, and a dependency - or a second network request - for
 * fourteen path commands is not a trade worth making on a screen that has to
 * paint on a factory connection.
 *
 * Each says what its board *is* rather than which widget it holds: a globe for
 * the nine sites, a trace for what happened over the range. Drawn on a 16 box
 * in currentColor and marked `aria-hidden`, because the label is right beside
 * them and a screen reader announcing "globe Fleet Overview" is noise.
 */
const TAB_ICON: Record<Board, ReactNode> = {
  fleet: (
    <svg
      className="boardtabs__icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.1" />
      <path d="M8 1.9c-2 2.2-2 8 0 12.2M8 1.9c2 2.2 2 8 0 12.2" />
      <path d="M2.3 6h11.4M2.3 10h11.4" />
    </svg>
  ),
  analytics: (
    <svg
      className="boardtabs__icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.4 8.4h2.7l1.6-4.6 2.8 8.6 1.7-4h4.4" />
    </svg>
  ),
};

/** Short labels for the range, shared with the segmented control in the top bar. */
const RANGE_SHORT = {
  '8h': 'range.8h.short',
  '24h': 'range.24h.short',
  '7d': 'range.7d.short',
} as const satisfies Record<string, TKey>;

export function OverviewPage() {
  const { t } = useI18n();
  const cfg = useConfig();
  const [filters] = useFilters();
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
    { envelope: data?.meta, freshness: data?.freshness, isError, isPending, nowMs: now },
    frozen,
  );

  // Feeds the badge in the top bar, which lives above the router outlet.
  useShellConnection(connection, data?.totals.companies_total ?? null);

  // The only state where no numbers are shown at all: nothing has ever loaded.
  // Everywhere else the last good payload stays on screen under a banner.
  if (!data && isError) {
    return <HardErrorState error={error} onRetry={() => void refetch()} />;
  }

  const alertCount = data?.alerts.length ?? 0;
  const baseCount = data?.totals.companies_total ?? null;

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
                {TAB_ICON[b.id]}
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
            className={`board${mapExpanded ? ' board--map' : ''}`}
            id="panel-fleet"
            role="tabpanel"
            aria-labelledby="tab-fleet"
            hidden={board !== 'fleet'}
          >
            <section className="panel">
              <div className="panel-head">
                <h2>{t('map.title')}</h2>
                <div className="panel-head__aside">
                  {baseCount === null ? null : (
                    <span className="sub">{t('map.bases', { count: baseCount })}</span>
                  )}
                  {/*
                   * The methodology opener. It has to be somewhere always
                   * visible - %OA excludes downtime (D-19) and the group figure
                   * is weighted (D-20), and neither fits on a KPI card - and
                   * this head is the one place on the fleet board with room.
                   */}
                  {data ? <DataQualityFooter payload={data} violations={violations} /> : null}
                </div>
              </div>

              <div className="panel__body">
                <WorldMap
                  companies={data?.companies ?? []}
                  targetOa={data?.target_oa ?? 95}
                  tierPolicy={data?.tier_policy}
                  expanded={mapExpanded}
                  onToggleExpand={() => setMapExpanded((v) => !v)}
                />
              </div>
            </section>

            <section className="panel" hidden={mapExpanded}>
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
                <h2>{t('trend.tab', { range: t(RANGE_SHORT[filters.range]) })}</h2>
                <span className="sub">{t('trend.sub')}</span>
              </div>

              <div className="panel__body">
                {data ? (
                  <TrendChart
                    points={data.trend}
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
                {alertCount > 0 ? (
                  <span className="count-pill count-pill--alert">{alertCount}</span>
                ) : null}
              </div>

              <div className="panel__scroll">
                <AlertList alerts={data?.alerts ?? []} />
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
