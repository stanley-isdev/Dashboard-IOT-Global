/**
 * Calendar dates, as dates rather than as instants.
 *
 * The date picker deals in `YYYY-MM-DD`: what a reader means by "1 September"
 * is a day on a wall calendar, not a moment. Turning one into an instant needs
 * a timezone, and which timezone is a question only the thing *querying* can
 * answer - so that conversion is deliberately not here. This module is the
 * arithmetic and nothing else.
 *
 * Every operation goes through UTC midnight internally. A local `new Date(y, m,
 * d)` would work for eleven months of the year and then hand back the 30th when
 * asked for the 31st, in whichever zone moved its clocks that night; UTC has no
 * DST, so `addDays` cannot drift.
 *
 * ISO plain dates sort and compare as strings, which is why `compare` is a
 * string comparison and there is no `isBefore`: `a <= p && p <= b` reads
 * correctly on the values themselves at the call site.
 */

/** A calendar date, `YYYY-MM-DD`. Zero-padded, always ten characters. */
export type PlainDate = string;

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026, 9, 2` -> `2026-09-02`. Month is 1-based, the way a human writes it. */
export function toPlain(year: number, month: number, day: number): PlainDate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function partsOf(date: PlainDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

/** UTC midnight of a plain date, for arithmetic and for weekday lookups. */
function utcOf(date: PlainDate): Date {
  const { year, month, day } = partsOf(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function plainOf(utc: Date): PlainDate {
  return toPlain(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function addDays(date: PlainDate, days: number): PlainDate {
  const d = utcOf(date);
  d.setUTCDate(d.getUTCDate() + days);
  return plainOf(d);
}

/**
 * Month arithmetic that clamps rather than rolls over.
 *
 * `setUTCMonth` on the 31st of January with `+1` yields 3 March, because there
 * is no 31 February - so a reader pressing "next month" from a day that does
 * not exist in the next one would skip it entirely. The day is pinned to 1
 * here, since every caller is moving the *grid* and not a selection.
 */
export function addMonths(year: number, month: number, months: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + months;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday, the way `Date` counts. */
export function weekdayOf(date: PlainDate): number {
  return utcOf(date).getUTCDay();
}

/** `-1`, `0` or `1`. ISO plain dates compare lexicographically. */
export function compare(a: PlainDate, b: PlainDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive, and indifferent to which way round the pair is given. */
export function isBetween(date: PlainDate, a: PlainDate, b: PlainDate): boolean {
  const [lo, hi] = compare(a, b) <= 0 ? [a, b] : [b, a];
  return lo <= date && date <= hi;
}

/**
 * Today, in a named zone.
 *
 * The zone matters: a reader in Bangkok and a board anchored to Bangkok agree,
 * but the browser's own clock is not the fleet's, and "today" is what the
 * picker refuses to let anyone select past. `en-CA` is the shortest route to
 * ISO output from Intl - it formats as `2026-09-02` natively - and the calendar
 * is forced to Gregorian for the same reason everything in i18n/format.ts is.
 */
export function todayIn(timeZone: string, now: Date = new Date()): PlainDate {
  return new Intl.DateTimeFormat('en-CA-u-ca-gregory', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The 42 cells of a month grid: the month itself, padded at both ends with the
 * days of the neighbouring months that share its first and last weeks.
 *
 * Six rows always, never five or four. A grid that changes height as the reader
 * pages through the year moves the buttons under their finger, and a picker
 * inside a popover would resize the popover with it.
 *
 * `weekStart` is 0 for Sunday or 1 for Monday - locale data, passed in rather
 * than decided here.
 */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): PlainDate[] {
  const first = toPlain(year, month, 1);
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function isInMonth(date: PlainDate, year: number, month: number): boolean {
  const p = partsOf(date);
  return p.year === year && p.month === month;
}
