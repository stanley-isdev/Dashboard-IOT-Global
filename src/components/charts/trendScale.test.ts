import { describe, expect, it } from 'vitest';
import {
  extremesOf,
  fullCeiling,
  overflowOf,
  timeTickIndices,
  trendDomain,
  withCeiling,
  yTicks,
} from './trendScale';

/**
 * The failures being guarded against all produce a chart that looks fine.
 *
 * A clipped trough reads as a flat floor, a floor that swings by ten points on a
 * tenth of a percent reads as half a panel of empty fill, and a tick label
 * printed over another reads as a smudge. None of them throw, and none of them
 * are visible on the day you happen to be looking.
 */

const hours = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => (start + i) % 24);

describe('trend domain', () => {
  it('never clips a reading, however bad the day', () => {
    // The mockup's hardcoded 45 floor put this hour off the bottom of the panel.
    const d = trendDomain([88, 91, 22.4, 79], 95);
    expect(d.min).toBeLessThan(22.4);
    expect(d.max).toBeGreaterThanOrEqual(95);
  });

  it('keeps the target inside the range so the threshold is not clamped', () => {
    for (const target of [80, 95, 100]) {
      const d = trendDomain([61, 63, 66], target);
      expect(d.min).toBeLessThanOrEqual(61);
      expect(d.max).toBeGreaterThanOrEqual(target);
    }
  });

  it('leaves the low room to breathe instead of resting it on the rail', () => {
    // The artboard's 70..100 put a 72% trough 7% up a 30-point axis, which is
    // the complaint this padding exists to answer.
    const d = trendDomain([72, 84, 90], 95);
    const height = d.max - d.min;
    expect((72 - d.min) / height).toBeGreaterThan(0.1);
  });

  it('holds the floor steady across a rounding difference nobody can see', () => {
    // Rounded to tens these two land a whole gridline apart.
    expect(trendDomain([74.6, 88], 95).min).toBe(trendDomain([74.4, 88], 95).min);
  });

  it('wastes at most one gridline step at either end', () => {
    // The complaint this answers is a panel whose top third sat empty above the
    // target while the trough rested on the bottom rail. Snapping to fives is
    // what bounds both bands - the ceiling cannot run away to 100 from 82, and
    // the floor cannot drop a whole ten to clear a reading by a tenth.
    const d = trendDomain([74.5, 90.3], 95);
    expect(74.5 - d.min).toBeLessThanOrEqual(8);
    expect(d.max - 95).toBeLessThanOrEqual(5);
  });

  it('does not collapse onto a flat day', () => {
    const d = trendDomain([95, 95, 95], 95);
    expect(d.max - d.min).toBeGreaterThanOrEqual(5);
    expect(d.min).toBeLessThan(95);
  });

  it('never sinks below zero, which is what a ratio of times has', () => {
    expect(trendDomain([99.9, 100, 0.4], 95).min).toBe(0);
  });

  /*
   * The ceiling used to be hardcoded at 100 on the assumption that a figure
   * called a percentage cannot exceed it. %OA can and does - a stale std_time
   * puts a machine at 115%, and several PO slots in one shot multiply it (D-27,
   * server/src/domain/oa.ts). These four guard both halves of the fix: readings
   * above 100 are shown, and one runaway hour does not wreck the scale for the
   * other twenty-three.
   */
  it('follows a reading above 100 instead of clipping it flat', () => {
    const d = trendDomain([98, 104, 110.4], 95);
    expect(d.max).toBeGreaterThanOrEqual(110.4);
  });

  it('does not clip a peak that is only a little above the body', () => {
    // 112 against a body in the 90s is worth four points of scale, not an
    // annotation - the axis should simply contain it.
    const d = trendDomain([88, 91, 94, 90, 112], 95);
    expect(d.max).toBeGreaterThanOrEqual(112);
  });

  it('leaves the readable band readable when one hour runs away', () => {
    // The 2026-09-03 chart: a body in the 80-105 range, one multi-order hour at
    // 392.1%. An axis stretched to 400 puts every hour that matters in the
    // bottom eighth of the panel.
    const body = [82, 88, 91, 95, 99, 103, 87, 93, 96, 101, 105, 90];
    const d = trendDomain([...body, 392.1], 95);
    expect(d.max).toBeLessThan(200);
    expect(overflowOf([...body, 392.1], d)).toEqual([body.length]);
  });

  it('keeps the floor off the true low when a runaway hour is present', () => {
    // The second half of the same bug: 392.1 stayed in the span even though the
    // ceiling ignored it, and 18% of a 350-point span dragged the floor to 0,
    // leaving the bottom half of the panel empty under a low of 38.7.
    const d = trendDomain([38.7, 88, 91, 95, 99, 392.1], 95);
    expect(d.min).toBeGreaterThan(20);
    expect(d.min).toBeLessThan(38.7);
  });

  it('answers an empty series with the full scale rather than NaN', () => {
    expect(trendDomain([], 95)).toEqual({ min: 0, max: 100 });
  });
});

/*
 * The reader's own ceiling, behind the legend's slider. The failures guarded
 * against here are the ones that make a zoom control feel broken rather than
 * look broken: a floor that slides while the top is dragged, and a control
 * whose two ends draw the same chart.
 */
