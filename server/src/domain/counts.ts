import type { Counts, MachineStatus } from '@dashboard/contract';
import { BUCKET_OF, emptyCounts } from '@dashboard/domain-shared';
import type { MachineObservation } from '../services/liveSnapshot.ts';

/**
 * Q-02 - the machine census for one plant.
 *
 * **TOTAL = every machine observed, except `Order End` and `Pending`** - the
 * production board's own rule, read off the v4 panel source captured on
 * 2026-09-11 (`docs/grafana/panel-v4-asi.js`, and §0 of
 * docs/grafana/MACHINE-STATUS-V2.md):
 *
 * ```js
 * var EXCLUDE_FROM_TOTAL = ['Order End', 'Pending'];
 * var total = statusKeys
 *   .filter(function (k) { return EXCLUDE_FROM_TOTAL.indexOf(k) === -1; })
 *   .reduce(function (sum, k) { return sum + counts[k]; }, 0);
 * ```
 *
 * On the board that list is belt-and-braces: its content template renders no
 * card at all for either status - only a hidden `.nav-marker` the summary bar
 * counts onto a chip linking to the separate `Order End` / `Pending`
 * dashboards - so neither can reach `counts` in the first place. Both are out
 * of TOTAL either way, which is what this set reproduces.
 *
 * Why each is out: `Order End` because layer 1 of the derivation (DESIGN.md
 * §8.4) emits an EXTRA card per finished order group, so counting them would
 * count a machine twice - and because a machine can report `Order End` itself
 * when its order has run out and nothing newer has been loaded. `Pending`
 * because an operator has parked the job through the v4 widget button. Neither
 * is a statement that those machines do not exist.
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
 * `not_counted` therefore holds `Order End` and `Pending`. It stays a separate
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
  /** Observed machines left out of TOTAL. `Order End` and `Pending` - see above. */
  notCounted: number;
}

/**
 * The board's `EXCLUDE_FROM_TOTAL`, verbatim. `Pending` joined it in the panel's
 * v4 and here on 2026-09-11, off the captured source - the same day the widget
 * button that writes it stopped being a flicker and started being a state an
 * operator holds.
 *
 * Narrower than `EXCLUDE_FROM_OA` in `domain/oa.ts` on purpose: the board drops
 * `Offline` and `No Plan` from the average as well, but counts them in TOTAL,
 * because a machine that is offline or unplanned is still a machine on the
 * floor - it just has no efficiency to average.
 */
const EXCLUDED_FROM_TOTAL: ReadonlySet<MachineStatus> = new Set<MachineStatus>([
  'Order End',
  'Pending',
]);

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
