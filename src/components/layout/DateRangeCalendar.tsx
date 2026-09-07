import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  compare,
  daysInMonth,
  isBetween,
  isInMonth,
  monthGrid,
  partsOf,
  toPlain,
  type PlainDate,
} from '../../domain/plainDate';
import { useI18n } from '../../i18n/I18nProvider';
import { formatDate, formatMonthYear, weekdayLabels, weekStartFor } from '../../i18n/format';

/**
 * The two-click date range calendar, as the time picker's absolute half.
 *
 * ## Two clicks, not two fields
 *
 * First click sets the start and clears whatever was there, second click sets
 * the end, third starts again. That is the redraw's own instruction - it prints
 * "First click = start date · click again = end date" under the grid - and it
 * is also the only interaction that works on a tablet with no keyboard: a pair
 * of typed fields needs a keyboard and a date format the reader has to guess.
 *
 * Clicking a day *before* the start is not an error and does not start over:
 * the pair is stored as picked and normalised on the way out, so dragging
 * backwards through the month works the way a reader expects rather than
 * resetting under their hand.
 *
 * ## What it refuses
 *
 * Days after `max` - today in the fleet's reference zone - are disabled. The
 * board reads what the machines have already done; a window ending next Tuesday
 * has no data in it, and a picker that accepts one is a control that produces
 * an empty board and no explanation.
 *
 * Days before `min` are disabled for the same reason from the other end. The
 * instance holds about four weeks (`/meta`'s `window_limits.earliest_date`,
 * measured rather than configured), and a grid that let a reader page back to
 * 2019 would hand them a fortnight the database dropped years ago. `min` is
 * optional and the grid is unbounded below without it - for the moment before
 * `/meta` lands, the server's own clamp is the backstop.
 *
 * ## Keyboard
 *
 * A grid with a roving tabindex: one tab stop for the whole month, arrows to
 * move within it, PageUp/PageDown for months, Home/End for the ends of a week.
 * That is the WAI-ARIA grid pattern, and the reason it is not 42 tab stops is
 * that 42 tab stops is not navigation, it is a maze.
 */
