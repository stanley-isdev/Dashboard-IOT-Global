import type {
  CompanySummary,
  FiltersApplied,
  ServedWindow,
  GlobalOverview,
  Kpi,
  PlantSummary,
} from '@dashboard/contract';
import { plantFilterActive, plantMatcher, regionMatcher, zoneMatcher } from '@dashboard/contract';
import {
  addCounts,
  companyDrilldownUrl,
  deriveTier,
  emptyCounts,
  isReporting,
  plantDrilldownUrl,
  resolveShift,
  startOfLocalDay,
  stripInternals,
  toIsoOffset,
} from '@dashboard/domain-shared';
import type { Env } from '../config/env.ts';
import {
  COMPANIES,
  type CompanyMasterData,
  type PlantMasterData,
} from '../config/masterData.ts';
import { FRESHNESS, POLICY_BLOCK, TIER_POLICY } from '../config/policy.ts';
import { OA_WINDOW_HOURS } from '../influx/queries.ts';
import { buildLongestActiveStops } from '../domain/alerts.ts';
import { buildPlantCensus } from '../domain/counts.ts';
import { buildEnvelope } from '../domain/envelope.ts';
import {
  achievementFrom,
  achievementWarnings,
  averageOa,
  countFinishedOrders,
  oaWarnings,
  orderShiftWarnings,
  pendingMachineNames,
  splitByOrderShift,
  sumMachineField,
  type MachineOa,
} from '../domain/oa.ts';
import {
  absenceFor,
  latestSeen,
  plantStatusFrom,
  rollUpCompanyStatus,
} from '../domain/siteStatus.ts';
import { buildTrend, trendWarnings } from '../domain/trend.ts';
import { sourceHealthFrom } from '../lib/sourceHealth.ts';
import type { LiveSnapshot } from './liveSnapshot.ts';

/**
 * `GET /api/v1/global-overview`.
 *
 * Phase 1 made `status` / `last_seen` / `meta.sources` real. Phase 2 makes the
 * machine census real (Q-01/Q-02), with **TOTAL = RUNNING + STOP** as the
 * design owner set it on 2026-08-25 - see server/src/domain/counts.ts for what
 * that excludes and why `machinesExpected` (Q-08) no longer feeds it.
 *
 * Phase 3 makes **%OA** real (Q-03), reconciled against the production board -
 * see server/src/domain/oa.ts for what the number means, which machines are in
 * the average and why it is a plain mean. It also makes **%Achievement** real (Q-04) - see `planFromSlots` in
 * server/src/domain/oa.ts for why the plan is `MAX`, not `SUM`, and
 * `ACHIEVEMENT_SCOPE_WARNING` for what the ratio is measured against. What
 * stays `null` is downtime_sec (needs a per-machine cumulative rollup - see
 * Phase 6 below for the one thing `StatusStartTime` DOES now feed) and defect
 * (D-18, out of scope) - `null` rather than `0`, because the contract's rule
 * R2 says absence is never a fabricated zero.
 *
 * Phase 4 makes the **hourly trend** real (Q-05) - see server/src/domain/trend.ts.
 * It is filtered through exactly the gates the KPI strip is, so the chart is a
 * history of the machines the cards are measuring. It deliberately does NOT
 * print the same number as the strip: the strip is the order each machine has
 * loaded now over a rolling 24 h, the chart is every order worked in each clock
 * hour.
 *
 * Phase 6 (2026-09-02) makes **`alerts`** real (Q-06) - see domain/alerts.ts.
 * It reads only `production_machine_status` (`Result='Stop'` + confirmed-UTC
 * `StatusStartTime`), the same rows Q-01 already polls, so it costs no second
 * query. `production_alarm_logs` (severity, class, message) is NOT joined in,
 * so `severity`/`category`/`owner` on each entry are placeholders, not real
 * classifications - flagged where they are built.
 *
 * Phase 5 (2026-08-27) **reconciles the census and %OA against the production
 * board**, using the panel source recovered into
 * docs/grafana/MACHINE-STATUS-V2.md. Measured at THS before and after:
 *
 * ```
 *            expected     before      after
 * TOTAL            29         19         29
 * RUNNING          19          5         19
 * STOP              9         14          9
 * Avg %OA       81.0%      75.2%      81.0%
 * ```
 *
 * Three divergences were found and closed. Each is documented where it lives:
 *
 *   1. **Status window 2 h -> 24 h** (`influx/queries.ts`). The board's window.
 *      The old 2 h rested on two measurements that no longer hold, and cost
 *      THS ten machines.
 *   2. **TOTAL = everything except `Order End`** (`domain/counts.ts`), which is
 *      the board's `EXCLUDE_FROM_TOTAL`, replacing TOTAL = RUNNING + STOP.
 *   3. **`Order End` layer 2** (`domain/orderShift.ts`) excluded a machine
 *      whose loaded order was created in an earlier shift from %OA - the last
 *      6 points of the %OA gap. **Reversed on 2026-09-08 by the design owner:
 *      the rule may classify but not exclude, so this divergence is back and
 *      is now deliberate.** See the fourth bullet below and the call site.
 *      **Overtaken by events, 2026-09-10: the panel this was reconciled
 *      against no longer has a layer 2 at all.** Its live SQL and JS, recaptured
 *      that day (`MACHINE-STATUS-V2.md` §0), carry no shift comparison
 *      anywhere - `Order End` there is decided by `global_machine_seq > 1`
 *      (a genuinely newer order loaded) or by an operator's own button press,
 *      never by comparing `vCreateDateTxt` to the clock. The reversal above
 *      turned out to be moot rather than wrong: there was nothing left on the
 *      other side to diverge from either way.
 *
 * A fourth was tried and **reverted**: filtering to `process = 'Injection'` the
 * way the per-process board does. It undercounts - THS has 29 machines and only
 * 27 of them are injection. See `config/policy.ts` for why no process filter
 * belongs on an exec board.
 *
 * A fifth, **`Pending`**, was found on 2026-09-10 (F-18 in `MACHINE-STATUS-V2.md`)
and **closed the same day, confirmed against IOT**: a machine an operator has
parked keeps a computable %OA from its last shot, but the board
(`EXCLUDE_FROM_OA`, §0 of that doc) drops it from the average anyway. `oa.ts`'s
`pendingMachineNames` reads the same `Pending` this file's census now sees
(`SUBSTANTIVE_STATUSES` in `influx/queries.ts`) and this function subtracts
those machines from `observedOa` before anything is averaged.

Two known, named divergences remain, both on the envelope:
 *
 *   - **Stale machines keep their last known status** rather than becoming
 *     `Offline`, because the board does the same (T-11 / F-07). A machine
 *     silent for 8 h still reads `Mass Pro`. Accepted by the design owner on
 *     2026-08-27; closing it is a staleness cutoff in `domain/counts.ts`.
 *   - **An unreadable order-creation time keeps the machine in %OA.** Zero
 *     occurrences measured - see `splitByOrderShift`. (This and the next bullet
 *     used to say "where the board blanks it" - retracted 2026-09-10, see the
 *     third numbered item above: the board has no such rule to diverge from.)
 *   - **A carried-over order keeps the machine in %OA too.** The design owner's
 *     rule of 2026-09-08: an order ends when its PO slots clear, and nothing
 *     here may declare it ended sooner. Not rare - it is every ASI machine,
 *     every day. The machines are named per plant on the envelope, without a
 *     claim about what the production board does with them.
 *
 * `machineExclusions` stays empty, and that remains a decision rather than a
 * gap: DESIGN.md §10's hardcoded list was decoded, the plant owner confirmed
 * the exclusion was retired upstream, and the board's own `AVG %OA 69.8%` only
 * reconciles if `IA1` is counted. The panel source confirms it independently -
 * the recovered query carries no machine exclusion at all (F-17).
 */

