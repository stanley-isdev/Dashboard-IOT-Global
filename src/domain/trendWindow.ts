import { useMemo } from 'react';
import type { Range, TrendPoint } from '../api/contract';
import { useI18n } from '../i18n/I18nProvider';
import { formatDate } from '../i18n/format';
import type { TKey } from '../i18n/en';

/**
 * Labelling the trend panel, and narrowing it when the payload is wider than
 * the window asked for.
 *
 * ## What this used to be for
 *
 * `/global-overview` used to return a fixed 24 hourly buckets whatever `range`
 * was sent - it took the parameter, echoed it in `filters_applied` and never
 * read it - so picking "Last 8h" relabelled the panel and moved nothing. The
 * half of that gap the front end could close honestly was the narrowing one:
 * twenty-four buckets contain the last eight, so "Last 8h" was made true here
 * by dropping the buckets outside it. The widening half could not be closed and
 * was not faked - seven days of history did not exist to be drawn.
 *
 * ## What changed on 2026-09-03
 *
 * The server now serves the window: `/global-overview` takes `from`/`to`
 * alongside `range`, assembles anything wider than one query out of several
 * (server/src/services/windowedSnapshot.ts), and reports what it measured on
 * `window`. The trend comes back with as many hourly buckets as the window
 * holds, so both halves are closed at the source.
 *
 * Which leaves this module doing two smaller jobs, and it is worth being clear
 * that they ARE smaller rather than deleting it and losing the guard:
 *
 *  - **The label**, still shared so the picker's capsule, the panel title and
 *    the caption cannot drift apart. That was the original reason for one map.
 *  - **A narrowing safety net** on quick ranges. It is a no-op against the
 *    current server, which sends exactly the hours asked for; it stays because
 *    a payload with more buckets than the window is the failure mode that
 *    silently over-states a chart, and catching it costs one filter.
 *
 * With a calendar window applied it narrows NOTHING - see the `absolute`
 * parameter on `useTrendWindow`. `coveredHours` still reports the span actually
 * drawn, because a chart captioned "7 days" over the four the poll managed is
 * worse than one that says which it is.
 */

/** Hours in each served window. `7d` is here for arithmetic, not for a promise. */
export const RANGE_HOURS: Record<Range, number> = {
  '8h': 8,
  '24h': 24,
  '7d': 24 * 7,
};

/**
 * The short label for each window - "8 hours", "24 hours", "7 days".
 *
 * One map, because three had already drifted into being: the time picker's
 * capsule, the trend panel's title, and the caption below it all name the same
 * window, and a board where the control says one thing and the title beside it
 * says another is the failure this whole change is about.
 */
export const RANGE_SHORT = {
  '8h': 'range.8h.short',
  '24h': 'range.24h.short',
  '7d': 'range.7d.short',
} as const satisfies Record<Range, TKey>;

const HOUR_MS = 3_600_000;

/**
 * The buckets inside `range`, counted back from the newest one.
 *
 * Filtered on the timestamps rather than sliced off the tail: the points are
 * hourly buckets and are normally contiguous, but an hour the poller missed
 * makes a count-based slice quietly reach further back than the window it
 * claims - which is the bug this module exists to fix, one layer down.
 *
 * Counted from the newest *point* and not from `now` for the same reason the
 * freeze detector is a separate signal: when the trend poll is stuck, the
 * honest thing for the chart to do is draw the hours it has and let the
 * connection banner say they are old, not silently empty itself out.
 */
export function windowTrend(points: TrendPoint[], range: Range): TrendPoint[] {
  const want = RANGE_HOURS[range];
  if (points.length === 0) return points;
  const newest = Date.parse(points[points.length - 1].ts);
  if (!Number.isFinite(newest)) return points;
  const from = newest - (want - 1) * HOUR_MS;
  const out = points.filter((p) => {
    const at = Date.parse(p.ts);
    return !Number.isFinite(at) || at >= from;
  });
  return out.length === points.length ? points : out;
}

/**
 * How many hours the given buckets actually span, for the caption.
 *
 * Measured end to end rather than counted, so a gap in the middle still reports
 * the span the axis draws: eight buckets with one hour missing is nine hours of
 * chart, and captioning it "last 8 h" would misplace every reading on it.
 */
export function coveredHours(points: TrendPoint[]): number {
  if (points.length === 0) return 0;
  const first = Date.parse(points[0].ts);
  const last = Date.parse(points[points.length - 1].ts);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return points.length;
  return Math.round((last - first) / HOUR_MS) + 1;
}

/**
 * What a trend panel needs to draw itself against the picked window: the
 * buckets inside it, the label its title uses, and the phrase its caption uses
 * for the span actually drawn.
 *
 * A hook rather than the arithmetic inlined twice because the two panels that
 * draw a trend - the global board's Executive Analytics tab and the company
 * drill-down - have to window and caption it the same way. They did not before:
 * one hardcoded "last 24 h" and the other printed no span at all.
 *
 * It returns the span and not the whole caption because the scope half of that
 * sentence differs per page - every connected plant, or this one site - and a
 * shared caption would have put "all connected plants" under a single base's
 * chart. The caller wraps this in `trend.sub` or `trend.subSite`.
 */
export function useTrendWindow(
  points: TrendPoint[] | undefined,
  range: Range,
  /**
   * The calendar's window, when one is applied - the plain days the reader
   * picked, not the instants the server resolved them to.
   *
   * When it is set, the served points ARE the window and nothing here narrows
   * them: `range` still holds the quick window the board would fall back to,
   * and cutting a fortnight down to that would be this module's own bug in
   * reverse - a chart drawing one day under a title naming fifteen.
   *
   * The days rather than `window.from`/`window.to` because those are UTC
   * instants and the picker drew calendar days in the reference zone; slicing
   * a date out of the instant would print the wrong day either side of
   * midnight for a Bangkok reader.
   */
  absolute?: { from: string; to: string } | null,
): { points: TrendPoint[]; rangeLabel: string; span: string } {
  const { t, lang } = useI18n();
  const isAbsolute = absolute != null;
  const windowed = useMemo(
    () => (isAbsolute ? (points ?? []) : windowTrend(points ?? [], range)),
    [points, range, isAbsolute],
  );
  const rangeLabel = isAbsolute
    ? `${formatDate(absolute.from, lang)} – ${formatDate(absolute.to, lang)}`
    : t(RANGE_SHORT[range]);

  /*
   * Nothing loaded yet: the caption names the picked window rather than "last
   * 0 h". It sits over a skeleton for the moment it is on screen, and a zero
   * there reads as a measurement.
   */
  if (windowed.length === 0) return { points: windowed, rangeLabel, span: rangeLabel };

  const hours = coveredHours(windowed);
  /* With a calendar window applied the label already names the exact days, so
     the caption states the span it drew and has no shorter/longer case to
     report against: the window is not a promise of N hours, it is two dates. */
  const span = isAbsolute
    ? t('trend.span', { hours })
    : hours >= RANGE_HOURS[range]
      ? t('trend.span', { hours })
      : t('trend.spanShort', { hours, range: rangeLabel });
  return { points: windowed, rangeLabel, span };
}
