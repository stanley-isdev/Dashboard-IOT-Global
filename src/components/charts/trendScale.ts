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
 * The y-domain for a set of readings and their target.
 *
 * Three rules, in the order they were learned:
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
 */
export function trendDomain(values: number[], target: number): Domain {
  if (values.length === 0) return { min: 0, max: 100 };
  const all = values.concat(target);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(hi - lo, MIN_SPAN);
  return {
    min: Math.max(0, Math.floor((lo - Math.max(span * 0.18, MIN_FLOOR_GAP)) / 5) * 5),
    max: Math.min(100, Math.ceil((hi + span * 0.06) / 5) * 5),
  };
}

/**
 * Gridline values: both bounds, plus every whole ten between them.
 *
 * Enough to read a value off the grid without counting pixels, few enough that
 * the grid stays behind the data instead of competing with it.
 */
export function yTicks(domain: Domain): number[] {
  const out = [domain.min];
  for (let v = Math.ceil((domain.min + 1) / 10) * 10; v < domain.max; v += 10) out.push(v);
  out.push(domain.max);
  return out;
}

/**
 * Which points get a time label, given each point's wall-clock hour in the
 * reference zone.
 *
 * Both ends always, because they are what a reader orients from, plus every
 * sixth hour of the zone - 00:00, 06:00, 12:00, 18:00 - so a dip can be placed
 * against a shift instead of counted off the left edge.
 *
 * Round clock hours rather than "every sixth point from the start": a night
 * shift begins at a fixed hour, and a tick at 20:00 answers a question that a
 * tick at "start + 6" does not.
 *
 * An interior tick close enough to an end to print over its label is dropped
 * rather than nudged along, because a nudged tick lies about which hour it
 * marks - and the two ends are the labels worth protecting.
 */
export function timeTickIndices(hours: number[]): number[] {
  if (hours.length < 2) return [];
  const last = hours.length - 1;
  const gap = Math.max(2, Math.round(hours.length * 0.09));
  const interior: number[] = [];
  for (let i = 0; i < hours.length; i++) {
    if (i <= gap || i >= last - gap) continue;
    if (hours[i] % 6 === 0) interior.push(i);
  }
  return [0, ...interior, last];
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
