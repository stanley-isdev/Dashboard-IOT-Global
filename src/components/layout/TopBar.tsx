import { Link } from 'react-router';
import type { CSSProperties } from 'react';
/*
 * Both inks of the one lockup - the supplied artwork as drawn, and the same
 * file with the wordmark's black swapped for the dark board's body ink. The
 * infinity is untouched in both; only the type changes colour.
 *
 * Imported rather than written into the stylesheet as `url(/brand/...)`,
 * because this app can be served under a sub-path (VITE_BASE_PATH) and Vite
 * rewrites an import against that base where it leaves a root-absolute url()
 * in CSS alone. Which of the two is painted is still a stylesheet decision -
 * see .brand__mark - so no component has to know the theme.
 */
import logoOnLight from '/brand/one-stanley-narong-pat-global.png';
import logoOnDark from '/brand/one-stanley-narong-pat-global-on-dark.png';
import type { ConnectionInfo } from '../../domain/connectionState';
import { useI18n } from '../../i18n/I18nProvider';
import { usePrefs } from '../../state/prefsStore';
import { useLinkWithFilters } from '../../state/useFilters';
import { Breadcrumb } from './Breadcrumb';
import { useMastheadCrumbs } from './useMastheadCrumbs';
import { LanguagePicker } from './LanguagePicker';
import { ExportButton } from './ExportButton';
import { LiveBadge } from './LiveBadge';
import { PlantFilter } from './PlantFilter';
import { ProcessFilter } from './ProcessFilter';
import { RefreshPicker } from './RefreshPicker';
import { RegionFilter } from './RegionFilter';
import { ThemeToggle } from './ThemeToggle';
import { TimeRangePicker } from './TimeRangePicker';

/**
 * Brand, freshness, language, and the filter row.
 *
 * Two bands, as drawn. The masthead is one line - the logo lockup, then the
 * live/language cluster pushed right - and the filter row is its own
 * full-width line below it. That separation is what makes the controls read as
 * "these scope everything under here" instead of as more header furniture.
 *
 * The right-hand end of the filter row is the refresh picker and the time
 * picker, in that order, and both of them are Grafana's controls on purpose -
 * see the notes on each. It took two passes to get there. The artboard draws a
 * "7 days / 1 month / 3 months" segment *and* a "Time range" dropdown beside
 * it, which is the same control twice; the first pass kept the segment for the
 * three windows the API actually serves (zRange) and gave the dropdown slot to
 * the timestamp anchor, and the second folded both into one picker, which is
 * where Grafana keeps them and what the two controls together always were.
 *
 * Nothing sits under the wordmark any more. The nine-base list went first -
 * the artboard drops it, and the coverage it carried ("6 of 9 connected") is
 * now the first KPI card's caption, next to the number it qualifies - and the
 * copyright line that outlived it has followed. A masthead is where a reader
 * looks for what this board is showing and how fresh it is; a legal notice
 * answers neither question, and the tallest band on the screen was spending a
 * whole text row on it.
 */
/* The trail lives in useMastheadCrumbs.ts: the Export button reads it too, so
   it cannot be a second export from a file of components. */

