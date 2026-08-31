import type { Freshness, OaAggregation, QtyUnit, TierPolicy } from '@dashboard/contract';

/**
 * Ported from src/mocks/generate.ts's POLICY_BLOCK - the server-owned policy
 * every response carries (design doc D-16, D-20). One served value, read by
 * both the map legend and the ranking table, replaces the two-constants bug
 * (web mockup used TARGET-5/TARGET-20, Grafana hardcoded 95/80).
 */

/** Section 5 of the design doc: the group target, overridable per plant (D-07). */
export const TARGET_OA = 95;

export const TIER_POLICY: TierPolicy = {
  id: 'group_2026',
  mode: 'relative_to_target',
  target_oa: TARGET_OA,
  good_at: TARGET_OA - 5, // 90
  warn_at: TARGET_OA - 20, // 75
};

export const FRESHNESS: Freshness = {
  stale_after_sec: 120,
  no_data_after_sec: 900,
  trend_stale_after_sec: 600,
};

/**
 * D-20 - **closed 2026-08-25 in favour of the plain mean**, reversing the
 * `weighted_by_qty` this project started with.
 *
 * Reconciled against the production `Machine Status V2.0` board for plant 6332:
 * its `AVG %OA 69.8%` is reproducible only as the plain mean of the machines
 * that have an order loaded. Weighting the same four machines by output qty
 * gives 56.8% - defensible in isolation, but 13 points below the board on the
 * shop-floor wall, computed from the same rows at the same instant. See
 * server/src/domain/oa.ts for the full set of measured alternatives.
 *
 * The weighting argument (a 21-machine plant should outweigh a 2-machine one)
 * is real and unresolved; it is now a question about what the board SHOULD show,
 * which is the design owner's to answer, not something to settle silently in a
 * constant. Reverting is a one-line change here plus swapping `averageOa` for
 * `rollupOa` in the service.
 */
export const OA_AGGREGATION: OaAggregation = 'simple_avg';

export const QTY_UNIT: QtyUnit = 'pcs';

/**
 * **There is deliberately no `process` filter on any query. Do not add one.**
 *
 * The old panel filters every query by `${process_var}` - one process at a
 * time - because an operator looks at one process at a time. Copying that here
 * was tried on 2026-08-27 and **undercounted the floor**: THS 6332 carries 26
 * machines tagged `Injection` and 2 tagged `Surface` (`BP6`, `HC2`), so
 * filtering to `Injection` reported THS as 27 machines where the plant has 29.
 *
 * ```
 *                 6332   6338   THS
 *   Injection       26      1    27   <- what the per-process board shows
 *   no filter       28      1    29   <- what the site actually has
 * ```
 *
 * The exec board answers "how many machines does this company have", not "how
 * many injection machines is this operator watching", so it counts all of them.
 * That means a plant card here can legitimately read higher than the drill-down
 * board it links to, and `PlantSummary.grafana_url` still hands the user
 * `var-process_var=Injection` because that board has to pick one.
 */

export const POLICY_BLOCK = {
  target_oa: TARGET_OA,
  tier_policy: TIER_POLICY,
  oa_aggregation: OA_AGGREGATION,
  freshness: FRESHNESS,
  qty_unit: QTY_UNIT,
};
