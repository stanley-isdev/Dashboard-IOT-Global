import { describe, expect, it } from 'vitest';
import { extremesOf, timeTickIndices, trendDomain, yTicks } from './trendScale';

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

  it('stays inside 0..100, which is what a percentage has', () => {
    const d = trendDomain([99.9, 100, 0.4], 95);
    expect(d.min).toBe(0);
    expect(d.max).toBe(100);
  });

  it('answers an empty series with the full scale rather than NaN', () => {
    expect(trendDomain([], 95)).toEqual({ min: 0, max: 100 });
  });
});

describe('gridlines', () => {
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
