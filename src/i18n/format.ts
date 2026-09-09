import type { Lang } from './I18nProvider';

/**
 * Every date, time and number the application prints goes through this module.
 * No component calls Intl directly.
 *
 * The reason is one line further down: `th-TH` defaults to the Buddhist
 * calendar, so `Intl.DateTimeFormat('th-TH').format(d)` returns 4/8/2569, not
 * 4/8/2026. On a screen that sits next to SAP and InfluxDB timestamps that
 * either reads as a fault or, worse, is quietly misread. Forcing the Gregorian
 * calendar in one place is the whole defence.
 */

export function localeFor(lang: Lang): string {
  return lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB';
}

/* ----------------------------------------------------------------- numbers */

export function formatInt(value: number, lang: Lang): string {
  return new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 0 }).format(value);
}

export function formatPct(value: number, lang: Lang, digits = 1): string {
  return `${new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`;
}

/**
 * A signed gap against a goal, e.g. `-11.6`, `+2.4`, `-1,299`.
 *
 * `signDisplay: 'exceptZero'` rather than a hand-written '+' or '-', because the
 * minus sign is locale data - Intl emits the locale's own glyph and a hardcoded
 * one is wrong somewhere. Zero prints bare, which is what "exactly on target"
 * should look like: neither a win nor a miss.
 *
 * Pass `digits: 0` for a gap in whole units, such as a shortfall in pieces.
 */
export function formatSigned(value: number, lang: Lang, digits = 1): string {
  return new Intl.NumberFormat(localeFor(lang), {
    signDisplay: 'exceptZero',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatSeconds(value: number, lang: Lang): string {
  return `${new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}s`;
}

/* ------------------------------------------------------------------- time */

/**
 * A UTC instant rendered as wall-clock time in a specific zone, e.g. `15:42`.
 * Always pass the site's IANA zone - never a fixed offset (design doc 9.6).
 */
export function formatClock(isoUtc: string, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(isoUtc));
}

/** `04/08/2026 15:42` in the given zone. Gregorian even in Thai. */
export function formatDateTime(isoUtc: string, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(isoUtc));
}

/**
 * `15:42:07` in the given zone - the same as formatClock but to the second.
 *
 * Only the ranking's Date/Time column uses this. A per-second clock is the one
 * thing on the board that proves the screen itself is alive: nine bases showing
 * a frozen minute-precision time are indistinguishable from a hung browser, and
 * that ambiguity is what the design's ticking column removes.
 */
export function formatClockSeconds(isoUtc: string, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(isoUtc));
}

/**
 * `4 Aug` in the given zone - the trend axis when its window spans days.
 *
 * The axis prints clock times, which is right while the chart is a day wide and
 * useless the moment it is not: a seven-day chart ticks at midnight, and seven
 * labels all reading `00:00` tell a reader nothing about which midnight. No
 * weekday, unlike `formatWeekdayDate` - the axis is tight on width and the
 * chart's own tooltip carries the full instant.
 */
export function formatDayShort(isoUtc: string, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(isoUtc));
}

/**
 * `Tue, 4 Aug` in the given zone - the day half of the Date/Time column.
 *
 * The weekday is not decoration. STJ is four hours ahead of Bangkok and Mexico
 * eleven behind it, so at 08:00 in Ayutthaya the nine bases genuinely span three
 * calendar days. A bare time column would show that as three unexplained clocks.
 */
export function formatWeekdayDate(isoUtc: string, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(isoUtc));
}

/**
 * `September 2026` / `กันยายน 2026`, for a calendar's month heading.
 *
 * Month and year only, so it takes numbers rather than a date: the heading
 * belongs to a grid, and passing it the 1st to have the 1st thrown away invites
 * an off-by-one at the call site the day someone passes the wrong day.
 *
 * Gregorian, via `localeFor` - see the note at the top of this file. A Thai
 * calendar heading reading 2569 over a grid of Gregorian day numbers would be
 * the exact fault that note exists to prevent.
 */
export function formatMonthYear(year: number, month: number, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, 1));
}

/**
 * The seven weekday column heads, starting on `weekStart` (0 = Sunday).
 *
 * Built from a known week rather than from a hardcoded list, so Thai gets
 * `อา จ อ พ พฤ ศ ส` for nothing. 4 January 1970 was a Sunday, which is what
 * makes the offset arithmetic below trivial.
 */
