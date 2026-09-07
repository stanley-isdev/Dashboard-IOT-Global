/**
 * The trend chart's scale arithmetic, kept out of the component so it can be
 * argued with in a test rather than eyeballed in a screenshot.
 *
 * Every function here answers a question that has a wrong answer which still
 * *looks* like a chart: an axis that clips the worst hour of the day, a floor
 * that swings by ten points on a rounding difference of a tenth, a tick label
 * printed on top of another one. None of those raise an error, and none are
 * visible unless you happen to be looking at the day they matter.
 */

export interface Domain {
  min: number;
  max: number;
}

/** Room kept below the lowest reading even when the day is flat, in points. */
const MIN_FLOOR_GAP = 3;

/** The domain never collapses below this, or a flat day fills the panel. */
const MIN_SPAN = 8;

/**
 * How many interquartile ranges past the upper quartile the axis will still
 * reach for. Tukey's fence, and the same 1.5 for the same reason: it is the
 * width at which a reading stops being the top of the spread and starts being
 * a different kind of event.
 *
 * A fixed quantile was tried first and is wrong here. On a 13-point series the
 * 95th percentile interpolates INTO the runaway value, so the ceiling lands
 * halfway to it and the fix does nothing; the fence is computed off the middle
 * of the distribution and does not move when the tail does.
 */
const FENCE_IQR = 1.5;

/**
 * How far past that quantile the true peak has to sit before it is left off the
 * top of the axis rather than accommodated.
 *
 * Below this the peak is simply included: an axis that stops at 108 to keep one
 * 112% hour off it has spent an annotation to save four points of scale.
 */
const CLIP_RATIO = 1.2;

/** Linear-interpolated quantile of an already-sorted, non-empty series. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The y-domain for a set of readings and their target.
 *
 * Four rules, in the order they were learned:
 *
 * It is derived, not hardcoded. The mockup pinned `45..100`, which silently
 * clipped any hour below 45% off the bottom edge - and a plant having a
 * catastrophic shift is the one case where the chart must not flatten.
 *
 * The padding is asymmetric. A trend running under its target needs the room
 * below the line; the space above a threshold nothing reaches is space spent on
 * nothing. So the floor gets ~18% of the span and the ceiling gets ~6%.
 *
 * The floor rounds to fives, not tens. With tens, a low of 74.6 keeps the axis
 * at 70 while a low of 74.4 drops it to 60, and half the panel becomes empty
 * fill over a difference no reader can see.
 *
 * The target is folded into the range on purpose: a threshold drawn outside the
 * domain would be clamped onto an edge and read as a value it is not.
 *
 * ## The ceiling is no longer pinned at 100 (2026-09-03)
 *
 * It used to be `Math.min(100, ...)`, written on the assumption that a figure
 * called a percentage lives in 0..100. %OA does not: it is standard time over
 * actual time (DESIGN.md §9.1), so a machine beating a stale standard reads
 * 115%, and one running several PO slots in a single shot reads a multiple of
 * that - 419% measured on ASI 6051 M-ID-02, and the production board prints the
 * same figure (D-27, server/src/domain/oa.ts).
 *
 * The cap broke the chart at BOTH ends. Readings above 100 were still plotted,
 * off the top of the viewBox, so the line came out flat against the rail and
 * the flat part was the paper edge rather than a measurement. And the runaway
 * peak stayed in `span` regardless, which inflated the floor padding until the
 * axis collapsed to 0 and half the panel sat empty beneath a low of 38.7%.
 *
 * So the ceiling follows the data - but off the SPREAD of it, not the maximum.
 * Letting one 392% hour set the top squeezes the 80-110% band every reader
 * actually reads into a twentieth of the panel: honest, and useless. Hours
 * above that ceiling are not dropped; `overflowOf` hands them back so the chart
 * can mark them on the top rail and name them, which makes an off-scale hour
 * something the chart says rather than something it hides.
 *
 * The FLOOR is never made robust this way. It always contains the true low, for
 * the reason the derived domain exists at all: a catastrophic hour is the one
 * reading that must never be clipped.
 */
export function trendDomain(values: number[], target: number): Domain {
  if (values.length === 0) return { min: 0, max: 100 };
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0];
  const peak = sorted[sorted.length - 1];
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const fence = q3 + FENCE_IQR * (q3 - q1);
  const hi = Math.max(target, peak > fence * CLIP_RATIO ? fence : peak);
  const span = Math.max(hi - lo, MIN_SPAN);
  return {
    min: Math.max(0, Math.floor((lo - Math.max(span * 0.18, MIN_FLOOR_GAP)) / 5) * 5),
    max: Math.ceil((hi + span * 0.06) / 5) * 5,
  };
}

/**
 * The same domain with its ceiling moved to where the reader asked for it.
 *
 * The FLOOR is deliberately carried over untouched rather than recomputed from
 * the new span. Recomputing it would slide the bottom of the chart while the
 * reader drags the top, so the line they are trying to look at moves under the
 * pointer - the axis would be answering a question nobody asked. Only the
 * ceiling moves, and every point keeps its horizontal neighbours.
 */
export function withCeiling(domain: Domain, max: number): Domain {
  return {
    min: domain.min,
    max: Math.max(domain.min + MIN_SPAN, Math.round(max / 5) * 5),
  };
}

/**
 * The ceiling at which nothing is off-scale any more - the far end of the zoom.
 *
 * One step of headroom past the peak, so the highest reading is a point on the
 * chart rather than a mark welded to the rail, and its annotation has somewhere
 * to print. Equal to the fitted ceiling when nothing overflows, which is what
 * the caller tests to decide whether the control is worth showing at all.
 */
