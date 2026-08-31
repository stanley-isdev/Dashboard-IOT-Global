import { describe, expect, it } from 'vitest';
import { rollupOa, sumOrNull } from '../src/rollup.ts';

describe('rollupOa', () => {
  it('weights by output rather than averaging plants equally', () => {
    // A 21-machine plant at 70% and a 2-machine plant at 100% must not roll
    // up to 85% - the small plant's output cannot outweigh the large one's.
    const oa = rollupOa([
      { oa: 70, weight: 2100 },
      { oa: 100, weight: 200 },
    ]);
    expect(oa).toBeCloseTo((70 * 2100 + 100 * 200) / 2300, 1);
  });

  it('returns null, not a simple-average fallback, when total weight is zero', () => {
    const oa = rollupOa([
      { oa: 80, weight: 0 },
      { oa: 90, weight: 0 },
    ]);
    expect(oa).toBeNull();
  });

  it('returns null when there is nothing to roll up', () => {
    expect(rollupOa([])).toBeNull();
  });
});

describe('sumOrNull', () => {
  it('sums the non-null values', () => {
    expect(sumOrNull([1, 2, null, 3])).toBe(6);
  });

  it('returns null, not zero, when every value is absent', () => {
    expect(sumOrNull([null, null])).toBeNull();
  });
});
