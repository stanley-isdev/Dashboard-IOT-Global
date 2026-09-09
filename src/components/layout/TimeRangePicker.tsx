import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Range } from '../../api/contract';
import { useMeta } from '../../api/queries';
import { useConfig } from '../../config/AppContext';
import { todayIn, type PlainDate } from '../../domain/plainDate';
/* The capsule and the trend panel's title name the same window, so they read it
   off one map rather than two that agree today. */
import { RANGE_SHORT as SHORT } from '../../domain/trendWindow';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatDate, zoneOffset, zoneOffsetShort } from '../../i18n/format';
import { usePrefs } from '../../state/prefsStore';
import { useFilters } from '../../state/useFilters';
import { DateRangeCalendar } from './DateRangeCalendar';

/**
 * The time control - Grafana's, deliberately, for the same reason the refresh
 * picker beside it is.
 *
 * This board is read next to a Grafana screen, and Grafana keeps the window and
 * the timezone in one control at the right-hand end of its toolbar: a clock, the
 * window in force, the zone offset, a chevron. What this replaces is two
 * controls in that slot - a three-segment 8h/24h/7d switch and a separate button
 * that toggled the timestamp anchor - which spent 300px saying what one capsule
 * now says, and neither of which was where a reader coming off the other screen
 * would look for it.
 *
 * ## What the panel can and cannot do
 *
 * The right-hand column lists the windows `/meta` advertises in `ranges`,
 * rather than a constant here, so a fourth window appears the day the backend
 * publishes it (`zRange` in the contract is the authority).
 *
 * The left-hand column is Grafana's absolute From/To, with the calendar behind
 * it: either field's calendar button opens the two-click month grid
 * (DateRangeCalendar), which fills both fields and offers only days the data
 * actually covers - nothing after today in the fleet's reference zone, and
 * nothing before `/meta`'s `window_limits.earliest_date`.
 *
 * Until a range is picked the fields print the window in force in Grafana's own
 * relative syntax (`now-24h` to `now`), which is the expression a reader would
 * paste into the other screen to line the two up.
 *
 * ## Both halves are real as of 2026-09-03
 *
 * They were not before, and the shape of that gap is worth keeping: the
 * endpoint took `range`, echoed it in `filters_applied` and read it nowhere, so
 * `8h`, `24h` and `7d` all returned the poller's fixed 24 h. Apply was shipped
 * disabled under a line saying so, because a button that accepted two dates and
 * quietly left the board on the last 24 hours is the failure this whole board
 * is built to avoid.
 *
 * What unblocked it was not the front end. BACKEND-HANDOVER §4.2 had recorded
 * windows past ~3 days failing with an empty-bodied HTTP 500 and no diagnosis;
 * re-measured, the instance names the cause - a per-query file-scan cap, not a
 * limit on how far back the data goes - so a wide window is servable as several
 * narrow ones. `/global-overview` now takes `from`/`to`, assembles the window
 * (server/src/services/windowedSnapshot.ts) and reports what it measured on
 * `window`, which is what this panel reads back.
 *
 * ## The two halves are one control
 *
 * A board cannot be on "Last 8h" and on "1-16 August" at once. Picking a quick
 * range clears the dates; applying dates un-ticks the quick list and puts the
 * dates in the capsule. The server resolves the pair ahead of `range` when both
 * arrive, and `window.source` on the response says which it used - so the
 * fallback after a rejected pair is visible rather than assumed.
 *
 * ## The footer
 *
 * Grafana's footer names the timezone the timestamps are in. Ours does that and
 * carries the one timezone preference this board actually models: each site's
 * own clock, or one reference zone for the whole fleet. Metrics never move -
 * every %OA is still computed against the site's own shift, whichever way this
 * is set - and the footer's own line says so, because a timezone control that
 * looks like it re-cuts the numbers is the dangerous kind.
 */

/** Grafana's relative expression for each served window, for the From field. */
const FROM_EXPR: Record<Range, string> = {
  '8h': 'now-8h',
  '24h': 'now-24h',
  '7d': 'now-7d',
};

const LONG: Record<Range, TKey> = {
  '8h': 'range.8h',
  '24h': 'range.24h',
  '7d': 'range.7d',
};

/** The contract's own enum, for the moment before meta lands. */
const SERVED: Range[] = ['8h', '24h', '7d'];

