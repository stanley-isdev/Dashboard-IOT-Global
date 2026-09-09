import type { Freshness, OaAggregation, QtyUnit, Severity, TierPolicy } from '@dashboard/contract';
import { RETENTION_DAYS } from '../influx/queries.ts';

/**
 * Ported from src/mocks/generate.ts's POLICY_BLOCK - the server-owned policy
 * every response carries (design doc D-16, D-20). One served value, read by
 * both the map legend and the ranking table, replaces the two-constants bug
 * (web mockup used TARGET-5/TARGET-20, Grafana hardcoded 95/80).
 *
 * D-16 is now closed the *other* way, on 2026-09-08: the design owner chose the
 * Grafana panel's bands over the mockup's, so the two constants have become one
 * and it is the shop floor's pair that survived. See TIER_POLICY.
 */

/** Section 5 of the design doc: the group target, overridable per plant (D-07). */
export const TARGET_OA = 100;

/**
 * The bands, and why they are literals rather than arithmetic on TARGET_OA.
 *
 * They were `TARGET-5` and `TARGET-20` - the web mockup's rule - which put good
 * at 90 and warn at 75. The operators' `Machine Status V2.0` board has always
 * coloured the same figure at 95 and 80, so a plant at 91 read green on the exec
 * screen and amber on the wall behind it. That is the bug D-16 was raised for,
 * and the decision of 2026-09-08 settles it by moving this file onto the panel's
 * numbers rather than the other way round.
 *
 * On 2026-09-09 the group target moved to 100 and the bands deliberately did
 * not follow it. For one day `good_at` happened to equal the target; that is
 * over, and the colours stay on the panel's 95/80 because the point of D-16 is
 * that the exec screen and the wall behind it colour a plant the same way.
 * Tying `good_at` to a 100% target would paint the whole board amber - no line
 * runs at a hundred - and would put the two screens back in disagreement,
 * which is the bug, not the fix.
 *
 * So the target is the aspiration the KPI strip measures the gap against, and
 * these two are what the shop floor calls acceptable. They are written out
 * rather than derived from TARGET_OA because neither tracks it any more. If the
 * bands themselves move, move the Grafana panel with them, see
 * docs/grafana/MACHINE-STATUS-V2.md.
 */
export const TIER_POLICY: TierPolicy = {
  id: 'group_2026',
  mode: 'relative_to_target',
  target_oa: TARGET_OA,
  good_at: 95,
  warn_at: 80,
};

export const FRESHNESS: Freshness = {
  stale_after_sec: 120,
  no_data_after_sec: 900,
  trend_stale_after_sec: 600,
};

