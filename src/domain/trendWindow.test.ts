import { describe, expect, it } from 'vitest';
import type { TrendPoint } from '../api/contract';
import { RANGE_HOURS, coveredHours, windowTrend } from './trendWindow';

/** `n` contiguous hourly buckets ending at 2026-09-02T09:00Z, oldest first. */
function series(n: number): TrendPoint[] {
  const end = Date.parse('2026-09-02T09:00:00.000Z');
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(end - (n - 1 - i) * 3_600_000).toISOString(),
    oa_pct: 90,
    site_count: 1,
  }));
}

describe('windowTrend', () => {
  it('keeps the last 8 buckets of a served day when 8h is picked', () => {
    const out = windowTrend(series(24), '8h');
    expect(out).toHaveLength(8);
    expect(out.at(-1)?.ts).toBe('2026-09-02T09:00:00.000Z');
    expect(out[0].ts).toBe('2026-09-02T02:00:00.000Z');
  });

  it('passes a served day through untouched at 24h', () => {
    const points = series(24);
    expect(windowTrend(points, '24h')).toBe(points);
  });

  /* The one the backend forces: MAX_WINDOW_HOURS is 71, so a week does not
     exist to be drawn and this must not pretend otherwise by inventing points
     or by dropping any it has. */
  it('returns everything it has when 7d is picked and only a day is served', () => {
    const points = series(24);
    expect(windowTrend(points, '7d')).toBe(points);
    expect(coveredHours(windowTrend(points, '7d'))).toBeLessThan(RANGE_HOURS['7d']);
  });

  /* A count-based slice would reach an hour further back than the window says. */
  it('windows on the timestamps, not on the bucket count', () => {
    const points = series(24).filter((_, i) => i !== 20);
    const out = windowTrend(points, '8h');
    expect(out).toHaveLength(7);
    expect(out[0].ts).toBe('2026-09-02T02:00:00.000Z');
  });

  it('is a no-op on an empty series', () => {
    expect(windowTrend([], '8h')).toEqual([]);
  });
});

describe('coveredHours', () => {
  it('measures end to end so a gap still reports the span drawn', () => {
    expect(coveredHours(series(8))).toBe(8);
    expect(coveredHours(series(8).filter((_, i) => i !== 3))).toBe(8);
  });

  it('is zero with nothing to measure', () => {
    expect(coveredHours([])).toBe(0);
  });
});