export function DateRangeCalendar({
  start,
  end,
  max,
  min,
  onPick,
  onClear,
  onClose,
}: {
  start: PlainDate | null;
  end: PlainDate | null;
  /** The last selectable day, inclusive. */
  max: PlainDate;
  /** The first selectable day, inclusive. Unbounded when absent. */
  min?: PlainDate;
  onPick: (next: { start: PlainDate | null; end: PlainDate | null }) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const grid = useRef<HTMLDivElement>(null);

  /*
   * One piece of state for the whole grid: the day the keyboard is on.
   *
   * The month on screen is *derived* from it rather than stored beside it. Two
   * states would mean keeping them in step - an effect that watched the cursor
   * and moved the view, which is a setState inside an effect and a render the
   * reader can see - and there is no state the two are meant to disagree in:
   * paging to March and leaving the cursor in January would put the arrows
   * somewhere off screen.
   *
   * It opens on the picked start, or on `max` (today) when nothing is picked,
   * which is the month a reader is nearly always reaching for.
   *
   * The cursor selects nothing on its own. Moving it must not change the
   * window, or a reader cannot look at last month without applying it.
   */
  const [cursor, setCursor] = useState<PlainDate>(start ?? max);
  const view = partsOf(cursor);

  const weekStart = weekStartFor(lang);
  const heads = useMemo(() => weekdayLabels(lang, weekStart), [lang, weekStart]);
  const days = useMemo(
    () => monthGrid(view.year, view.month, weekStart),
    [view.year, view.month, weekStart],
  );

  /* Keep the DOM focus on the cursor's cell while the focus is inside this grid,
     so the arrows keep working after the month has changed under them. Not
     while it is outside: stealing focus into a calendar nobody is typing in
     would take it off whatever they are. */
  useEffect(() => {
    const cell = grid.current?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`);
    if (cell && grid.current?.contains(document.activeElement)) cell.focus();
  }, [cursor, days]);

  /* Held inside [`min`, `max`]: the cursor is what Enter commits, so letting it
     walk off either end would smuggle a day the board cannot answer for into a
     range - the future at one end, data the instance has dropped at the other. */
  const moveTo = (date: PlainDate) => {
    if (compare(date, max) > 0) return setCursor(max);
    if (min && compare(date, min) < 0) return setCursor(min);
    setCursor(date);
  };

  const step = (byDays: number) => moveTo(addDays(cursor, byDays));

  /*
   * A month step keeps the day of the month where it can, and clamps where it
   * cannot: from 31 January, "next month" is 28 February and not 3 March, which
   * is where date arithmetic lands by default. The chevrons and PageUp/PageDown
   * are the same operation and share this.
   */
  const shift = (months: number) => {
    const m = addMonths(view.year, view.month, months);
    moveTo(toPlain(m.year, m.month, Math.min(view.day, daysInMonth(m.year, m.month))));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const by: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in by) {
      e.preventDefault();
      step(by[e.key]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      /* The ends of the cursor's own week, in the locale's week order - which is
         why the offset is read off the grid rather than from the weekday. */
      const offset = days.indexOf(cursor) % 7;
      step(e.key === 'Home' ? -offset : 6 - offset);
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      shift(e.key === 'PageUp' ? -1 : 1);
    }
  };
  const pick = (date: PlainDate) => {
    /* No start, or a complete pair: begin a new range. One end: close it, and
       order the pair so a backwards pick is a range rather than a mistake. */
    if (!start || end) {
      onPick({ start: date, end: null });
      return;
    }
    onPick(compare(date, start) < 0 ? { start: date, end: start } : { start, end: date });
  };

  return (
    <div className="calendar">
      <div className="calendar__head">
        <h4 className="calendar__title">{t('time.selectRange')}</h4>
        <button
          type="button"
          className="calendar__close tap"
          onClick={onClose}
          aria-label={t('time.closeCalendar')}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="calendar__month">
        <button
          type="button"
          className="calendar__nav tap"
          onClick={() => shift(-1)}
          aria-label={t('time.prevMonth')}
        >
          <span className="calendar__navchev calendar__navchev--prev" aria-hidden="true" />
        </button>
        {/* `aria-live` so a screen reader hears the month it has just paged to;
            the grid below it does not announce its own heading. */}
        <span className="calendar__label" aria-live="polite">
          {formatMonthYear(view.year, view.month, lang)}
        </span>
        <button
          type="button"
          className="calendar__nav tap"
          onClick={() => shift(1)}
          aria-label={t('time.nextMonth')}
        >
          <span className="calendar__navchev" aria-hidden="true" />
        </button>
      </div>

      <div className="calendar__heads" aria-hidden="true">
        {heads.map((h) => (
          <span key={h} className="calendar__weekday">
            {h}
          </span>
        ))}
      </div>

      {/*
       * `role="grid"` with one tab stop, per the note at the top. The cells are
       * buttons rather than gridcells with a nested widget: a day is one
       * target, and a button is what a tablet's assistive technology already
       * knows how to activate.
       */}
      <div
        className="calendar__grid"
        role="grid"
        aria-label={t('time.selectRange')}
        ref={grid}
        onKeyDown={onKeyDown}
      >
        {days.map((date) => {
          const own = isInMonth(date, view.year, view.month);
          const disabled =
            compare(date, max) > 0 || (min !== undefined && compare(date, min) < 0);
          const isStart = date === start;
          const isEnd = date === end;
          const inside = start && end ? isBetween(date, start, end) : false;
          const classes = ['calendar__day'];
          if (!own) classes.push('calendar__day--outside');
          if (inside) classes.push('calendar__day--inside');
          if (isStart || isEnd) classes.push('calendar__day--edge');
          if (date === max) classes.push('calendar__day--today');
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              data-date={date}
              className={classes.join(' ')}
              disabled={disabled}
              /* One stop for the grid: the cursor's cell. */
              tabIndex={date === cursor ? 0 : -1}
              aria-selected={isStart || isEnd || inside}
              /* The full date, because "14" alone tells a screen-reader user
                 nothing about which month they have paged to. */
              aria-label={formatDate(date, lang)}
              onFocus={() => setCursor(date)}
              onClick={() => pick(date)}
            >
              {partsOf(date).day}
            </button>
          );
        })}
      </div>

      <div className="calendar__foot">
        <p className="calendar__hint">{t('time.pickHint')}</p>
        <button
          type="button"
          className="calendar__clear"
          onClick={onClear}
          disabled={!start && !end}
        >
          {t('time.clear')}
        </button>
      </div>
    </div>
  );
}