export function fullCeiling(values: number[], domain: Domain): number {
  if (values.length === 0) return domain.max;
  const peak = Math.max(...values);
  return Math.max(domain.max, Math.ceil(peak / 5) * 5 + 5);
}

/**
 * The indices of the readings that sit above the ceiling, in chart order.
 *
 * Separate from `trendDomain` because it answers a different question - the
 * domain is arithmetic over the values, this is a lookup over the points, nulls
 * and all - and because the count is what the legend prints. An empty array is
 * the normal case and turns the whole overflow treatment off.
 */
export function overflowOf(values: (number | null)[], domain: Domain): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && v > domain.max) out.push(i);
  }
  return out;
}

/**
 * Gridline steps a reader recognises, finest first. Never 3s or 7s.
 *
 * Ten is the floor rather than five, so every axis that fitted under the old
 * hardcoded 0..100 is gridded exactly as it was.
 */
const TICK_STEPS = [10, 20, 25, 50, 100, 200];

/** At most this many gridlines between the two bounds. */
const MAX_INTERIOR_TICKS = 7;

/**
 * How close to a bound an interior gridline may come, as a fraction of the
 * span, before it is dropped.
 *
 * Both bounds carry a label, and an interior tick landing just under one prints
 * its figure on top of that label - measured on the live board on 2026-09-03,
 * where a 10..410 axis drew its last interior line at 400 and the two numbers
 * came out as one smear. The bound is the one that survives: it is the end of
 * the axis, and a reader orients from it.
 */
const TICK_CLEARANCE = 0.06;

/**
 * Gridline values: both bounds, plus round divisions between them.
 *
 * Enough to read a value off the grid without counting pixels, few enough that
 * the grid stays behind the data instead of competing with it.
 *
 * The step used to be a fixed ten, which was right while the domain could not
 * exceed 0..100. Now that the ceiling follows the data (see `trendDomain`), a
 * 30..340 axis would come back with thirty-one gridlines, and a grid with a
 * line every four pixels is a grey block. The step is the finest recognisable
 * one that keeps the interior under `MAX_INTERIOR_TICKS`.
 */
export function yTicks(domain: Domain): number[] {
  const span = domain.max - domain.min;
  const step =
    TICK_STEPS.find((s) => span / s <= MAX_INTERIOR_TICKS + 1) ??
    TICK_STEPS[TICK_STEPS.length - 1];
  const clearance = span * TICK_CLEARANCE;
  const out = [domain.min];
  for (let v = Math.ceil((domain.min + 1) / step) * step; v < domain.max; v += step) {
    // Dropped rather than nudged: a moved gridline lies about which value it
    // marks, and the two bounds are the labels worth protecting.
    if (v - domain.min < clearance || domain.max - v < clearance) continue;
    out.push(v);
  }
  out.push(domain.max);
  return out;
}

/**
 * Which points get a time label, given each point's wall-clock hour in the
 * reference zone.
 *
 * Both ends always, because they are what a reader orients from, plus round
 * clock hours of the zone in between - so a dip can be placed against a shift
 * instead of counted off the left edge.
 *
 * Round clock hours rather than "every sixth point from the start": a night
 * shift begins at a fixed hour, and a tick at 20:00 answers a question that a
 * tick at "start + 6" does not.
 *
 * **The spacing scales with the width of the window** rather than being fixed
 * at six hours. Six was right while every chart was 24 points wide; once the
 * time picker started serving the window a reader asked for (2026-09-03), a
 * seven-day chart is 168 points and every-sixth-hour is 28 interior ticks
 * printing over each other. The step is the coarsest of the round divisions of
 * a day that still leaves at least three interior ticks, so the axis stays
 * legible from eight hours to four weeks without a second rule.
 *
 * An interior tick close enough to an end to print over its label is dropped
 * rather than nudged along, because a nudged tick lies about which hour it
 * marks - and the two ends are the labels worth protecting.
 */
export function timeTickIndices(hours: number[]): number[] {
  if (hours.length < 2) return [];
  const last = hours.length - 1;
  const gap = Math.max(2, Math.round(hours.length * 0.09));

  /* Divisions of a day, coarsest first. Only these, so a tick always lands on
     an hour a reader recognises - 12:00 means something, 07:00 does not. */
  const step = [24, 12, 6, 3, 2, 1].find((s) => Math.floor(hours.length / s) >= 3) ?? 1;

  const interior: number[] = [];
  for (let i = 0; i < hours.length; i++) {
    if (i <= gap || i >= last - gap) continue;
    if (hours[i] % step === 0) interior.push(i);
  }

  /*
   * `hours` holds hour-of-day, so the modulus above cannot go coarser than
   * daily however wide the window is - a four-week chart would come back with
   * 28 midnight ticks. Thin the result instead of loosening the modulus, which
   * keeps every surviving tick on a round hour rather than sliding it to a
   * time that means nothing.
   */
  const MAX_INTERIOR = 6;
  const thinned =
    interior.length <= MAX_INTERIOR
      ? interior
      : interior.filter((_, i) => i % Math.ceil(interior.length / MAX_INTERIOR) === 0);

  return [0, ...thinned, last];
}

/**
 * The indices of the highest and lowest readings, or -1 for either when there
 * is no reading at all.
 *
 * First occurrence wins on a tie, which is what stops a flat series from
 * labelling one point both the peak and the low - the caller drops the second
 * annotation when the two indices agree.
 */
export function extremesOf(values: (number | null)[]): { peak: number; dip: number } {
  let peak = -1;
  let dip = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (peak < 0 || v > (values[peak] as number)) peak = i;
    if (dip < 0 || v < (values[dip] as number)) dip = i;
  }
  return { peak, dip };
}
