import type { Counts, MachineStatus } from '@dashboard/contract';
import { BUCKET_OF, emptyCounts } from '@dashboard/domain-shared';
import type { MachineObservation } from '../services/liveSnapshot.ts';

/**
 * Q-02 - the machine census for one plant.
 *
 * **TOTAL = every machine observed, except `Order End`** - the production
 * board's own rule, read off the panel source in
 * docs/grafana/MACHINE-STATUS-V2.md §4.2:
 *
 * ```js
 * const EXCLUDE_FROM_TOTAL = ['Order End'];
 * const total = Object.entries(counts)
 *   .filter(([key]) => !EXCLUDE_FROM_TOTAL.includes(key))
 *   .reduce((sum, [, val]) => sum + val, 0);
 * ```
 *
 * `Order End` is excluded there because layer 1 of the derivation
 * (DESIGN.md §8.4) emits an EXTRA card per finished order group, so counting
 * them would count a machine twice. It is not a statement that those machines
 * do not exist.
 *
 * ## This replaced TOTAL = RUNNING + STOP, and why
 *
 * That rule was set on 2026-08-25 to match the board, from a snapshot where the
 * figures happened to add up on screen (29 = 22 + 7). They add up whenever no
 * machine is in any third state - which is most of the time, and was true of
 * that snapshot. It is not the rule the board applies, and the two disagree the
 * moment a machine sits in `No Plan`, `4M Change`, `Pending`, `Alarm` or
 * `Warning`. Measured at THS 6332 on 2026-08-27: one machine in `Warning`,
 * counted by the board, dropped by us.
 *
 * `machinesExpected` still does not feed TOTAL. That part of the 2026-08-25
 * decision stands and is unrelated to the rule above: it claims 10 machines at
 * THS 6332 while 26-29 report (BACKEND-HANDOVER §4.3c), so any total built on
 * it inherits a config error. TOTAL is made only of machines InfluxDB confirms,
 * which is also what the board does.
 *
 * `not_counted` therefore now holds `Order End` alone. It stays a separate
 * record rather than a key on `by_status` because `sum(by_status) === total` is
 * the invariant the whole census rests on.
 *
 * `by_status` remains the source of truth for what IS counted, and every
 * bucket is derived from it, so `checkPartition` holds by construction.
 */
export interface PlantCensus {
  counts: Counts;
  /** Machines heard from inside the window, after exclusions. */
  observed: number;
  /** Observed machines left out of TOTAL. `Order End` only - see above. */
  notCounted: number;
}

/**
 * The board's `EXCLUDE_FROM_TOTAL`. A set of one, spelled as a set because that
 * is the shape the rule has on the board and the next status to join it should
 * be a one-line change here rather than a rewrite.
 */
const EXCLUDED_FROM_TOTAL: ReadonlySet<MachineStatus> = new Set<MachineStatus>(['Order End']);

export function buildPlantCensus(opts: {
  observations: MachineObservation[];
  machineExclusions: string[];
}): PlantCensus {
  const excluded = new Set(opts.machineExclusions);
  const kept = opts.observations.filter((m) => !excluded.has(m.machine));
  const counted = kept.filter((m) => !EXCLUDED_FROM_TOTAL.has(m.status));

  const counts = emptyCounts();
  for (const m of kept) {
    // Both records are filled in the same pass, so a machine lands in exactly
    // one of them and neither can drift from what was actually observed.
    if (EXCLUDED_FROM_TOTAL.has(m.status)) counts.not_counted[m.status] += 1;
    else counts.by_status[m.status] += 1;
  }
  counts.total = counted.length;

  for (const [status, n] of Object.entries(counts.by_status) as [MachineStatus, number][]) {
    counts[BUCKET_OF[status]] += n;
  }

  return { counts, observed: kept.length, notCounted: kept.length - counted.length };
}
