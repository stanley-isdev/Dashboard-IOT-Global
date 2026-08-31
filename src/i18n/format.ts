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
 * The trend axis puts a tick on every sixth hour of the *reference* zone, which
 * means asking which hour a UTC instant lands on there. Parsing it back out of
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
