import { Link } from 'react-router';
import logo from '/brand/one-stanley-narong-pat.png';
import type { ConnectionInfo } from '../../domain/connectionState';
import { useI18n } from '../../i18n/I18nProvider';
import { usePrefs } from '../../state/prefsStore';
import { useFilters, useLinkWithFilters } from '../../state/useFilters';
import { LiveBadge } from './LiveBadge';
import { PlantFilter } from './PlantFilter';
import { ProcessFilter } from './ProcessFilter';
import { RefreshPicker } from './RefreshPicker';
import { RegionFilter } from './RegionFilter';
import { ThemeToggle } from './ThemeToggle';
import { useMeta } from '../../api/queries';
import type { Range } from '../../api/contract';

/** The three windows the API accepts, in the order the artboard draws them. */
const RANGES: { id: Range; key: 'range.8h.short' | 'range.24h.short' | 'range.7d.short' }[] = [
  { id: '8h', key: 'range.8h.short' },
  { id: '24h', key: 'range.24h.short' },
  { id: '7d', key: 'range.7d.short' },
];

/**
 * Brand, freshness, language, and the filter row.
 *
 * Two bands, as drawn. The masthead is one line - logo, title, copyright, then
 * the live/language cluster pushed right - and the filter row is its own
 * full-width line below it. That separation is what makes the controls read as
 * "these scope everything under here" instead of as more header furniture.
 *
 * Two things the artboard shows that are not literal here, both because the
 * drawn control has no data behind it:
 *
 *   - The range segment is drawn as "7 days / 1 month / 3 months". The API
 *     accepts 8h, 24h and 7d (zRange in the contract), so the segment carries
 *     those three. Drawing a month button that sends a range the backend
 *     rejects would be worse than drawing the right three.
 *   - The "Time range" dropdown beside it is drawn twice over, so to speak - it
 *     duplicates the segment. That slot instead carries the timestamp anchor
 *     (each site's own clock, or one reference zone), which is a real
 *     preference the app already models and previously had no UI for at all.
 *
 * The nine-base list that used to sit under the copyright is gone: the artboard
 * drops it, and the coverage it carried - "6 of 9 connected" - is now the first
 * KPI card's caption, where it sits next to the number it qualifies. What stays
 * on the legal line is the footprint alone ("· 9 Global Bases"), read from
 * master data rather than hardcoded, so adding a base does not leave a stale
 * number in the masthead - and so that narrowing the region filter does not
 * shrink the group's own footprint to whatever is currently on screen.
 */