const KPI_WARNING =
  'phase-6: %OA (Q-03), %Achievement (Q-04), the hourly trend (Q-05) and alerts (Q-06) are real. The two %OA figures answer different questions and will not match: the KPI strip is the order each machine has loaded NOW over a rolling 24 h - the rule the production board follows - while each trend point is every order worked in that clock hour. Downtime is still null (needs a per-machine cumulative downtime rollup, not just each machine\'s current stop - see domain/alerts.ts), alerts severity/category/owner are duration-based placeholders pending a production_alarm_logs decision, and defect is out of scope (D-18)';

/**
 * What `plan_qty` actually is, said on the payload rather than left to the
 * card's label to imply. It is the lot size of the loaded production order -
 * ASI's are all exactly 700, THS's are 400 / 309 / 220 / 816 - so the card
 * measures progress THROUGH an order, not attainment against a shift or daily
 * target. A machine that has just started a large order honestly reads a few
 * per cent, while an executive reading "%Achievement" hears "behind plan
 * today". That is the same shape of defect as D-19 is for %OA, and it needs a
 * label/tooltip decision from the design-doc owner, not a different number.
 */
const ACHIEVEMENT_SCOPE_WARNING =
  '%Achievement is output against the LOT SIZE of the order each machine has loaded now (plan_qty0..3 of the current PO group), not against a shift or daily target - a machine early in a large order reads low by construction. An order shared across machines would be counted once per machine; none were observed (26 orders, 0 shared)';

const RECONCILIATION_WARNING =
  'counts follow the `Machine Status V2.0` board: 24 h window, TOTAL excludes `Order End` only. %OA follows the same board\'s own window for a machine\'s current order - 71 h, not 24: the panel itself now reads 3 days once an order is older than a day, confirmed against IOT 2026-09-10, and 71 is the widest a single query here may scan (see OA_WINDOW_HOURS). A machine an operator has parked in `Pending` is excluded from %OA, matching the board\'s own EXCLUDE_FROM_OA. Counted across ALL processes, unlike that board, which shows one `process_var` at a time - THS has 29 machines and only 27 are Injection, so a plant card here can read higher than the drill-down it links to. Two known differences remain: a machine that has not reported for hours keeps its last known status instead of reading `Offline` - the board does the same, and closing it would move RUNNING away from it (T-11); and a machine whose order-creation time cannot be parsed stays in %OA rather than being blanked, with zero occurrences measured. machineExclusions is empty by decision: the recovered panel query carries no machine exclusion';

/**
 * The KPI block for a node, from the machines beneath it.
 *
 * `machines` is always the MACHINE list, never the level below - see
 * `averageOa`. An empty list yields nulls throughout, which is what a site with
 * no telemetry must report.
 */
