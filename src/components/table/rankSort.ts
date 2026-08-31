import type { Counts, Kpi } from '../../api/contract';

/**
 * Which column the ranking is sorted on, and the one rule that matters: a
 * missing figure is never a good score.
 *
 * The order is set by tapping a column head - the pattern every table on the
 * web uses, and the one that needs no explaining to an executive who has used a
 * spreadsheet. It also costs nothing on screen: the head is already there, so
 * the control adds a caret rather than a box, and nothing is ever drawn over the
 * rows it orders.
 *
 * The board opens on %OA ascending, which is the order the artboard ranks by:
 * the site that needs attention is the first thing read. Everything else here is
 * the same nine rows answering a different question - "who lost the most hours"
 * is a downtime one, and "where is THS" is not a ranking at all but a lookup,
 * which is why the identity column sorts too. On a table that reorders itself
 * every ten seconds, alphabetical is the only order in which a named base stays
 * where the reader last saw it.
 *
 * Three invariants hold across every column, and all three are correctness
 * rather than taste:
 *
 *   1. Nulls sort last in *both* directions. Reversing a comparator must not
 *      float "no reading" to the top - a site with no downtime figure is not the
 *      site with the most downtime. This is the same mistake the not-reporting
 *      divider exists to prevent one level up, and it is why the direction
 *      multiplies the comparison and not the null test.
 *
 *   2. Ties break on the site code. `Array.prototype.sort` is stable, so without
 *      this the tied rows would sit in payload order - and payload order is the
 *      server's business, not something the board should inherit and then appear
 *      to change on its own. Nine bases at 100.0% would reshuffle between polls.
 *
 *   3. A column's *first* tap sorts it the useful way round rather than always
 *      ascending. Downtime opens longest-first, because nobody has ever wanted
 *      to know which line stopped least; %OA and %ACHV open worst-first, which
 *      is what the board is for. A second tap reverses whatever it did.
 */
export type SortCol = 'code' | 'oa' | 'achv' | 'down';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  col: SortCol;
  dir: SortDir;
}

/** The order the board opens on: worst %OA first, as drawn. */
export const DEFAULT_SORT: SortState = { col: 'oa', dir: 'asc' };

/** Which way round a column goes on its first tap. See invariant 3 above. */
const FIRST_DIR: Record<SortCol, SortDir> = {
  code: 'asc',
  oa: 'asc',
  achv: 'asc',
  down: 'desc',
};

/** Tapping a head: reverse it if it is already the sort, otherwise adopt it. */
export function nextSort(current: SortState, col: SortCol): SortState {
  if (current.col !== col) return { col, dir: FIRST_DIR[col] };
  return { col, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * The shape a sortable row has to have.
 *
 * Structural rather than `CompanySummary`, because the same comparator orders
 * the plant rows underneath an expanded base: both levels carry the identical
 * `kpi` block - that is the point of section 13's one-metric-block-per-level
 * design - so one function keeps a drill-down in the order of the ranking it was
 * opened from.
 */
export interface RankSortable {
  code: string;
  kpi: Pick<Kpi, 'oa_pct' | 'achievement_pct' | 'downtime_sec'>;
  counts: Pick<Counts, 'stopped'>;
}

/** The figure each sortable column reads. */
const METRIC: Record<Exclude<SortCol, 'code'>, (row: RankSortable) => number | null> = {
  oa: (r) => r.kpi.oa_pct,
  achv: (r) => r.kpi.achievement_pct,
  down: (r) => r.kpi.downtime_sec,
};

const byCode = (a: RankSortable, b: RankSortable): number =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0;

/** A new array, ordered by `sort`. Never mutates its input. */
export function sortRows<T extends RankSortable>(rows: readonly T[], sort: SortState): T[] {
  const out = [...rows];
  const flip = sort.dir === 'asc' ? 1 : -1;

  if (sort.col === 'code') return out.sort((a, b) => byCode(a, b) * flip);

  const of = METRIC[sort.col];
  return out.sort((a, b) => {
    const av = of(a);
    const bv = of(b);
    // Nulls last, whichever way the column runs. Not `?? 0`: descending that
    // reads as zero, ascending it reads as the worst score in the fleet, and
    // neither is what "not measured" means.
    if (av === null || bv === null) {
      if (av === bv) return byCode(a, b);
      return av === null ? 1 : -1;
    }
    return av === bv ? byCode(a, b) : (av - bv) * flip;
  });
}