/**
 * How the board decides "this site has never reached us" as opposed to "this
 * site is quiet right now" - the distinction `FRESHNESS` above cannot make.
 *
 * Every threshold in `FRESHNESS` is measured inside the picked window, so a
 * plant absent from it lands on `lastSeen: null` whether it is on a shutdown
 * week or has never sent a row in its life. Those are different facts demanding
 * different responses (common.ts's whole reason for a five-way `SiteStatus`),
 * and STJ is the case that exposed it: master data calls it `live`, the 2026-08-25
 * spike found zero rows for it (BACKEND-HANDOVER D-17, "no STJ data at all"),
 * and the board reported `no_data` - which reads to an executive as "the plant
 * is quiet" when the truth is "nothing from it has ever reached us".
 *
 * `horizon_days` is what "never" means in practice, and it is deliberately NOT
 * a number of its own: it is `RETENTION_DAYS`, the depth the rest of the server
 * already means by "as far back as this instance goes" (the calendar's floor,
 * `/meta`'s published `min`, the assembled-window ceiling). A second constant
 * here would be the two-constants bug TIER_POLICY above was raised for, in a
 * place where drift is invisible - a horizon quietly deeper than retention just
 * spends queries on days that cannot hold a row, and one quietly shallower
 * calls a site "never seen" while the evidence is still on disk.
 *
 * Re-measured 2026-09-08 with one-day probes walking backwards, and the result
 * needs stating precisely rather than rounded in our favour:
 *
 *   day -27  1,239 rows      day -31  1,222 rows
 *   day -28  1,069 rows      day -33    158 rows
 *   day -29  1,315 rows      day -35      0 rows
 *   day -30  1,369 rows      day -40..-365  0 rows
 *
 * So the data actually reaches ~33-34 days, and this horizon at 28 is
 * **shallower than what is on disk** - the second of the two failure modes
 * named above, not the harmless first. Worth being explicit about the direction
 * of that error: a shallow horizon makes a `'no'` easier to reach, so it errs
 * toward calling a site never-seen, which is the wrong way to err.
 *
 * It is still the right value. The exposure is one narrow case - a plant whose
 * newest row is 28-34 days old, evaluated before the ledger has any `'yes'` for
 * it - because anything reporting inside the hot window is marked `'yes'` for
 * free and stays that way. Set against that, tracking a second constant that
 * drifts from `RETENTION_DAYS` reintroduces exactly the two-numbers bug this
 * file was written to close, and every other reader of retention would still be
 * on 28. Revisit both together if retention is ever pinned down properly.
 *
 * The limit that follows from that is worth stating plainly rather than
 * discovering later: **a site silent for longer than the retained history is
 * indistinguishable from one that was never wired.** No design can separate
 * them - the evidence does not exist. In practice it costs almost nothing,
 * because the ledger in liveSnapshot.ts is sticky: a plant seen once stays
 * `'yes'` for the life of the process, so only a restart AFTER 30+ days of
 * silence could mislabel a real site, and a site that quiet needs a human
 * regardless.
 *
 * `slice_hours` is the part that makes the horizon reachable at all, and it is
 * not a tuning knob - see EVER_SEEN_PROBE_INTERVAL_MS's note on the file cap.
 */
export const EVER_SEEN = {
  horizon_days: RETENTION_DAYS,
  slice_hours: 24,
} as const;

/**
 * How often a plant we have never heard from is re-asked about.
 *
 * **This is a retry interval, not a poll interval**, and the difference is the
 * whole reason it can be this slow. "Has this plant ever reported" is a one-way
 * fact - once true it can never become false - so a plant that answers `yes` is
 * never asked again, for the life of the process. And a plant that starts
 * reporting is caught by the 2-second status poll within one tick anyway,
 * because it appears in that query's own window; the probe is not what notices
 * a site coming online.
 *
 * What the probe is for is the case the hot window structurally cannot see:
 * telemetry OLDER than `HOT_WINDOW_HOURS`. It answers that once, at startup,
 * and the hourly repeat exists so a probe that failed - Influx down at boot,
 * a network blip - is retried rather than leaving the site pinned to `unknown`
 * until someone restarts the service.
 *
 * **Why the horizon is walked in `slice_hours` pieces instead of one query.**
 * This instance is InfluxDB 3 Core, which does not compact its Parquet files
 * and therefore caps how many one query may touch. Measured 2026-09-08: a
 * single-plant `LIMIT 1` over 72 h answers in 76-84 ms, and the same query over
 * 84 h is refused outright - `HTTP 500 ... would scan 432 Parquet files,
 * exceeding the file limit`. A one-day window 30 days back answers in 305 ms,
 * so a wide horizon is unreachable in one read and routine in narrow ones -
 * the same conclusion windowedSnapshot.ts reached for its own chunking
 * (BACKEND-HANDOVER §4.2, and `chunkWindow` in influx/queries.ts).
 *
 * **But the cap counts FILES, not hours, and that is not the same thing.**
 * §4.2's own re-measurement on 2026-09-08 makes the point: Core never compacts,
 * recent days sit in many small files, so the file count for a fixed width
 * grows as a window approaches now - and one 71 h chunk (31 Aug - 3 Sep) was
 * refused while its nine neighbours answered. 24 h is chosen for the margin it
 * leaves under a boundary that moves, not because any width is safe by
 * construction. The full 28-slice walk was measured clean for all three plants
 * on 2026-09-08; that is evidence, not a guarantee, and `probeEverSeen` is
 * written to abort the whole walk on any refused slice rather than call a
 * partial read a negative.
 *
 * Measured end to end on 2026-09-08, newest slice first, stopping at the first
 * hit: 6332 answered in **1 query / 21 ms** and 6051 in **1 / 26 ms**, while
 * the three plants with nothing each cost the full walk - STJ-1 3,108 ms, 6337
 * 4,735 ms, 6321 3,730 ms, **11.6 s together**, with 0 refusals across all 145
 * slice reads. A reporting plant is nearly free because its newest slice hits
 * immediately; only proving a negative pays, and those are exactly the plants
 * worth paying for.
 *
 * Note the walk is **29 slices, not 28**: `chunkWindow` cuts on whole-hour
 * boundaries and `now` is not one, so a 28-day span yields 28 full slices plus
 * a partial at each end. That is why the tests bound the count instead of
 * asserting it.
 *
 * An hour is therefore generous by design, not tuned: nothing a reader can see
 * depends on it, and the daily walk's 11.6 s sits against the 2,640 queries the
 * poller makes every hour - confirmed from live config on 2026-09-08 as
 * 3600/2 + 3600/5 + 3600/30.
 */
