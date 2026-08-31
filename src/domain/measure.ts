import type { SiteStatus } from '../api/contract';

/**
 * A number that might not exist, and that carries *why* it does not.
 *
 * The mockup models this as `oa: number | null` with a sibling `status` field
 * acting as the guard, and that arrangement produces two real defects:
 *
 *   tier(null)      -> `null >= 90` is false, `null >= 75` is false, so the
 *                      function returns 'alert' and the site renders RED.
 *   r.oa.toFixed(1) -> throws.
 *
 * Both are invisible today only because `isNoData` happens to be checked first
 * at every call site. A company that is `status: 'online'` but has no plants yet
 * takes neither guard and renders red or crashes.
 *
 * Making the absence part of the value fixes the class rather than the
 * instances. You cannot call .toFixed() on a Measure, and the only way to put
 * one on screen is <MeasureValue>, which handles all five arms. There is no
 * `number | null` anywhere in the view model.
 */
export type Measure<T = number> =
  | { kind: 'value'; value: T }
  /** Was reporting, has gone quiet. The last known value stays on screen. */
  | { kind: 'stale'; value: T; asOf: string }
  /** Connected, but nothing in the selected window. */
  | { kind: 'no_data' }
  /** No gateway commissioned yet (design doc section 11). */
  | { kind: 'not_connected'; note: string | null }
  /** Genuinely inapplicable - e.g. achievement when the plan is zero. */
  | { kind: 'not_applicable'; reasonKey: string };

export type MeasureKind = Measure['kind'];

/** True when the measure carries a number that may be formatted. */
export function hasValue<T>(m: Measure<T>): m is Extract<Measure<T>, { value: T }> {
  return m.kind === 'value' || m.kind === 'stale';
}

/** The number, or null. Use only for sorting and aggregation, never for display. */
export function valueOf<T>(m: Measure<T>): T | null {
  return hasValue(m) ? m.value : null;
}

/**
 * Projects a contract value plus its site status into a Measure.
 *
 * This is the single place the mapping happens, so a new status arm is a
 * compile error at exactly one location instead of a silent fallthrough at
 * twenty.
 */
export function toMeasure(
  value: number | null,
  status: SiteStatus,
  opts?: { asOf?: string | null; note?: string | null; naReasonKey?: string },
): Measure {
  if (status === 'not_connected') {
    return { kind: 'not_connected', note: opts?.note ?? null };
  }
  if (value === null) {
    // A reporting site with a null metric is a genuine "not applicable", not a
    // connection problem - e.g. achievement on a machine with no plan.
    return opts?.naReasonKey
      ? { kind: 'not_applicable', reasonKey: opts.naReasonKey }
      : { kind: 'no_data' };
  }
  if (status === 'stale' && opts?.asOf) {
    return { kind: 'stale', value, asOf: opts.asOf };
  }
  if (status === 'no_data') {
    return { kind: 'no_data' };
  }
  return { kind: 'value', value };
}

/**
 * Sort key that keeps sites without telemetry out of the performance ranking
 * entirely, rather than letting a missing number masquerade as a bad one.
 * Returns null for anything unrankable; the caller partitions on that.
 */
export function rankKey(m: Measure): number | null {
  return hasValue(m) ? m.value : null;
}
