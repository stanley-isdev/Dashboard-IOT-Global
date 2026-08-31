import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  nextSort,
  sortRows,
  type RankSortable,
  type SortCol,
  type SortState,
} from './rankSort';

/**
 * Three rules, all of the kind that produce a plausible-looking board rather
 * than an obvious bug: a null must never win a reversed sort, tied rows must not
 * reshuffle between polls, and a column's first tap must sort it the way round
 * the reader meant.
 */

const row = (
  code: string,
  kpi: Partial<RankSortable['kpi']> = {},
  stopped = 0,
): RankSortable => ({
  code,
  kpi: { oa_pct: 0, achievement_pct: 0, downtime_sec: 0, ...kpi },
  counts: { stopped },
});

const codes = (rows: RankSortable[]) => rows.map((r) => r.code);
const at = (col: SortCol, dir: 'asc' | 'desc'): SortState => ({ col, dir });

describe('rank sort', () => {
  it('opens on the order the board was designed around', () => {
    expect(DEFAULT_SORT).toEqual({ col: 'oa', dir: 'asc' });
    const rows = [row('B', { oa_pct: 91 }), row('A', { oa_pct: 72 }), row('C', { oa_pct: 84 })];
    expect(codes(sortRows(rows, DEFAULT_SORT))).toEqual(['A', 'C', 'B']);
    expect(codes(sortRows(rows, at('oa', 'desc')))).toEqual(['B', 'C', 'A']);
  });

  it('orders by the figure each column shows', () => {
    const rows = [
      row('A', { achievement_pct: 99, downtime_sec: 60 }),
      row('B', { achievement_pct: 80, downtime_sec: 7200 }),
      row('C', { achievement_pct: 90, downtime_sec: 900 }),
    ];
    expect(codes(sortRows(rows, at('achv', 'asc')))).toEqual(['B', 'C', 'A']);
    expect(codes(sortRows(rows, at('down', 'desc')))).toEqual(['B', 'C', 'A']);
    expect(codes(sortRows(rows, at('code', 'asc')))).toEqual(['A', 'B', 'C']);
    expect(codes(sortRows(rows, at('code', 'desc')))).toEqual(['C', 'B', 'A']);
  });

  /*
   * The one that matters. A site with no downtime figure has not had the most
   * downtime, and `?? 0` in a reversed comparator is exactly how it comes to be
   * printed at the top of the board.
   */
  it('sorts a missing figure last in both directions', () => {
    const rows = [row('A', { oa_pct: null }), row('B', { oa_pct: 95 }), row('C', { oa_pct: 61 })];
    for (const dir of ['asc', 'desc'] as const) {
      expect(codes(sortRows(rows, at('oa', dir))).at(-1)).toBe('A');
    }

    const down = [row('A', { downtime_sec: null }), row('B', { downtime_sec: 30 })];
    expect(codes(sortRows(down, at('down', 'desc')))).toEqual(['B', 'A']);
    expect(codes(sortRows(down, at('down', 'asc')))).toEqual(['B', 'A']);
  });

  it('breaks ties on the site code, so equal rows never reshuffle', () => {
    const rows = [
      row('VNS', { oa_pct: 100 }),
      row('ASI', { oa_pct: 100 }),
      row('THS', { oa_pct: 100 }),
    ];
    expect(codes(sortRows(rows, at('oa', 'asc')))).toEqual(['ASI', 'THS', 'VNS']);
    // The same answer whatever order the payload arrives in.
    expect(codes(sortRows([...rows].reverse(), at('oa', 'desc')))).toEqual(['ASI', 'THS', 'VNS']);
    // Including when every figure is missing.
    const blank = [row('C', { oa_pct: null }), row('A', { oa_pct: null })];
    expect(codes(sortRows(blank, at('oa', 'desc')))).toEqual(['A', 'C']);
  });

  it('opens each column the useful way round, then reverses it', () => {
    // Nobody has ever wanted to know which line stopped least.
    expect(nextSort(DEFAULT_SORT, 'down')).toEqual({ col: 'down', dir: 'desc' });
    // The performance columns open worst-first, which is what the board is for.
    expect(nextSort(at('down', 'desc'), 'oa')).toEqual({ col: 'oa', dir: 'asc' });
    expect(nextSort(at('down', 'desc'), 'achv')).toEqual({ col: 'achv', dir: 'asc' });
    expect(nextSort(at('down', 'desc'), 'code')).toEqual({ col: 'code', dir: 'asc' });

    // Tapping the column that is already the sort reverses it, and again undoes.
    expect(nextSort(at('oa', 'asc'), 'oa')).toEqual({ col: 'oa', dir: 'desc' });
    expect(nextSort(at('oa', 'desc'), 'oa')).toEqual({ col: 'oa', dir: 'asc' });
    expect(nextSort(at('down', 'desc'), 'down')).toEqual({ col: 'down', dir: 'asc' });
  });

  it('never mutates its input', () => {
    const rows = [row('B', { oa_pct: 90 }), row('A', { oa_pct: 70 })];
    const before = codes(rows);
    sortRows(rows, DEFAULT_SORT);
    expect(codes(rows)).toEqual(before);
  });
});