export function buildKpi(machines: MachineOa[]): Kpi {
  const oaPct = averageOa(machines);
  // Q-04. Both sums are over the SAME machine set and the SAME scope as
  // `oa_pct` - the order each machine has loaded now - because the card shows
  // the plan, the output and the ratio together. Summing the plans of every
  // order the machines touched in the 24 h window instead would put plan 16,881
  // beside actual 665 on plant 6332 and call it 12.3%.
  const plan = sumMachineField(machines, (m) => m.planQty);
  const actual = sumMachineField(machines, (m) => m.actualQty);
  return {
    oa_pct: oaPct,
    oa_tier: deriveTier(oaPct, TIER_POLICY),
    // The denominator of the average above, so the card can state it. Counts
    // the machines that actually contributed - not the ones excluded for having
    // no order, no standard time, or several orders in one shot.
    oa_machine_count: machines.filter((m) => m.oaPct !== null).length,
    achievement_pct: achievementFrom(plan, actual),
    plan_qty: plan,
    actual_qty: actual,
    shot_count: sumMachineField(machines, (m) => m.shotCount),
    // Not `0`. A site with no measured window has not had a downtime-free
    // window; it has had no window at all. `StatusStartTime`'s epoch is now
    // confirmed (influx/queries.ts), but this still needs a per-machine
    // cumulative-downtime rollup over the window, not just each machine's
    // CURRENT stop, which is all domain/alerts.ts computes.
    downtime_sec: null,
  };
}

/**
 * The two machine-level filters, travelling together because they narrow the
 * same rows in the same two places and a payload where only one of them reached
 * the %OA set is the exact defect the filter row exists to prevent.
 */
interface MachineScope {
  /** True for a machine row the Process filter keeps. */
  process: (m: { process: string | null }) => boolean;
  /** True for a machine row the Zone filter keeps. */
  zone: (m: { zone: string | null }) => boolean;
  /**
   * One machine's zone tag, or `null` when the census has not seen it.
   *
   * The %OA rows come from `production_machine_io`, which carries no `zone`
   * column, so the tag is looked up on the machine instead of selected in the
   * query. Zone is an attribute of the machine, not of a shot, so the census's
   * answer is the same answer a `GROUP BY zone` would have given - and this
   * costs no second query and no change to a reconciled SQL statement.
   *
   * A machine producing shots that the status query has no row for resolves to
   * `null` and is therefore dropped by any narrowed zone, which is the same
   * rule an untagged machine gets.
   */
  zoneOf: (plant: string, machine: string) => string | null;
}