export function TimeRangePicker() {
  const { t, lang } = useI18n();
  const [filters, setFilters] = useFilters();
  const meta = useMeta();
  const cfg = useConfig();
  const timeMode = usePrefs((s) => s.timeMode);
  const setTimeMode = usePrefs((s) => s.setTimeMode);

  const [open, setOpen] = useState(false);
  /*
   * The pair the calendar is holding, seeded from whatever is in force.
   *
   * Draft state, deliberately: it is NOT the applied window. The two-click grid
   * passes through a half-picked state on the way to every range, and writing
   * that to the URL would refetch the board against "from 1 Aug to nothing" on
   * the first click of every pick. Apply is what promotes it.
   *
   * Seeded from the URL so re-opening the panel shows the window the board is
   * actually on rather than an empty grid - and so Apply can tell a real change
   * from a reader who opened the panel and closed it again.
   */
  const [abs, setAbs] = useState<{ start: PlainDate | null; end: PlainDate | null }>({
    start: filters.from,
    end: filters.to,
  });
  const [calOpen, setCalOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const range = filters.range;
  const served = meta.data?.ranges?.length ? meta.data.ranges : SERVED;
  /* The calendar's bounds and the query cap, from the server. Undefined until
     meta lands - every reader of it treats that as "no bound known yet" rather
     than substituting a guess. */
  const limits = meta.data?.window_limits;
  /* Today in the fleet's reference zone, not the browser's: the board's clock
     is the fleet's, and on an iPad left in a stand the two can differ by a day
     either side of midnight. It is both the calendar's upper bound and the day
     an unset To field stands for. */
  const today = todayIn(cfg.referenceTimezone);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }, []);

  /*
   * Re-seed the draft whenever the applied window changes underneath it.
   *
   * The URL is the state, and it can move without this control: Back, a shared
   * link, another panel calling `setFilters`. Without this the fields would go
   * on showing whatever was drafted in a previous life of the component, and
   * Apply would compare against it - so a reader who pressed Back would find
   * the button dead against dates the board is no longer on.
   *
   * Keyed on the applied pair only, so it never fights the reader mid-pick:
   * clicking a day changes `abs` and not `filters`, which leaves this effect
   * dormant until Apply.
   */
  const [seeded, setSeeded] = useState<[string | null, string | null]>([
    filters.from,
    filters.to,
  ]);
  if (seeded[0] !== filters.from || seeded[1] !== filters.to) {
    /* Adjusted DURING render rather than in an effect. React re-runs this
       component immediately with the new state and paints once; the effect form
       paints the stale draft first and then corrects it, which is the cascading
       render the lint rule is about. */
    setSeeded([filters.from, filters.to]);
    setAbs({ start: filters.from, end: filters.to });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  /* Focus opens on the window in force, which is both the useful default and
     where a reader who opened this with the keyboard expects to land. */
  useEffect(() => {
    if (!open) return;
    const items = itemsOf(list.current);
    (items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [open]);

  /*
   * Tab out closes it. The panel is a dialog rather than a menu - it holds a
   * radio group, two fields and a switch - so trapping Tab inside would be
   * wrong, and leaving the panel open behind a reader who has tabbed on to the
   * board is how a popover ends up covering the ranking nobody can see.
   */
  const onFocusOut = (e: React.FocusEvent) => {
    if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  };

  /*
   * Escape closes it and puts focus back on the trigger, from anywhere inside -
   * the radio group, a field, the switch in the footer. On the wrapper rather
   * than on the panel so it also fires while the trigger itself has focus.
   *
   * `stopPropagation` for the same reason the menus do it: the page has a
   * document-level key handler (the kiosk shortcut), and a key that has already
   * been consumed by the control in front of the reader should not reach it.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    /* The calendar first, if it is showing: Escape closes one layer at a time,
       so a reader who opened the grid by mistake does not lose the panel too. */
    if (calOpen) {
      e.stopPropagation();
      setCalOpen(false);
      return;
    }
    if (!open) return;
    e.stopPropagation();
    close(true);
  };

  /*
   * Arrows move focus and do not select.
   *
   * The WAI-ARIA radio pattern normally selects on arrow, and here that would
   * fire a query per keypress and repaint the whole board twice on the way to
   * the third row. Focus moves; Space or Enter commits. The same reason the
   * region menu stays open while ticking rather than closing on the first one.
   */
  const onListKey = (e: React.KeyboardEvent) => {
    const items = itemsOf(list.current);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };

  /** True while the board is showing a window the calendar picked. */
  const absoluteApplied = filters.from !== null && filters.to !== null;

  /**
   * Picking a quick range CLEARS the absolute pair.
   *
   * The two halves of this panel are one control, not two: a board cannot be on
   * "Last 8h" and on "1-16 Aug" at once, and the server resolves the pair ahead
   * of `range` whenever both are set. Leaving the dates behind would make "Last
   * 8h" a click that changed the capsule and nothing else - the exact defect
   * this whole change exists to remove, reintroduced from the other side.
   */
  const pick = (choice: Range) => {
    if (choice !== range || absoluteApplied) setFilters({ range: choice, from: null, to: null });
    setAbs({ start: null, end: null });
    close(true);
  };

  /*
   * Apply is live exactly when the draft is a complete pair that differs from
   * what the board is already showing.
   *
   * A start, because a window with no beginning is not a window. Not both ends,
   * though: the To field has a default printed in it and the From field does
   * not. Different, because a button that refetches the board against the
   * window it is already on is a control that looks broken - nothing changes
   * when it is pressed.
   *
   * Note what is NOT checked here: whether the window has data in it. That is a
   * fact about the database, the server answers it by clamping and saying so on
   * `window.clamped`, and a front end that tried to pre-judge it would need a
   * second copy of the retention rule to drift out of step with the first.
   */
  /*
   * An unset To means "now", because that is what the field says.
   *
   * The second click of the grid fills it; until then it prints `now`, and a
   * reader who picks one day and reads "24 Aug .. now" has named a window. The
   * panel refusing that with a dead button and nothing on screen saying why was
   * the defect - the field was making a promise Apply did not keep.
   *
   * It resolves to today in the reference zone, which is the same instant the
   * word means: the server reads the end day inclusively and caps it at the
   * current time (`resolveWindow` in windowedSnapshot.ts), so "to today" is "to
   * now" rather than "to midnight tonight".
   */
  const draftEnd = abs.end ?? (abs.start !== null ? today : null);

  const canApply =
    abs.start !== null &&
    draftEnd !== null &&
    (abs.start !== filters.from || draftEnd !== filters.to);

  const applyAbsolute = () => {
    if (!canApply) return;
    setFilters({ from: abs.start, to: draftEnd });
    setCalOpen(false);
    close(true);
  };

  /** Back to the quick range, dropping the absolute window. */
  const clearAbsolute = () => {
    setAbs({ start: null, end: null });
    if (absoluteApplied) setFilters({ from: null, to: null });
  };

  /*
   * Tinted when the reader has moved either half off its default - a window
   * other than 24h, or timestamps anchored to the reference zone instead of
   * each site's clock. Same rule as the three scope capsules to the left.
   */
  const off = range !== '24h' || absoluteApplied || timeMode !== 'site_local';

  /*
   * What the capsule says the board is on.
   *
   * With a calendar window applied it must print THAT, not the quick range
   * underneath it - the capsule is the only part of this control visible with
   * the panel shut, and a board reading "24 hours" while showing 1-16 August
   * is precisely the mislabelling the rest of this file is written against.
   *
   * Both ends, even when they are the same day: "16 Aug" alone would read as a
   * single day to some readers and as an open-ended window to others.
   */
  const capsule = absoluteApplied
    ? `${formatDate(filters.from!, lang)} – ${formatDate(filters.to!, lang)}`
    : t(SHORT[range]);

  return (
    <div className="timepicker" ref={wrap} onBlur={onFocusOut} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        /*
         * Two states, like every other capsule in the row.
         *
         * There were three: a date range is a dozen characters ("3 Sep – 30 Sep
         * 2026") against "Injection" or "Lamp 2", and while `.filter--on`
         * filled the capsule solid that width difference mattered - the same
         * treatment painted a band of brand orange across the toolbar wider
         * than every other control combined. This picker carried its own
         * quieter variant for that case.
         *
         * `.filter--on` is now an outline and an ink on the row's own ground,
         * which costs the same area at any width, so the exception has nothing
         * left to avoid and is gone. `off` is true whenever `absoluteApplied`
         * is, so the dates case is still flagged - by the one rule the whole
         * row uses.
         */
        className={['filter', off ? 'filter--on' : '', 'timepicker__trigger tap']
          .filter(Boolean)
          .join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('time.range')}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {/* A calendar when the window IS two dates, a clock when it is a
            rolling window. The icon is the fastest read on the capsule and it
            should not say "duration" over a pair of days. */}
        {absoluteApplied ? <CalendarIcon className="timepicker__icon" /> : <ClockIcon />}
        <span className="timepicker__val">{capsule}</span>
        {/*
         * The offset, as Grafana prints it, and only in reference mode. In
         * site-local mode there is no single offset to print - the nine bases
         * span UTC+01 to UTC-06 - and a "+07" beside nine local clocks would be
         * a straightforward lie.
         */}
        {timeMode === 'reference' ? (
          <span className="timepicker__zone">{zoneOffsetShort(cfg.referenceTimezone)}</span>
        ) : null}
        <span className="filter__caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="timepanel" id={panelId} role="dialog" aria-label={t('time.range')}>
          <div className="timepanel__cols">
            <section className="timepanel__abs">
              <h3 className="timepanel__title">{t('time.absolute')}</h3>

              {/*
               * `readOnly` rather than `disabled`, now that the calendar fills
               * them: a disabled field reads as "nothing can happen here", and
               * something can. They are not typeable, though, and that is a
               * decision rather than an omission - parsing a hand-typed date
               * means guessing between 09/02 and 02/09, and the grid beside it
               * cannot be misread.
               */}
              <label className="timepanel__field">
                <span className="timepanel__label">{t('time.from')}</span>
                <span className="timepanel__input">
                  <input
                    type="text"
                    value={abs.start ? formatDate(abs.start, lang) : FROM_EXPR[range]}
                    readOnly
                    onFocus={() => setCalOpen(true)}
                  />
                  <button
                    type="button"
                    className="timepanel__cal tap"
                    aria-label={t('time.openCalendar')}
                    aria-expanded={calOpen}
                    onClick={() => setCalOpen((v) => !v)}
                  >
                    <CalendarIcon />
                  </button>
                </span>
              </label>
              <label className="timepanel__field">
                <span className="timepanel__label">{t('time.to')}</span>
                <span className="timepanel__input">
                  <input
                    type="text"
                    value={abs.end ? formatDate(abs.end, lang) : 'now'}
                    readOnly
                    onFocus={() => setCalOpen(true)}
                  />
                  <button
                    type="button"
                    className="timepanel__cal tap"
                    aria-label={t('time.openCalendar')}
                    aria-expanded={calOpen}
                    onClick={() => setCalOpen((v) => !v)}
                  >
                    <CalendarIcon />
                  </button>
                </span>
              </label>

              {/* Live from 2026-09-03. Disabled only while the draft is
                  incomplete or unchanged - never because the backend cannot
                  serve it. See the note at the top of this file. */}
              <button
                type="button"
                className="timepanel__apply"
                disabled={!canApply}
                onClick={applyAbsolute}
              >
                {t('time.apply')}
              </button>

              {/*
               * The note under the button says what the window will cost, not
               * what it cannot do.
               *
               * A window wider than one query is assembled from several (the
               * server's MAX_QUERY_HOURS), and that is the honest reason a
               * seven-day board takes longer to paint than the default one. A
               * reader who is told nothing assumes the board has hung.
               */}
              {absoluteApplied ? (
                <p className="timepanel__note">
                  {t('time.absoluteActive')}{' '}
                  <button type="button" className="timepanel__link" onClick={clearAbsolute}>
                    {t('time.backToQuick')}
                  </button>
                </p>
              ) : chunksFor(abs, limits) > 1 ? (
                <p className="timepanel__note">
                  {t('time.absoluteChunks', { n: chunksFor(abs, limits) })}
                </p>
              ) : null}
            </section>

            <section className="timepanel__quick">
              <h3 className="timepanel__title" id={`${panelId}-quick`}>
                {t('time.quick')}
              </h3>
              <div
                className="timepanel__list"
                role="radiogroup"
                aria-labelledby={`${panelId}-quick`}
                ref={list}
                onKeyDown={onListKey}
              >
                {served.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    /*
                     * Nothing is ticked while a calendar window is in force.
                     * `range` still holds the window this would fall back to,
                     * but the board is not on it, and a panel showing a tick
                     * beside "Last 24h" AND dates in the fields to its left is
                     * telling the reader two different things about one board.
                     */
                    aria-checked={!absoluteApplied && r === range}
                    className="timepanel__opt"
                    /* One stop for the whole group: the arrows walk it from
                       here, which is what a radio group promises. */
                    tabIndex={r === range ? 0 : -1}
                    onClick={() => pick(r)}
                  >
                    <span>{t(LONG[r])}</span>
                    <span className="timepanel__check" aria-hidden="true">
                      {!absoluteApplied && r === range ? '✓' : ''}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {calOpen ? (
            <DateRangeCalendar
              start={abs.start}
              end={abs.end}
              max={today}
              /* The retention floor, served on /meta rather than assumed here.
                 Undefined until meta lands, which leaves the grid unbounded
                 below for that moment - the server clamps and says so, so the
                 worst case is a warning rather than a wrong board. */
              min={limits?.earliest_date}
              onPick={setAbs}
              onClear={clearAbsolute}
              onClose={() => setCalOpen(false)}
            />
          ) : null}

          <div className="timepanel__foot">
            {/*
             * The zone *and* the promise about the metrics, in both modes.
             *
             * Grafana's footer prints the zone alone, and it can: nothing in
             * Grafana's toolbar re-cuts a shift. Here the sentence is the point.
             * `time.referenceNote` was written for this row and had never been
             * rendered anywhere, which is why the reference mode used to say
             * only "Asia/Bangkok" - the mode where a reader is most likely to
             * assume the numbers moved with the clock.
             */}
            <span className="timepanel__zoneline">
              {timeMode === 'reference'
                ? t('time.referenceNote', {
                    tz: `${cfg.referenceTimezone} (${zoneOffset(cfg.referenceTimezone)})`,
                  })
                : t('time.siteLocalNote')}
            </span>

            <div className="timepanel__seg" role="group" aria-label={t('filter.time')}>
              <button
                type="button"
                className="timepanel__segbtn"
                aria-pressed={timeMode === 'site_local'}
                onClick={() => setTimeMode('site_local')}
              >
                {t('time.siteLocal')}
              </button>
              <button
                type="button"
                className="timepanel__segbtn"
                aria-pressed={timeMode === 'reference'}
                onClick={() => setTimeMode('reference')}
              >
                {t('time.reference')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * How many InfluxDB queries the drafted window will take.
 *
 * The same arithmetic the server does, and duplicated on purpose: this runs
 * BEFORE the request, to warn a reader that the window they are about to apply
 * is an expensive one. Reading it off the response instead would mean the
 * warning arrived with the slow board it was meant to predict.
 *
 * `max_query_hours` comes from `/meta`, so the two cannot drift on the number
 * itself - only on the moment it is applied. Returns 1 while meta is still in
 * flight, which suppresses the note rather than guessing at it.
 */
function chunksFor(
  abs: { start: PlainDate | null; end: PlainDate | null },
  limits: { max_query_hours: number } | undefined,
): number {
  if (!abs.start || !abs.end || !limits) return 1;
  const from = Date.parse(`${abs.start}T00:00:00Z`);
  // Inclusive end day, matching the server's resolveWindow.
  const to = Date.parse(`${abs.end}T00:00:00Z`) + 86_400_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 1;
  return Math.max(1, Math.ceil((to - from) / 3_600_000 / limits.max_query_hours));
}

function itemsOf(root: HTMLElement | null): HTMLButtonElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLButtonElement>('[role="radio"]')) : [];
}

/**
 * The month grid's glyph - on each of the two fields' buttons, and on the
 * capsule itself once a pair of dates is what the board is on.
 *
 * The class is a parameter for that second use: the two places size and colour
 * it differently, and the capsule's copy has to inherit the same rules the
 * clock it replaces does or it will not follow the type into kiosk density.
 */
function CalendarIcon({ className = 'timepanel__calicon' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/**
 * Grafana's clock. Stroked in currentColor and sized in `em`, so it follows the
 * capsule's type at kiosk density like the board tabs' icons do.
 */
function ClockIcon() {
  return (
    <svg
      className="timepicker__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5l3.5 2" />
    </svg>
  );
}
