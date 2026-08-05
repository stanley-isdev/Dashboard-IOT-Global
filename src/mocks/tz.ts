/**
 * Timezone helpers for the mock adapter.
 *
 * IMPORTANT: this file is standing in for the backend. Nothing under
 * src/mocks/ may be imported by a component, a page, or anything under
 * src/domain — shift resolution and production-date anchoring are business
 * logic and belong on the server (design doc sections 7, 9.5, 9.6). They live
 * here only so the UI can be built and proven before the API exists.
 *
 * Everything below uses Intl with an IANA zone name, never a fixed offset.
 * Section 9.6 records that the existing `TzOffsetHours` variable (7, 0, -5, -4,
 * 9) is wrong twice a year for the US, Hungary and Mexico sites and wrong
 * year-round for Vietnam, Indonesia and Mexico.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `instant` as observed in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

const offsetCache = new Map<string, Intl.DateTimeFormat>();

/** UTC offset in effect at `instant` for `timeZone`, as `+07:00` / `-05:00`. */
export function offsetString(instant: Date, timeZone: string): string {
  let f = offsetCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    offsetCache.set(timeZone, f);
  }
  const name = f.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const raw = name.replace('GMT', '').trim();
  return raw === '' ? '+00:00' : raw;
}

/** Offset in minutes, positive east of Greenwich. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const s = offsetString(instant, timeZone);
  const sign = s.startsWith('-') ? -1 : 1;
  const [h, m] = s.slice(1).split(':').map(Number);
  return sign * (h * 60 + (m || 0));
}

/**
 * The UTC instant whose wall-clock time in `timeZone` is the given fields.
 *
 * Two passes: the offset needed to convert depends on the instant we are trying
 * to find, so we guess with the offset at the naive instant and then correct.
 * A second pass settles every case except the ambiguous hour of a DST fall-back,
 * where either answer is defensible and we take the first.
 */
export function zonedToUtc(p: ZonedParts, timeZone: string): Date {
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** ISO-8601 with the zone's own offset, e.g. `2026-08-04T22:15:00+09:00`. */
export function toIsoOffset(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00` +
    offsetString(instant, timeZone)
  );
}

/** `YYYY-MM-DD` as observed in `timeZone`. */
export function toPlainDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight. */
export function minutesOfDay(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/** Parse `HH:MM` to minutes since midnight. */
export function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}