export const EVER_SEEN_PROBE_INTERVAL_MS = 3_600_000;

/**
 * How often a plant that already gave a COMPLETE `'no'` is walked again.
 *
 * The hourly clock above is a retry, and a plant that answered is not in a
 * failure state - so re-walking all 29 slices every hour spends 2,088 queries a
 * day re-asking a question that was answered on the first one. Worse, it spends
 * them for nothing: the hot poll (every 2 s) already covers the newest 24 h, so
 * a site that STARTS reporting is noticed within one tick and marked `'yes'`
 * without this probe running at all.
 *
 * What a re-walk can still catch, and the hot poll cannot, is telemetry
 * back-filled into days that have already gone by - a real possibility if
 * STJ's instance is eventually connected and its history replayed (D-17). That
 * is rare and not urgent, so daily is the right cadence for it: 87 queries a
 * day instead of 2,088, a **96% reduction**, with the only cost being that a
 * back-fill is noticed within a day rather than within an hour.
 *
 * This directly addresses the review concern about the probe competing with a
 * reader's calendar pick - the one path that does reach InfluxDB inside a
 * request (routes/globalOverview.ts). At 11.6 s a day the probe occupies 0.013% of
 * the clock instead of 0.5%, so the overlap it could cause is proportionally
 * rarer.
 */
export const EVER_SEEN_RECHECK_INTERVAL_MS = 86_400_000;

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

/**
 * Q-06's severity, until (if ever) `production_alarm_logs` is wired in as a
 * real per-stop source. `production_machine_status` carries no severity,
 * class or reason of its own - only `Result='Stop'` and how long it has held
 * - so this buckets purely by duration. A placeholder policy, not a fact:
 * flag for the design-doc owner if duration is the wrong signal to color
 * `zAlert.severity` by. Ordered longest-threshold-first so the first match
 * wins.
 */
export const STOP_SEVERITY_BY_DURATION_SEC: { atOrAboveSec: number; severity: Severity }[] = [
  { atOrAboveSec: 2 * 60 * 60, severity: 'critical' },
  { atOrAboveSec: 30 * 60, severity: 'major' },
  { atOrAboveSec: 0, severity: 'minor' },
];

export function severityForStopDuration(durationSec: number): Severity {
  const rule = STOP_SEVERITY_BY_DURATION_SEC.find((r) => durationSec >= r.atOrAboveSec);
  // Unreachable: the last rule's threshold is 0, so it always matches.
  return rule?.severity ?? 'info';
}

export const POLICY_BLOCK = {
  target_oa: TARGET_OA,
  tier_policy: TIER_POLICY,
  oa_aggregation: OA_AGGREGATION,
  freshness: FRESHNESS,
  qty_unit: QTY_UNIT,
};