export function TopBar({ connection }: { connection: ConnectionInfo }) {
  const { t } = useI18n();
  const link = useLinkWithFilters();
  const crumbs = useMastheadCrumbs();
  const kiosk = usePrefs((s) => s.kiosk);
  const toggleKiosk = usePrefs((s) => s.toggleKiosk);

  /*
   * The filter row comes off a board that has nothing on it.
   *
   * With no payload every control in this row is furniture: Region, Lamp and
   * Process all narrow a set that does not exist, Export photographs a blank,
   * and the two range controls re-ask a question the server is failing to
   * answer. Eight tappable capsules that do nothing is worse than none - a reader
   * presses them, watches nothing happen, and concludes the whole board is
   * frozen rather than that one service is down. What is left is the masthead,
   * which still says whose board this is, how fresh it is not, and how to get
   * out - and the state page below, which says what is actually wrong.
   *
   * `timeout` is the exception and the reason `errorKind` is published up here
   * at all. There the window in force is very likely the cause, so the time
   * picker is not furniture, it is the fix; the state page offers a one-tap
   * "last 24 hours" beside it for the common case, and this row is what serves
   * the reader who wants a different window instead.
   *
   * Only `cold_fail` - never `cold`. A first load is not a failure, the filters
   * are legitimately usable while it runs, and taking the row away for the
   * second or two the board is warming up would flash it off and back on at
   * every visit.
   */
  const dead = connection.state === 'cold_fail' && connection.errorKind !== 'timeout';

  return (
    <header className="topbar">
      <div className="topbar__masthead">
        {/*
         * The lockup, whole: the infinity and the wordmark beside it, exactly as
         * the artwork is drawn.
         *
         * It used to be the mark alone with "One Stanley / Narong-Pat Global"
         * set as live text next to it, because the wordmark inside the old file
         * was black on a white plate and had to be cropped off to survive the
         * dark board. Two files solve that instead of a crop: the artwork as
         * supplied for the white band, and one whose type is recoloured to the
         * dark board's ink. The type is drawn by the designer either way,
         * which is the point - the letterforms, the tracking and the orange E
         * are the logo, and no font on this board reproduces them.
         *
         * The name a screen reader, a find-in-page and the accessible name of
         * this link get is the <h1> text below, which is still the whole of
         * app.title. That is why the artwork is a background rather than an
         * <img>: one accessible name, not two.
         */}
        <h1 className="brand">
          <Link className="brand__link" to={link('/overview')}>
            <span
              className="brand__mark"
              /* The two files, handed to the stylesheet; the theme picks. */
              style={
                {
                  '--brand-logo-on-light': `url(${logoOnLight})`,
                  '--brand-logo-on-dark': `url(${logoOnDark})`,
                } as CSSProperties
              }
            />
            <span className="visually-hidden">{t('app.title')}</span>
          </Link>
        </h1>

        {/*
         * The middle of the band: where you are, on the drill-downs.
         *
         * Always rendered, even on the overview where the trail is empty,
         * because this is also the flexible cell that pushes the utility
         * cluster to the right edge. Take it out on one route and the cluster
         * slides in against the wordmark on that route only.
         */}
        <div className="topbar__crumbs">
          {crumbs.length > 0 ? <Breadcrumb trail={crumbs} /> : null}
        </div>

        <div className="topbar__utility">
          {/*
           * Freshness, language, appearance. Three separate capsules on one
           * line rather than one box holding all of them: the first is a
           * readout and the other two are switches, and a shared border would
           * invite the question of what tapping the left third does.
           *
           * The theme switch goes last, after the language menu. It is the
           * least consequential of the three - it changes how the board looks
           * and nothing about what it says - and putting it on the outside
           * keeps the two things a viewer might actually need mid-shift, the
           * freshness state and the language, nearer the title they belong to.
           */}
          <div className="statusbar">
            <LiveBadge info={connection} />

            {/*
             * One capsule saying "Language", dropping a menu of the two locale
             * names in their own scripts. It replaces a TH/EN tile pair - see
             * LanguagePicker.tsx for why the pair's argument does not carry over
             * to a menu, and why the locale names are never translated.
             */}
            <LanguagePicker />

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

      {/*
       * Unmounted rather than hidden. `hidden` would keep the row's height in
       * the shell's flex column, leaving a band of empty page above a state
       * page that is already deliberately short - and unlike the map, none of
       * these controls has any state worth preserving across the gap, because
       * all of it lives in the URL.
       */}
      {dead ? null : (
      <div className="topbar__filters">
        {/*
          One filter row, above everything it scopes. Per-panel filters are how
          a page ends up with two panels summing over different sets and no way
          to tell from the screen.

          Region scopes to companies; Lamp scopes to plants inside them, and the
          two intersect. Lamp exists because the operator boards are per plant -
          without it, "THS 30" and "Lamp 2: 29" look like a disagreement instead
          of two different questions.

          Process is wired now: THS 6332 runs 26 Injection machines and 3
          Surface, and the plant board is Injection-only, so without it the two
          screens counted different machines. Set it to Injection to read this
          board against that one.
        */}
        <RegionFilter />

        <PlantFilter />

        <ProcessFilter />

        <span className="topbar__filters-spacer" />

        {/*
         * Left of the time picker - the same place Grafana puts it, and for the
         * same reason the picker itself is Grafana's: a reader coming off the
         * plant board looks for the refresh interval where that screen keeps
         * it, which is here.
         */}
        <RefreshPicker />

        {/*
         * The window and the timezone, in one control. Both halves used to sit
         * here as two - a three-segment switch and a button that toggled the
         * anchor - and the picker replaces them; the metrics never move either
         * way, which its own footer says.
         */}
        <TimeRangePicker />

        {/*
         * Last on the row, and the only filled control on the board.
         *
         * It exports what the four controls to its left have scoped, so it
         * reads correctly only at this end: after them. The board's own rule
         * about the accent applies - orange says "you did this" and never
         * carries a status - and a filled capsule at the end of a row of
         * outlined ones says "this is the action", which is a fifth thing
         * again from either.
         */}
        <ExportButton />
      </div>
      )}
    </header>
  );
}