describe('reader-set ceiling', () => {
  const body = [82, 88, 91, 95, 99, 103, 87, 93, 96, 101, 105, 90];
  const series = [...body, 392.1];

  it('holds the floor still while the ceiling is raised', () => {
    const fitted = trendDomain(series, 95);
    for (const max of [150, 250, 400]) {
      expect(withCeiling(fitted, max).min).toBe(fitted.min);
    }
  });

  it('reaches a ceiling that puts every reading back on the chart', () => {
    const fitted = trendDomain(series, 95);
    const full = fullCeiling(series, fitted);
    expect(full).toBeGreaterThan(392.1);
    expect(overflowOf(series, withCeiling(fitted, full))).toEqual([]);
  });

  it('offers no travel when nothing is off-scale', () => {
    // What the component tests to decide whether to render the control at all.
    const fitted = trendDomain(body, 95);
    expect(fullCeiling(body, fitted)).toBe(fitted.max);
  });

  it('will not let a ceiling collapse the plot onto itself', () => {
    const fitted = trendDomain(series, 95);
    expect(withCeiling(fitted, 0).max).toBeGreaterThan(fitted.min);
  });
});

describe('gridlines', () => {
  it('drops an interior line that would print over a bound', () => {
    // The live board on 2026-09-03: a 10..410 axis drew 400 one tenth of a
    // gridline under its own ceiling, and the two labels came out as a smear.
    const ticks = yTicks({ min: 10, max: 410 });
    expect(ticks).toContain(410);
    expect(ticks).not.toContain(400);
    expect(ticks).toContain(350);
  });

  it('keeps a tall axis to a grid rather than a grey block', () => {
    // Ten was the only step while the domain could not exceed 100.
    expect(yTicks({ min: 25, max: 400 }).length).toBeLessThanOrEqual(9);
  });

  it('draws both bounds and the tens between them', () => {
    expect(yTicks({ min: 70, max: 100 })).toEqual([70, 80, 90, 100]);
    expect(yTicks({ min: 65, max: 100 })).toEqual([65, 70, 80, 90, 100]);
  });

  it('never repeats a bound as an interior line', () => {
    for (const domain of [
      { min: 60, max: 100 },
      { min: 70, max: 90 },
      { min: 55, max: 95 },
    ]) {
      const ticks = yTicks(domain);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(ticks[0]).toBe(domain.min);
      expect(ticks[ticks.length - 1]).toBe(domain.max);
    }
  });
});

describe('time ticks', () => {
  it('marks both ends and the zone’s own six-hour marks', () => {
    // 24 hourly points starting at 15:00 local: 18:00, 00:00 and 06:00 fall
    // inside, and 12:00 is next to the closing 14:00 label.
    const ticks = timeTickIndices(hours(15, 24));
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(23);
    expect(ticks.map((i) => hours(15, 24)[i])).toEqual([15, 18, 0, 6, 14]);
  });

  it('drops an interior tick that would print over an end label', () => {
    // 24 hours from 04:00: the 06:00 mark lands two points in, close enough to
    // the opening label to collide with it, and loses.
    const ticks = timeTickIndices(hours(4, 24));
    expect(ticks).toEqual([0, 8, 14, 20, 23]);
    expect(ticks).not.toContain(2);
  });

  it('is every label or none - never a half-drawn axis', () => {
    expect(timeTickIndices([])).toEqual([]);
    expect(timeTickIndices([9])).toEqual([]);
    expect(timeTickIndices([9, 10])).toEqual([0, 1]);
  });

  /*
   * The time picker started serving the window a reader asks for on
   * 2026-09-03, so this function now sees 168 points for a week and up to 672
   * for the retention limit. At the old fixed six-hour spacing those are 28 and
   * 112 interior ticks - an axis that is a smudge, which is the failure the
   * suite header names and the one no screenshot catches on the day.
   */
  it('keeps a week legible instead of printing 28 midnight labels', () => {
    const week = hours(0, 168);
    const ticks = timeTickIndices(week);
    expect(ticks.length).toBeLessThanOrEqual(8);
    // Still on round hours - a thinned axis must not slide a tick to 07:00.
    for (const i of ticks.slice(1, -1)) expect(week[i] % 24).toBe(0);
  });

  it('keeps four weeks legible too, where the modulus alone cannot', () => {
    // `hours` holds hour-of-day, so no modulus is coarser than daily: 672
    // points contain 28 midnights however the step is chosen. They get thinned.
    const ticks = timeTickIndices(hours(0, 672));
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(671);
  });

  it('still spaces a short window closely enough to have an axis at all', () => {
    // 8 hours: six-hourly marks would give at most one interior tick, and on
    // some starts none - a two-label axis. The step scales down instead.
    const ticks = timeTickIndices(hours(9, 8));
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(7);
  });
});

describe('extremes', () => {
  it('finds the peak and the low past the gaps', () => {
    expect(extremesOf([81, null, 90.3, 74.5, null, 88])).toEqual({ peak: 2, dip: 3 });
  });

  it('agrees with itself on a flat series, so the caller can drop one label', () => {
    const { peak, dip } = extremesOf([84, 84, 84]);
    expect(peak).toBe(dip);
  });

  it('reports nothing rather than hour zero when there is no reading', () => {
    expect(extremesOf([null, null])).toEqual({ peak: -1, dip: -1 });
  });
});