function buildCompany(
  company: CompanyMasterData,
  snapshot: LiveSnapshot,
  oaByPlant: Map<string, MachineOa[]>,
  /** The instant liveness and freshness are measured from - the window's end. */
  asOf: Date,
  /** The wall clock, for the site's header clock only. Never for an age. */
  now: Date,
  warnings: string[],
  plantInScope: (p: { code: string }) => boolean,
  scope: MachineScope,
): {
  company: CompanySummary;
  oaMachines: MachineOa[];
  oaPlants: PlantMasterData[];
  censusPlants: PlantMasterData[];
} {
  const nowMs = asOf.getTime();


  /*
   * The Lamp filter is applied HERE, before liveness, so every figure above it
   * is built from the same plant set: status roll-up, counts, %OA and the trend
   * all narrow together. Filtering later - say, only the counts - is how a
   * company ends up reading `online` off plants whose machines are not in its
   * own total.
   */
  const scopedPlants = company.plants.filter(plantInScope);

  // Pass 1: liveness only. The company's status is a roll-up of its plants',
  // and whether the company reports decides whether anything may be counted.
  const base = scopedPlants.map((master) => {
    // Keyed on plant code, because `codeCompany` is NULL on almost every row
    // (BACKEND-HANDOVER §4.3a). Master data owns plant -> company.
    const lastSeen =
      company.readiness === 'live' ? (snapshot.plants[master.code]?.lastSeen ?? null) : null;
    /*
     * Absent from the ledger means the probe has not answered for this plant -
     * a poller built without `plantCodes`, or a boot whose first probe has not
     * landed. `'unknown'` keeps the pre-existing behaviour until it does, which
     * is why adding this input cannot regress a site that was reading correctly.
     */
    const everSeen = snapshot.everSeen[master.code] ?? 'unknown';
    return {
      master,
      lastSeen,
      status: plantStatusFrom({
        readiness: company.readiness,
        lastSeen,
        everSeen,
        nowMs,
        freshness: FRESHNESS,
      }),
    };
  });

  const status = rollUpCompanyStatus(
    company.readiness,
    base.map((b) => b.status),
  );
  // A site that is not reporting contributes nothing to any census, at any
  // level - the `unconnected-site-contributes-nothing` invariant. Its plants
  // are zeroed too, so a company never disagrees with the sum of its plants.
  const reporting = isReporting(status);

  /*
   * Resolved before the plants are built, not after: `Order End` layer 2 judges
   * each machine's loaded order against THIS company's current shift, so the
   * shift has to exist before any plant's %OA set is decided.
   *
   * As at `asOf`, not `now`, for the same reason liveness is. The rule asks
   * "was this order created in the shift being looked at" - and against a
   * window that ended three weeks ago, the shift running at THIS instant is not
   * a shift any of those orders could have been created in. Every machine then
   * fails layer 2, drops out of the %OA set, and the strip's efficiency,
   * achievement and attention cards all come back null on a window whose rows
   * are full of production. That is the whole KPI half of the board going blank
   * on exactly the historical windows the date picker exists to serve.
   */
  const shift = resolveShift(company.shiftConfig, asOf);

  /*
   * Midnight of this company's own calendar day, which is the window the
   * `Order End` cards are counted over - `Counts.finished_orders`.
   *
   * Not the shift and not the production date, both of which are resolved right
   * above and are the wrong clock for this one figure: the production boards'
   * pickers are pinned to Grafana's `now/d`, and at THS that is 00:00 while the
   * production day opens at 08:00. Measured on 2026-09-10 at 09:45 Bangkok, the
   * two answers were 19 orders and 0.
   *
   * As at `asOf` for the same reason the shift is: on a historical window the
   * question is which orders ended on the day being looked at, not which ended
   * today.
   */
  const dayStart = startOfLocalDay(asOf, company.timezone);

  const built = base.map((b) => {
    /*
     * Gated on the COMPANY reporting, not on this plant's freshness label.
     *
     * It used to be gated on both, so a plant that had aged past
     * `no_data_after_sec` (15 min) contributed nothing even while its
     * machine rows sat inside the query window. With the window now 24 h
     * that gap is hours wide, and it cost real machines: THS 6338's
     * freshest row was 310 min old on 2026-08-27, so the board showed its
     * one machine and we showed none.
     *
     * The board has no freshness concept at all - it counts whatever is in
     * its 24 h window - so matching it means the census follows the window
     * and the freshness LABEL travels beside it instead of erasing it.
     * `last_seen` and the plant's `status` still say the site is quiet, so
     * the row reads "no data · 1 running", which is strictly more than the
     * board says rather than less.
     *
     * The company-level gate stays, and it is what keeps the
     * `unconnected-site-contributes-nothing` invariant true: a company
     * whose plants have ALL gone silent rolls up to `no_data` and zeroes
     * here. Read regardless of `reporting` - cheap, and `pendingMachines`
     * below needs it even though `observedOa` will end up empty when the
     * company is not reporting.
     */
    const observations = (snapshot.machines[b.master.code] ?? [])
      .filter(scope.process)
      .filter(scope.zone);

    const census = reporting
      ? buildPlantCensus({ observations, machineExclusions: b.master.machineExclusions })
      : null;

    // `Order End` is the board's only exclusion from TOTAL, and it exists there
    // to avoid double-counting a machine that also has a live card. Said on the
    // payload anyway - a number dropped from a display is a presentation
    // choice; a number dropped without a trace is a lie.
    if (census && census.notCounted > 0) {
      warnings.push(
        `${company.code}/${b.master.code}: ${census.notCounted} of ${census.observed} reporting machines are in \`Order End\` and are excluded from TOTAL, as they are on the production board`,
      );
    }

    /*
     * A machine an operator has parked in `Pending` (`production_machine_status`,
     * via the panel's v4 widget button - MACHINE-STATUS-V2.md §0) has its %OA
     * dropped below, matching the production board's `EXCLUDE_FROM_OA`.
     * Confirmed against IOT, 2026-09-10: a parked machine's %OA should not
     * count even though it is still computable from its last shot. Read off
     * the census's own observations rather than the IO table, because
     * "parked or not" is a fact about `production_machine_status`, not about
     * `production_machine_io`.
     */
    const pendingMachines = pendingMachineNames(observations);
    if (pendingMachines.size > 0) {
      warnings.push(
        `${company.code}/${b.master.code}: ${pendingMachines.size} machine(s) are \`Pending\` (parked by an operator) and are excluded from %OA, as they are on the production board (${[...pendingMachines].sort().join(', ')})`,
      );
    }

    /*
     * %OA comes from a different table than the census - `production_machine_io`
     * rather than `production_machine_status` - so the two machine sets are not
     * guaranteed to agree, and this deliberately does not force them to. The old
     * board's %OA cards are driven by the IO rows too, so reconciling means
     * following the same source. Where they disagree the payload shows both
     * honestly: a machine can be counted as Stop and still carry a %OA for the
     * order it has loaded, which is exactly what I5 did on the board (STOP, with
     * order 110000962985 at 47.5%).
     *
     * Gated on the company reporting, the same gate the census now uses - a
     * plant's own freshness label no longer suppresses its figures, because the
     * board it is reconciled against has no such concept. See the census gate
     * above for what that changed and why.
     */
    const publishes = reporting;
    const observedOa = publishes
      ? (oaByPlant.get(b.master.code) ?? [])
          .filter((m) => !b.master.machineExclusions.includes(m.machine))
          // The same two gates as the census above it, in the same order. A
          // %OA averaged over a different machine set than the one TOTAL counts
          // is the defect the whole filter row exists to prevent.
          .filter(scope.process)
          .filter((m) => scope.zone({ zone: scope.zoneOf(m.plant, m.machine) }))
          // Parked machines stay OUT of %OA, matching the production board -
          // see `pendingMachines` above for why this one is a real, intentional
          // exclusion rather than the layer-2 kind that stopped applying.
          .filter((m) => !pendingMachines.has(m.machine))
      : [];

    /*
     * `Order End` layer 2 (DESIGN.md §8.4) - and what it is allowed to do.
     *
     * It classifies each machine's loaded order as belonging to the current
     * shift or not, judged against THIS company's shift rather than a hardcoded
     * 08:00/20:00 (the panel hardcodes that split; §9.5 records that it is wrong
     * for STJ's three shifts).
     *
     * **It does not remove anything from %OA. Design owner, 2026-09-08.** A
     * carried-over order is still a running order: the machine stays in the
     * average until the order genuinely ends, which the data says plainly by
     * clearing the PO slots. Inferring "finished" from the creation timestamp
     * and dropping the figures on that inference is what this rule may no
     * longer do.
     *
     * The cost is known and accepted: layer 2 as an exclusion is what once
     * closed the last gap to the production board (THS 75.2% -> 81.0% on
     * 2026-08-27), so this board can now read below that board by exactly the
     * carried-over machines. `orderShiftWarnings` names them on every payload,
     * so the difference is stated rather than left to be discovered.
     *
     * What made a universal rule out of a THS-shaped one: ASI 6051 runs a
     * single order across days. On 2026-09-08 that blanked its %OA card
     * entirely - seven machines, all shooting, a real 75.0% average, every one
     * of them ruled `ended` because the order was created the previous morning.
     *
     * No window gate any more, either. The rule used to be switched off past
     * `OA_WINDOW_HOURS` because a multi-shift window has no single shift to
     * judge against; with the verdict no longer touching the number, wide and
     * narrow windows now answer alike, and the gate had nothing left to guard.
     */
    const oaSplit = splitByOrderShift(observedOa, shift);
    const oaMachines = observedOa;

    const node = `${company.code}/${b.master.code}`;
    for (const w of orderShiftWarnings(node, oaSplit)) warnings.push(w);
    for (const w of oaWarnings(node, oaMachines)) warnings.push(w);
    for (const w of achievementWarnings(node, oaMachines)) warnings.push(w);

    const plant: PlantSummary = {
      code: b.master.code,
      label: b.master.label,
      status: b.status,
      data_readiness: company.readiness,
      // Inherited from the company: master data records an absence at company
      // level, and a plant of a site nobody can reach is unreachable for the
      // same reason.  returns null the moment the plant reports.
      absence: absenceFor({
        status: b.status,
        readiness: company.readiness,
        note: company.absence,
      }),
      // Kept even when the plant has aged into `no_data`: "last seen 40 minutes
      // ago" is the fact that separates a quiet site from a dead one (T-11).
      last_seen: b.lastSeen,
      grafana_url: plantDrilldownUrl(b.master.code),
      target_oa: b.master.targetOa,
      /*
       * The census, plus the one figure in it that does not come from the
       * census query at all.
       *
       * `Order End` is not a status any machine reports - it is derived from
       * the ORDER rows, which is why it reaches the counts from `oaMachines`
       * and not from `buildPlantCensus`. Same scope as everything else on this
       * plant: `oaMachines` has already been through the process and zone
       * filters and the machine exclusions, so a filtered board counts the
       * finished orders of the machines it is showing and no others.
       */
      counts: census
        ? { ...census.counts, finished_orders: countFinishedOrders(oaMachines, dayStart) }
        : emptyCounts(),
      kpi: buildKpi(oaMachines),
    };
    return { plant, oaMachines, publishes, master: b.master };
  });

  /*
   * Plants that have NEVER reported are left off the board.
   *
   * THS's 6337 and 6321 are the case: master data lists them with 8 and 2
   * machines, no row of either has ever arrived, and a permanently dark tile
   * beside two working ones is noise an executive has to learn to ignore -
   * which is how real problems get ignored too. The design owner asked for them
   * to be hidden on 2026-09-08.
   *
   * **This hides nothing that could come back on its own, and it reverses
   * itself.** The filter reads `everSeen`, which is an observation, not a
   * setting: the moment either plant sends a single row the 2-second hot poll
   * marks it `'yes'` and the tile reappears with no config edit, no deploy and
   * nobody having to remember. That is the whole reason this is keyed on the
   * ledger rather than on a hand-maintained hidden-plants list.
   *
   * Three deliberate limits:
   *   - `'unknown'` is NOT hidden. A probe that has not landed or has been
   *     failing is uncertainty, and hiding on uncertainty would make a site
   *     vanish because Influx was briefly unreachable.
   *   - A plant that HAS reported and went quiet stays on the board however
   *     long it is silent - that is `no_data`, the outage case, and hiding it
   *     would be the worst bug this file could have.
   *   - The company's own status is rolled up from `base` above, before this
   *     filter, so hiding a dark plant cannot flatter the company it belongs
   *     to. Numerically the filter is inert either way: a `not_connected` plant
   *     already carries `emptyCounts()` and a null `last_seen`.
   *
   * The full plant roster, hidden ones included, is still served on `/meta`.
   */
  const plants: PlantSummary[] = built
    .filter((b) => (snapshot.everSeen[b.master.code] ?? 'unknown') !== 'no')
    .map((b) => b.plant);
  // Flat, not a mean of the plant means: one definition of "average %OA" for
  // every level of the board. See averageOa.
  const oaMachines = built.flatMap((b) => b.oaMachines);
  /*
   * Which plants passed the liveness gate, for the trend (Q-05) to filter by.
   *
   * The trend cannot reuse `oaMachines`: those are the machines with an order
   * loaded NOW, and an hour on the chart is measured over whatever was running
   * THEN - a machine that finished its order twenty minutes ago belongs on the
   * 06:00 point and is absent from this list. Gating by plant is the same gate
   * one level up, so a site that has aged into `no_data` still stops publishing
   * a chart, without also erasing the hours it produced before it went quiet.
   */
  const oaPlants = built.filter((b) => b.publishes).map((b) => b.master);

  /*
   * The plants the CENSUS was taken over: `scopedPlants`, so the Lamp filter is
   * in and the liveness gate is not.
   *
   * Distinct from `oaPlants` above, and the difference is why both are returned.
   * `oaPlants` is gated on `publishes`, which is a statement about the trend - a
   * site that has aged into `no_data` stops drawing a chart. The census has no
   * freshness concept at all (see the long note at its `buildPlantCensus` call),
   * so a plant that has gone quiet still contributes the machines sitting in the
   * query window. Q-06 is cut from census rows, so it has to follow the census
   * set; cutting it with `oaPlants` would drop a real open stop at a plant whose
   * freshest row is sixteen minutes old.
   */
  const censusPlants = built.map((b) => b.master);


  return {
    company: {
      code: company.code,
      name: company.name,
      name_th: company.nameTh,
      country_code: company.countryCode,
      lat: company.lat,
      lng: company.lng,
      timezone: company.timezone,
      absence: absenceFor({
        status,
        readiness: company.readiness,
        note: company.absence,
      }),
      local_time: toIsoOffset(now, company.timezone),
      shift: shift ? stripInternals(shift) : null,
      status,
      data_readiness: company.readiness,
      last_seen:
        company.readiness === 'live' ? latestSeen(plants.map((p) => p.last_seen)) : null,
      /*
       * A company row links to a PLANT board, because there is no company one -
       * see @dashboard/domain-shared. Taken from the scoped plants, so the link
       * follows the Lamp filter rather than pointing outside what the row is
       * counting, and `null` for a site nobody has supplied a board for.
       */
      grafana_url: companyDrilldownUrl(scopedPlants),
      counts: reporting ? addCounts(plants.map((p) => p.counts)) : emptyCounts(),
      kpi: buildKpi(oaMachines),
      plants,
    },
    oaMachines,
    oaPlants,
    censusPlants,
  };
}