export function weekdayLabels(lang: Lang, weekStart: 0 | 1): string[] {
  const fmt = new Intl.DateTimeFormat(localeFor(lang), { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(Date.UTC(1970, 0, 4 + ((i + weekStart) % 7))),
  );
}

/**
 * Which day a week starts on, per language: Monday for English, Sunday for
 * Thai.
 *
 * Hardcoded, deliberately. `Intl.Locale.prototype.getWeekInfo()` is the correct
 * source and it is not on every engine this board runs on - it landed in Safari
 * 17, and an iPad kept on 16 is exactly the deployment this project plans
 * around - so a feature test here would mean two different calendars depending
 * on how old the tablet is. Two locales, one line each, is the honest version
 * of the same data. `en-GB` starts on Monday (this is not a US board) and Thai
 * wall calendars start on Sunday.
 */
export function weekStartFor(lang: Lang): 0 | 1 {
  return lang === 'th' ? 0 : 1;
}

/** `4 Aug 2026`. Accepts a plain `YYYY-MM-DD` business date. */
export function formatDate(plainDate: string, lang: Lang): string {
  const [y, m, d] = plainDate.split('-').map(Number);
  return new Intl.DateTimeFormat(localeFor(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(y, m - 1, d));
}

/**
 * The wall-clock hour (0-23) of an instant in a zone.
 *
 * The trend axis puts a tick on every sixth hour of the zone it is being drawn
 * in - the site's own on a drill-down, the reference zone for a fleet total;
 * see src/state/useDisplayZone.ts - which means asking which hour a UTC instant
 * lands on there. Parsing it back out of
 * formatClock would work today and break the day someone passes a locale whose
 * hour field is not two ASCII digits, so the field is read from the parts.
 */
export function zoneHour(isoUtc: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoUtc));
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

/** Short zone abbreviation for a label, e.g. `ICT`, `JST`. */
export function zoneAbbrev(isoUtc: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(new Date(isoUtc));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

/**
 * A zone's current UTC offset, spelled the way a time picker spells it:
 * `UTC+07:00`.
 *
 * Not an abbreviation, and that is the point of having both. `ICT` is the right
 * label on a chart axis, where the reader wants to know which clock the ticks
 * are in and already knows where the sites are; an offset is the right one in
 * the time picker's footer, where the question is what "15:14" means against
 * the reader's own watch. Grafana prints the offset there for the same reason.
 *
 * `longOffset` yields `GMT+07:00`, and the plain `GMT` for UTC itself. Both are
 * rewritten: this is an engineering interface and it says UTC.
 *
 * Formatted for `now` rather than for a timestamp, because the caller is
 * describing a preference and not a reading. Zones with a DST rule therefore
 * report the offset in force today, which is the honest answer to "what does
 * the clock on this board mean".
 */
export function zoneOffset(timeZone: string, at: Date = new Date()): string {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  if (!name) return timeZone;
  return name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC');
}

/**
 * The same offset, compressed for a badge beside the window: `+07`, `-06`,
 * `+05:30`.
 *
 * The minutes survive when they are not zero. Half-hour and quarter-hour zones
 * are not a curiosity to be rounded off - India is UTC+05:30 and Nepal
 * UTC+05:45 - and a badge reading `+05` on a board anchored to either would be
 * wrong rather than merely short.
 */
export function zoneOffsetShort(timeZone: string, at: Date = new Date()): string {
  const full = zoneOffset(timeZone, at).replace('UTC', '');
  return full.endsWith(':00') ? full.slice(0, -3) : full;
}

/**
 * Relative age, e.g. `12 seconds ago` / `8 นาทีที่แล้ว`.
 *
 * Used for last_seen and the live badge. Note this formats an age the caller
 * already has - it does not decide whether that age counts as stale. That
 * decision belongs to the backend's freshness policy.
 */
export function formatAge(seconds: number, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto', style: 'long' });
  const s = Math.round(seconds);
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86_400), 'day');
}

/**
 * A length of time, as opposed to a point in the past: "4 minutes", "2 hours".
 *
 * `formatAge` above is not this, and reaching for it here produced exactly the
 * sentence that made this function necessary - "the board was not current for
 * 5 seconds ago". RelativeTimeFormat always renders a *when*; a gap is a *how
 * long*, and the two are only interchangeable in English at a glance.
 *
 * `Intl.NumberFormat` with a unit rather than `Intl.DurationFormat`, which is
 * still not in every browser this board is opened in - including the Safari on
 * the iPad the artboard is drawn for. The tiers match formatAge's, so a gap and
 * an age of the same length are described in the same words.
 */
export function formatGap(seconds: number, lang: Lang): string {
  const s = Math.max(0, Math.round(seconds));
  const [value, unit] =
    s < 60
      ? [s, 'second' as const]
      : s < 3600
        ? [Math.round(s / 60), 'minute' as const]
        : s < 86_400
          ? [Math.round(s / 3600), 'hour' as const]
          : [Math.round(s / 86_400), 'day' as const];

  return new Intl.NumberFormat(localeFor(lang), {
    style: 'unit',
    unit,
    unitDisplay: 'long',
  }).format(value);
}

/**
 * The same age, compressed to the artboard's "3s ago" / "8m ago".
 *
 * Note the locale. Everything else in this file formats English through
 * `en-GB`, because this is a Thai company and day-month order is what people
 * here read. But en-GB's *narrow* relative-time style is not narrow - it yields
 * "3 sec ago", "2 hr ago" - whereas en-US narrow yields exactly the "3s ago"
 * the badge is drawn to hold, and the badge shares one line with the title and
 * the language switch. This is the only string in the app that does not go
 * through localeFor(), and it contains no date at all, so the reason en-GB
 * exists does not apply to it.
 *
 * Thai is unaffected: it has one narrow form and Intl returns it either way.
 */
export function formatAgeShort(seconds: number, lang: Lang): string {
  const locale = lang === 'th' ? localeFor(lang) : 'en-US';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' });
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86_400), 'day');
}

/**
 * A duration such as `7:06:12`. Deliberately not localised - this is a stopwatch
 * reading, and operators compare them at a glance.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Accumulated downtime, such as `4h 12m` or `34m`.
 *
 * Coarser than formatDuration on purpose. That one is a stopwatch on a stop that
 * is still running, where the seconds are the point; this is a total over a
 * window, where seconds are false precision and cost a narrow column the width
 * it needs. Minutes are padded once hours appear so a column of them aligns.
 */
export function formatDowntime(seconds: number): string {
  const mins = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(mins / 60);
  return h === 0 ? `${mins}m` : `${h}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** Age in seconds between an ISO instant and now. */
export function ageSeconds(isoUtc: string, now: number = Date.now()): number {
  return (now - new Date(isoUtc).getTime()) / 1000;
}
