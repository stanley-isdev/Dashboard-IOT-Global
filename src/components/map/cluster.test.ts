import { describe, expect, it } from 'vitest';
import { clusterFootprint, groupOverlapping, type DotPoint } from './cluster';

const p = (code: string, x: number, y: number): DotPoint => ({ code, x, y });

/** The dot's rendered width at default density. */
const DOT = 8;

describe('groupOverlapping', () => {
  it('leaves dots that do not touch alone', () => {
    expect(groupOverlapping([p('A', 0, 0), p('B', 40, 0), p('C', 80, 0)], DOT)).toEqual([]);
  });

  it('groups two dots on the same pixel', () => {
    expect(groupOverlapping([p('THS', 100, 50), p('ASI', 100, 50)], DOT)).toEqual([
      { key: 'ASI+THS', codes: ['ASI', 'THS'] },
    ]);
  });

  /*
   * The threshold is the dot's diameter, so it is the moment the fills stop
   * overlapping - not a tuned constant. Checked from both sides because an
   * off-by-one here is a ring that flickers on and off during a pinch.
   */
  it('groups at just under one diameter and not at one diameter', () => {
    expect(groupOverlapping([p('A', 0, 0), p('B', DOT - 0.01, 0)], DOT)).toHaveLength(1);
    expect(groupOverlapping([p('A', 0, 0), p('B', DOT, 0)], DOT)).toHaveLength(0);
  });

  it('measures diagonally, not per axis', () => {
    // dx and dy are each under the threshold; the distance is not.
    expect(groupOverlapping([p('A', 0, 0), p('B', 6, 6)], DOT)).toHaveLength(0);
  });

  it('follows the diameter it is given, so kiosk density scales it', () => {
    const pair = [p('A', 0, 0), p('B', 11, 0)];
    expect(groupOverlapping(pair, 8)).toHaveLength(0);
    expect(groupOverlapping(pair, 12)).toHaveLength(1);
  });

  it('links transitively - A touches B, B touches C, all three are one group', () => {
    const chain = [p('A', 0, 0), p('B', 6, 0), p('C', 12, 0)];
    expect(groupOverlapping(chain, DOT)).toEqual([{ key: 'A+B+C', codes: ['A', 'B', 'C'] }]);
  });

  it('keeps two separate piles separate', () => {
    const two = [p('A', 0, 0), p('B', 2, 0), p('X', 200, 0), p('Y', 202, 0)];
    expect(groupOverlapping(two, DOT).map((c) => c.key)).toEqual(['A+B', 'X+Y']);
  });

  /*
   * The signature drives a React key and a re-render guard, so it has to be a
   * function of the grouping and nothing else. If payload order leaked into it,
   * every re-sort of the ranking would look like a changed grouping.
   */
  it('produces the same key whatever order the dots arrive in', () => {
    const forwards = groupOverlapping([p('THS', 0, 0), p('ASI', 1, 0)], DOT);
    const backwards = groupOverlapping([p('ASI', 1, 0), p('THS', 0, 0)], DOT);
    expect(forwards).toEqual(backwards);
    expect(forwards[0].key).toBe('ASI+THS');
  });

  it('handles an empty layer and a single dot', () => {
    expect(groupOverlapping([], DOT)).toEqual([]);
    expect(groupOverlapping([p('A', 5, 5)], DOT)).toEqual([]);
  });
});

describe('clusterFootprint', () => {
  it('centres on the mean of the members', () => {
    const spot = clusterFootprint([p('A', 10, 20), p('B', 30, 40)], DOT, 3);
    expect(spot.cx).toBe(20);
    expect(spot.cy).toBe(30);
  });

  it('clears every dot it encloses', () => {
    const pts = [p('A', 0, 0), p('B', 6, 0)];
    const spot = clusterFootprint(pts, DOT, 3);
    for (const q of pts) {
      const edge = Math.hypot(q.x - spot.cx, q.y - spot.cy) + DOT / 2;
      expect(spot.r).toBeGreaterThanOrEqual(edge);
    }
  });

  it('is a dot plus the gap when both members sit on one pixel', () => {
    const spot = clusterFootprint([p('THS', 50, 50), p('ASI', 50, 50)], DOT, 3);
    expect(spot).toEqual({ cx: 50, cy: 50, r: DOT / 2 + 3 });
  });
});