export function TopBar({
  connection,
  baseCount,
}: {
  connection: ConnectionInfo;
  baseCount: number | null;
}) {
  const { t } = useI18n();
  const [filters, setFilters] = useFilters();
  const link = useLinkWithFilters();
  const meta = useMeta();
  const lang = usePrefs((s) => s.lang);
  const kiosk = usePrefs((s) => s.kiosk);
  const toggleKiosk = usePrefs((s) => s.toggleKiosk);
  const setLang = usePrefs((s) => s.setLang);
  const timeMode = usePrefs((s) => s.timeMode);
  const setTimeMode = usePrefs((s) => s.setTimeMode);

  /*
   * The footprint, from master data rather than from the payload on screen.
   *
   * Now that Region is a live filter, `companies_total` in the overview payload
   * is the *filtered* count - pick Japan and it is 1. That is the right number
   * for the KPI strip's coverage caption, which is about the scope being read,
   * and the wrong one for a legal line that claims how many bases the group
   * has. Meta is the fleet as commissioned; the payload count stays as the
   * fallback for the moment before meta lands.
   */
  const fleetCount = meta.data?.companies.length ?? baseCount;

  return (
    <header className="topbar">
      <div className="topbar__masthead">
        <Link className="brand__link" to={link('/overview')} aria-label={t('nav.overview')}>
          <img className="brand__mark" src={logo} alt={t('app.title')} />
        </Link>

        <div className="brand__text">
          <h1 className="brand__title">{t('app.title')}</h1>
          <span className="brand__legal">
            {t('app.copyright')}
            {fleetCount === null ? null : ` · ${t('app.globalBases', { count: fleetCount })}`}
          </span>
        </div>

        <div className="topbar__utility">
          {/*
           * Freshness, language, appearance. Three separate controls on one
           * line rather than one box holding all of them: the first is a
           * readout and the other two are switches, and a shared border would
           * invite the question of what tapping the left third does.
           *
           * The theme switch goes last, after the language tiles. It is the
           * least consequential of the three - it changes how the board looks
           * and nothing about what it says - and putting it on the outside
           * keeps the two things a viewer might actually need mid-shift, the
           * freshness state and the language, nearer the title they belong to.
           */}
          <div className="statusbar">
            <LiveBadge info={connection} />

            {/*
             * Both codes, with the active one filled. A button labelled with the
             * *other* language is indistinguishable from a label until you press
             * it, which is no use to a Thai reader arriving at an English board.
             */}
            <div className="langseg" role="group" aria-label={t('lang.current')}>
              <button
                type="button"
                className="langseg__btn"
                aria-pressed={lang === 'th'}
                onClick={() => setLang('th')}
              >
                TH
              </button>
              <button
                type="button"
                className="langseg__btn"
                aria-pressed={lang === 'en'}
                onClick={() => setLang('en')}
              >
                EN
              </button>
            </div>

            <ThemeToggle />
          </div>

          {/*
           * Only rendered while kiosk mode is on, so there is always a way out
           * of it. The way *in* is `?kiosk=1` or the K key - which is how a wall
           * panel is configured anyway - and the artboard has no button for it,
           * so drawing one on the iPad board would be furniture nobody asked for.
           */}
          {kiosk ? (
            <button type="button" className="chip tap" onClick={toggleKiosk}>
              {t('kiosk.off')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="topbar__filters">
        {/*
          One filter row, above everything it scopes. Per-panel filters are how
          a page ends up with two panels summing over different sets and no way
          to tell from the screen.

          Region scopes to companies; Lamp scopes to plants inside them, and the
          two intersect. Lamp exists because the operator boards are per plant -
          without it, "THS 30" and "Lamp 2: 29" look like a disagreement instead
          of two different questions.

          Process is wired now, and it is the last of the three: THS 6332 runs 26
          Injection machines and 3 Surface, and the plant board is Injection-only,
          so without it the two screens counted different machines. Set it to
          Injection to read this board against that one.
        */}
        <RegionFilter />

        <PlantFilter />

        <ProcessFilter />

        <span className="topbar__filters-spacer" />

        {/*
         * Beside the range control and left of the time anchor - the same place
         * Grafana puts it, next to the time picker. Deliberate: this board is
         * read alongside one, and a reader looking for the refresh interval
         * looks where the other screen keeps it.
         */}
        <RefreshPicker />

        <div className="rangeseg" role="group" aria-label={t('filter.range')}>
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="rangeseg__btn"
              aria-pressed={filters.range === r.id}
              onClick={() => setFilters({ range: r.id })}
            >
              {t(r.key)}
            </button>
          ))}
        </div>

        {/*
         * The timestamp anchor. Every metric keeps using each site's own shift
         * whichever way this is set - it only changes which clock the *times*
         * on screen are read against - and `time.referenceNote` says so.
         */}
        <button
          type="button"
          className="filter tap"
          onClick={() => setTimeMode(timeMode === 'site_local' ? 'reference' : 'site_local')}
        >
          <span className="filter__key">{t('filter.time')}</span>
          <span className="filter__val">
            {t(timeMode === 'site_local' ? 'time.siteLocal' : 'time.reference')}
          </span>
          <span className="filter__caret" aria-hidden="true">
            ▼
          </span>
        </button>
      </div>
    </header>
  );
}
