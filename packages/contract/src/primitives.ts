import { z } from 'zod';

/**
 * Scalar building blocks for the API contract.
 *
 * Two rules are enforced here rather than by convention, because both have
 * already caused real defects in the Grafana dashboards this app replaces:
 *
 * R1 - every instant is UTC with a trailing `Z`.
 *   The design doc's section 13 example mixes `+07:00` (generated_at, last_seen)
 *   with `Z` (trend[].ts, alerts[].started_at) inside one payload. Mixed
 *   conventions are the classic source of an off-by-seven-hours bug. Companies
 *   carry an IANA `timezone` and the UI formats with Intl.DateTimeFormat.
 *
 * R2 - "we don't know" is `null`, never `0`.
 *   `oa_pct: 0` means a genuine zero. `oa_pct: null` means unknown. NFR
 *   section 14 forbids ever rendering a fabricated zero, and the only reliable
 *   way to hold that line is to make the absence representable in the type.
 */

/** UTC instant, e.g. `2026-08-04T03:15:00Z`. Never a local offset. */
export const zIsoUtc = z.iso.datetime();

/**
 * A local wall-clock instant carrying its own offset, e.g.
 * `2026-08-04T22:15:00+09:00`. Used only for shift boundaries, which are
 * semantically local - a shift starts at 22:15 *there*, not at some UTC moment.
 */
export const zIsoOffset = z.iso.datetime({ offset: true });

/**
 * A business date, e.g. `2026-08-04`. Not an instant: STJ's C shift starts at
 * 22:15 and runs past midnight, so its production date is not "today" in any
 * clock sense. The backend applies `production_date_anchor` and sends the answer.
 */
export const zPlainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** A percentage, or null when unknown. See R2. */
export const zPct = z.number().nullable();

/** A quantity, or null when unknown. See R2. */
export const zQty = z.number().nullable();

/** A count that is always known (a roll-up of rows the backend did have). */
export const zCount = z.number().int().nonnegative();

/**
 * A duration in seconds, or null when unknown. See R2 - and here the
 * distinction is the whole point of the field. `downtime_sec: 0` means the site
 * reported and had no stop in the window; `null` means nobody measured. Those
 * render as "none" and "-" respectively, and a board that conflates them tells
 * an executive that six un-commissioned sites are running perfectly.
 */
export const zDurationSec = z.number().int().nonnegative().nullable();

/**
 * IANA zone name such as `Asia/Bangkok`. Never a fixed offset: section 9.6
 * records that the existing `TzOffsetHours` variable (7, 0, -5, -4, 9) silently
 * breaks for the US, Hungary and Mexico sites twice a year, and is wrong
 * year-round for Vietnam, Indonesia and Mexico.
 */
export const zIanaTz = z.string().min(3).includes('/');

/** ISO 3166-1 alpha-2, upper case. Used as the flag key and the country roll-up key. */
export const zCountryCode = z.string().length(2).toUpperCase();

/** `HH:MM`, minute precision. STJ's B shift ends at 22:15, so hours are not enough. */
export const zClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