/**
 * Plant code to the company that owns it. Master data is the only place this
 * mapping exists - InfluxDB leaves `codeCompany` NULL on 98.6% of rows
 * (BACKEND-HANDOVER §4.3a), so a plant with no entry here belongs to nobody on
 * this board and is reported as an orphan rather than guessed into a company.
 */
const companyOfPlant = new Map<string, string>(
  COMPANIES.flatMap((c) => c.plants.map((p) => [p.code, c.code] as const)),
);

/**
 * Groups the flat %OA rows by plant once per request. Built here rather than in
 * the poller because the poller's job is to fetch, and a plant code that master
 * data has never heard of has to survive the trip to be reported - dropping it
 * at fold time would hide a real gap between InfluxDB and the config.
 */
function indexOaByPlant(rows: MachineOa[]): Map<string, MachineOa[]> {
  const out = new Map<string, MachineOa[]>();
  for (const row of rows) {
    const list = out.get(row.plant);
    if (list) list.push(row);
    else out.set(row.plant, [row]);
  }
  return out;
}

/** True age of the underlying data, so the UI shows when it was read, not when it was sent. */
function cacheAgeSec(snapshot: LiveSnapshot, nowMs: number): number | undefined {
  if (!snapshot.lastSuccessAt) return undefined;
  const ms = nowMs - new Date(snapshot.lastSuccessAt).getTime();
  return Number.isNaN(ms) ? undefined : Math.max(0, Math.round(ms / 1000));
}

export function buildGlobalOverview(opts: {
  snapshot: LiveSnapshot;
  filters: FiltersApplied;
  /**
   * The window `snapshot` was measured over - resolved by the route, not
   * inferred here.
   *
   * Required rather than defaulted, because a default would be a claim about
   * data this function did not fetch. The route knows whether it served the
   * poller's 24 h or assembled a window of its own; this only reports it.
   */
  window: ServedWindow;
  env: Env;
  now?: Date;
}): GlobalOverview {
  const now = opts.now ?? new Date();
  const { snapshot, filters, window, env } = opts;

  /*
   * The instant everything about the DATA is measured against - the end of the
   * served window, not the wall clock.
   *
   * The two are the same for every `now`-anchored window, which is nearly every
   * request, so this changes nothing on the default path. It matters the moment
   * a reader picks a window that ended days ago, and it is not a nicety: site
   * liveness, stop durations and the trend's hour slots are all ages measured
   * from something, and measuring them from `now` while the rows come from last
   * week makes every site read "not reporting", empties the chart, and inflates
   * every stop by however long ago the window was.
   *
   * The project's own integrity checks are what surfaced this - a historical
   * window produced alerts attributed to companies the same payload described
   * as not reporting, which is incoherent rather than merely odd. "Was this
   * site reporting?" only has a meaningful answer as at the end of the window
   * being asked about.
   *
   * `now` stays in use for the things that really are about the present: the
   * envelope's `generated_at`, the per-company header clock, the cache age, and
   * the health of the sources themselves.
   */
  const asOf = new Date(Date.parse(window.to) || now.getTime());
  const warnings = [KPI_WARNING, ACHIEVEMENT_SCOPE_WARNING, RECONCILIATION_WARNING];

  /*
   * Wider than the window the %OA figure was reconciled in.
   *
   * `Order End` layer 2 used to be switched off here, on the grounds that a
   * multi-shift window has no single shift to judge an order's creation time
   * against. Since 2026-09-08 that rule excludes nothing at any width, so there
   * is no behaviour left to gate. What survives is the honest caveat: the
   * reconciliation against the production board was measured over a rolling
   * `OA_WINDOW_HOURS` (71 h as of 2026-09-10, matching the board's own 3-day
   * rule for orders older than a day - see that constant's comment), and this
   * window is not that.
   *
   * Measured on the SERVED window rather than on `range`, so a clamped or
   * absolute window is judged on what was actually read.
   */
  if (window.hours > OA_WINDOW_HOURS) {
    warnings.push(
      `this window spans ${Math.round(window.hours)} h, wider than the ${OA_WINDOW_HOURS} h that ` +
        '%OA was reconciled against the production board in, so %OA and %Achievement here describe ' +
        'the newest order each machine worked inside the window rather than the one it is running now',
    );
  }

  const historical = asOf.getTime() < now.getTime() - 60_000;
  if (historical) {
    warnings.push(
      `this board is a historical window ending ${window.to}: liveness, stop durations and the ` +
        'chart are measured as at that instant, not as at now',
    );
  }

  /*
   * The Process filter - the plant board's `${process_var}`, and now really
   * applied rather than echoed.
   *
   * A machine with no `process` tag is kept under `all` and dropped by any
   * narrower scope: "we do not know which process this is" cannot satisfy
   * "Injection only" without inventing the answer.
   */
  const wantProcess = filters.process;
  const processInScope = (m: { process: string | null }) =>
    wantProcess === 'all' || m.process === wantProcess;

  /*
   * The Zone filter - the plant board's `${Zone_var}`, one level below the Lamp
   * picker and matched on the machine, because `zone` is a tag on the machine
   * and no site row above it carries one.
   *
   * Parsed once here rather than per plant: the predicate runs over every
   * machine of every company on every request.
   */
  const zoneInScope = zoneMatcher(filters.zone);

  /*
   * machine -> its tags, from the census rows, for the two tables that carry
   * neither: the %OA rows (`production_machine_io`) and the hourly trend rows.
   * Built once and shared by every company; the key is `plant|machine` because
   * machine names repeat across plants (`I1` exists at more than one) and a map
   * keyed on the name alone would put one plant's zone on another plant's
   * machine.
   */
  const tagsOfMachine = new Map<string, { process: string | null; zone: string | null }>();
  for (const [plant, machines] of Object.entries(snapshot.machines)) {
    for (const m of machines) {
      tagsOfMachine.set(`${plant}|${m.machine}`, { process: m.process, zone: m.zone });
    }
  }
  const tagsOf = (plant: string, machine: string) =>
    tagsOfMachine.get(`${plant}|${machine}`) ?? { process: null, zone: null };
  const machineScope: MachineScope = {
    process: processInScope,
    zone: zoneInScope,
    zoneOf: (plant, machine) => tagsOf(plant, machine).zone,
  };
  if (snapshot.unknownStatuses.length > 0) {
    warnings.push(
      `unrecognised machine status from InfluxDB, excluded from the census: ${snapshot.unknownStatuses.slice(0, 5).join('; ')}`,
    );
  }

  if (!snapshot.oaOk && snapshot.oaError) {
    warnings.push(
      snapshot.oaLastSuccessAt
        ? `%OA is stale: the production query last succeeded at ${snapshot.oaLastSuccessAt} and is now failing (${snapshot.oaError})`
        : `%OA unavailable: the production query has never succeeded (${snapshot.oaError})`,
    );
  }

  // Said separately from the %OA warning above even though the two queries run
  // on one clock: they fail independently, and "the chart is an hour old" is a
  // different statement to the reader than "the KPI strip is".
  if (!snapshot.trendOk && snapshot.trendError) {
    warnings.push(
      snapshot.trendLastSuccessAt
        ? `trend is stale: the hourly query last succeeded at ${snapshot.trendLastSuccessAt} and is now failing (${snapshot.trendError})`
        : `trend unavailable: the hourly query has never succeeded (${snapshot.trendError})`,
    );
  }

  const oaByPlant = indexOaByPlant(snapshot.oa);

  // A plant producing shots that master data has never heard of is output nobody
  // on this board can see. Silence here would read as "no such plant".
  const orphans = [...oaByPlant.keys()].filter((p) => !companyOfPlant.has(p)).sort();
  if (orphans.length > 0) {
    warnings.push(
      `InfluxDB reports production for plant(s) absent from master data, excluded from every KPI: ${orphans.join(', ')}`,
    );
  }

  const inPlantScope = plantMatcher(filters.plant);
  const plantsNarrowed = plantFilterActive(filters.plant);

  const built = COMPANIES.map((c) =>
    buildCompany(
      c,
      snapshot,
      oaByPlant,
      // As at the end of the window, not as at now - see `asOf` above.
      asOf,
      now,
      warnings,
      inPlantScope,
      machineScope,
    ),
  );
  // Filtered as pairs, so the machines behind the totals can never drift out of
  // step with the companies on screen.
  const inScope = regionMatcher(filters.region);
  const shown = built.filter(
    (b) =>
      inScope(b.company) &&
      // A company with no plant left in scope is not a row with zeroes in it -
      // it is a company the reader did not ask about. Only when the Lamp filter
      // is narrowing: with `all`, every company keeps its plants and this is a
      // no-op.
      (!plantsNarrowed || b.company.plants.length > 0),
  );
  const companies = shown.map((b) => b.company);

  // Coverage: the denominator is the reporting set only, never the full nine.
  // A site with no gateway must not drag the group average toward zero.
  const reporting = shown.filter((b) => isReporting(b.company.status));
  const reportingCompanies = reporting.map((b) => b.company);
  // Every machine under a reporting site, flattened - the group figure is a mean
  // of machines, not of companies, so a two-machine company cannot swing it as
  // hard as a twenty-machine one.
  const reportingMachines = reporting.flatMap((b) => b.oaMachines);

  /*
   * Q-05. Filtered through the SITE-level gates the KPI strip is filtered
   * through - the region filter, the company liveness roll-up, the per-plant
   * liveness check and `machineExclusions` - so the chart is a history of the
   * same plants the cards above it are measuring.
   *
   * **Not** through the two machine-level ones, and that is an open gap rather
   * than a decision: narrow the board to one process or one zone and the cards
   * move while this chart still draws the whole plant. The hourly rows carry
   * neither tag (`MachineHourOaRow` is bucket/plant/machine/order only), so the
   * only way to gate them is through `tagsOf` above - and a machine the census
   * has no row for would then be dropped from the chart entirely rather than
   * merely uncounted. The two tables are explicitly allowed to disagree about
   * which machines exist (see the %OA note in buildCompany), so that trade -
   * a possibly-blank chart against a chart that is too wide - is the design
   * owner's to make, not one to settle silently while wiring a filter.
   * Applying it is a two-line change here once it is settled.
   */
  const trendPlants = new Map(
    reporting.flatMap((b) => b.oaPlants.map((p) => [p.code, p.machineExclusions] as const)),
  );

  /*
   * Q-06's scope, as a predicate over census rows.
   *
   * Every other figure in this payload is built from `shown` and `reporting`,
   * which carry the region and Lamp filters, and through `machineScope`, which
   * carries Process and Zone. The alerts were built from the raw snapshot
   * instead, and that was a defect rather than an approximation: scope the board
   * to one base and the panel still listed stops at the bases the reader had
   * filtered out. `alert-provenance` in @dashboard/domain-shared is the rule that
   * says so - a company absent from `companies` cannot be reporting a fault in
   * the same payload - and with violations fatal outside production the response
   * was a 500, so `?region=THS` returned no board at all.
   *
   * Assembled from the same four gates the STOP figure passes, in the same
   * order, so the list and the number above it count one machine set:
   *
   *   plant of a company on screen AND reporting  ->  `censusPlants`
   *   machine not excluded by master data         ->  `machineExclusions`
   *   machine kept by the Process filter          ->  `machineScope.process`
   *   machine kept by the Zone filter             ->  `machineScope.zone`
   */
  const censusPlants = new Map(
    reporting.flatMap((b) => b.censusPlants.map((p) => [p.code, p.machineExclusions] as const)),
  );
  const alertInScope = (m: {
    plant: string;
    machine: string;
    process: string | null;
    zone: string | null;
  }): boolean => {
    const exclusions = censusPlants.get(m.plant);
    if (exclusions === undefined || exclusions.includes(m.machine)) return false;
    return machineScope.process(m) && machineScope.zone(m);
  };
  const trendBuild = buildTrend({
    hours: snapshot.trend.filter((h) => {
      const exclusions = trendPlants.get(h.plant);
      return exclusions !== undefined && !exclusions.includes(h.machine);
    }),
    /* The newest bucket is the window's last hour, not the current one: a
       historical window binned against `now` would slot last week's rows into
       hours that have not happened and draw an empty chart. */
    now: asOf,
    /*
     * As many hourly buckets as the served window holds, not a constant 24.
     *
     * TREND_POINTS was right while every response covered the poller's fixed
     * day; now that the window is the reader's, a 24-bucket chart under a
     * seven-day board would draw the last day and caption it as a week. Bounded
     * below at 2 because buildTrend needs a span to bin into, and rounded
     * because a clamped window is not a whole number of hours.
     */
    points: Math.max(2, Math.round(window.hours)),
    siteOf: (plant) => companyOfPlant.get(plant) ?? null,
  });
  for (const w of trendWarnings(trendBuild)) warnings.push(w);

  return {
    ...POLICY_BLOCK,
    meta: buildEnvelope({
      sources: sourceHealthFrom(snapshot, env, now.getTime()),
      warnings,
      cacheAgeSec: cacheAgeSec(snapshot, now.getTime()),
    }),
    filters_applied: filters,
    window,
    totals: {
      counts: addCounts(reportingCompanies.map((c) => c.counts)),
      ...buildKpi(reportingMachines),
      // Counted off the tier the backend already resolved, so the headline and
      // the ranking table cannot disagree about who is in trouble. A site whose
      // %OA is unknown is not "needing attention" - it is unmeasured, and the
      // no-data chip says so.
      companies_needing_attention: reportingCompanies.filter(
        (c) => c.kpi.oa_tier === 'critical',
      ).length,
      plants_needing_attention: reportingCompanies
        .flatMap((c) => c.plants)
        .filter((p) => p.kpi.oa_tier === 'critical').length,
      companies_reporting: reportingCompanies.length,
      companies_total: companies.length,
      countries_total: new Set(companies.map((c) => c.country_code)).size,
    },
    companies,
    trend: trendBuild.points,
    // Q-06 - see domain/alerts.ts for what this reads and what it still
    // cannot know (severity/category/owner are placeholders, not real
    // classifications, pending a decision on production_alarm_logs).
    // `asOf`, so a stop still open at the end of a historical window is
    // reported at the length it had reached THEN - measuring to `now` would add
    // however long ago the window was to every row.
    alerts: buildLongestActiveStops(
      snapshot,
      companyOfPlant,
      asOf,
      filters.alertsLimit ?? 10,
      alertInScope,
    ),
  };
}
