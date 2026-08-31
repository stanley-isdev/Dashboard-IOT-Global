import { ident, literal } from './client.ts';

/**
 * Hard ceiling from BACKEND-HANDOVER §4.2: windows of 4 days and wider return
 * HTTP 500 with an empty body. 71h keeps a margin under the 72h boundary that
 * still worked, so a caller cannot walk off the cliff by passing a big number.
 */
const MAX_WINDOW_HOURS = 71;

/**
 * One query serves both Q-07 (last-seen per plant) and Q-01 (latest status per
 * machine): the per-machine rows carry everything the plant roll-up needs, so
 * asking twice would cost twice and risk the two answers disagreeing.
 *
 * Deliberately keyed on `plant`, NOT `codeCompany`: the live instance leaves
 * `codeCompany` NULL on 98.6% of `production_machine_status` rows, so filtering
 * or grouping by it discards nearly all the telemetry (BACKEND-HANDOVER §4.3a).
 * `plant` is populated on every row, and master data maps plant -> company.
 */

/**
 * Twenty-four hours - **the window the production board uses**
 * (`now() - INTERVAL '1 days'`, docs/grafana/MACHINE-STATUS-V2.md §2.1).
 *
 * Was 2 h, on two claims that both turned out to be wrong when measured
 * against the live instance on 2026-08-27:
 *
 *   - *"a 2 h window returns the same machines as a 71 h one"* - it does not.
 *     THS 6332 returns **20 machines at 2 h and 28 at 24 h**, and THS 6338
 *     disappears entirely (its freshest row was 310 min old). Machine
 *     staleness across THS: 6 under 15 min, 13 at 15-60 min, 2 at 1-2 h, 1 at
 *     2-6 h, **7 at 6-24 h**, 1 over 24 h. BACKEND-HANDOVER §4.5's "widest
 *     observed gap ~1.8 h" does not hold on this data.
 *   - *"at a tenth of the cost"* - it is not. Re-measured back to back:
 *     **2 h = 513 ms, 24 h = 514 ms.** The window is not what the query costs.
 *
 * The consequence of the 2 h window was a THS census of 19 machines against
 * the board's 27, with Running reading 5 against the board's 13.
 *
 * **Known and accepted (design owner, 2026-08-27): this inherits the board's
 * staleness behaviour.** A machine that last reported 8 h ago still carries its
 * last known status, so it counts as `Mass Pro` rather than `Offline`. That is
 * exactly the T-11 / `Offline`-is-never-emitted gap the old board never closed
 * (docs/grafana/MACHINE-STATUS-V2.md F-07). Closing it here is a one-constant
 * change - a staleness cutoff applied in domain/counts.ts - but it would move
 * Running away from the board again, so it waits for that to be the ask.
 */
/**
 * **Back to 24 h on 2026-08-27**, which is what the panel's SQL says all along
 * (`now() - INTERVAL '1 days'`).
 *
 * It was briefly widened to 71 h to explain why the Lamp 2 board showed 29
 * machines at plant 6332 while only 28 had reported inside 24 h. The 29th
 * looked like `AF2` (Surface, Stop, last seen 53 h ago), and widening the window
 * did produce 29 - but for the wrong reason.
 *
 * What settled it: the board's own `PROCESS = Surface` view lists **BP6, HC2,
 * P1TC1** - not `AF2`. So the board is NOT reaching back past two days; it
 * simply has machines this instance does not (`P1TC1` appears nowhere in either
 * table here, and neither do the three extra Injection machines that make its
 * Injection view 29 against our 26). That is a datasource question - D-17, three
 * different InfluxDB UIDs across the Grafana dashboards - not a window one.
 *
 * 24 h is also the honest number on its own terms: a machine that has not spoken
 * in 53 hours is not a machine an executive board should be counting as `Stop`.
 */
export const HOT_WINDOW_HOURS = 24;

export interface LatestMachineStatusRow {
  plant: string | null;
  machine: string | null;
  /**
   * The `process` tag - the board's `${process_var}`.
   *
   * Carried on the row rather than filtered in SQL: the poller fetches every
   * machine once and each request narrows in memory, so one snapshot serves
   * every process scope without a query per filter.
   */
  process: string | null;
  /**
   * The `zone` tag - the board's `${Zone_var}`.
   *
   * Carried for one reason only: the drill-down link. Zone values are
   * plant-specific (`6332` uses `2A-A`..`2B-B`, `6051` uses `A`..`F`), so a
   * link that does not name them opens the board on whatever zone it happens to
   * default to. Nothing here counts or groups by it - see @dashboard/domain-shared's grafana.ts.
   */
  zone: string | null;
  /** Raw `Result`. Not typed as MachineStatus - the DB is free to emit anything. */
  result: string | null;
  last_seen: string | null;
}

function assertWindow(windowHours: number): void {
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > MAX_WINDOW_HOURS) {
    throw new Error(
      `windowHours must be an integer in 1..${MAX_WINDOW_HOURS} (got ${windowHours}). ` +
        'Wider windows return HTTP 500 with an empty body - see BACKEND-HANDOVER §4.2.',
    );
  }
}

/**
 * Statuses that describe what a machine is DOING. A machine's bucket comes from
 * the most recent of these, not from the most recent row.
 *
 * The three left out - `Warning`, `Alarm`, `Pending` - are flags that flap on
 * and off a machine that never stopped producing. Measured on 2026-08-27, THS
 * 6332 machine `HC2` over 71 h: `Warning` 78 rows, `Mass Pro` 63, `Alarm` 14,
 * `Stop` 2, and the last twelve rows read
 *
 *     Warning <- Mass Pro <- Warning <- Mass Pro <- Warning <- Mass Pro ...
 *
 * with every `Alarm` row sandwiched between two `Warning`s. Taking the newest
 * row made that machine alternate between RUNNING and STOP on the executive
 * strip every few seconds, and put our RUNNING one below the plant board's for
 * whichever half of the flap we happened to sample.
 *
 * Safe to skip them: every machine that has ever emitted one also emits core
 * statuses (verified for all ten such machines across THS/ASI over 71 h), so
 * this can never erase a machine from the census - it only ever answers "what
 * was it last actually doing".
 *
 * `4M Change`, `No Plan`, `Order End` and `Offline` stay IN: those are things a
 * machine is doing, not flags raised over it, and D-21 is about which bucket
 * `4M Change` belongs in - not about whether it happened.
 */
const SUBSTANTIVE_STATUSES = [
  'Mass Pro',
  'Dandori',
  'Stop',
  'No Plan',
  'Order End',
  '4M Change',
  'Offline',
];

/** Q-01: one row per machine, carrying its most recent status inside the window. */
export function latestMachineStatusSql(windowHours: number = HOT_WINDOW_HOURS): string {
  assertWindow(windowHours);
  return [
    'SELECT plant, machine, process, zone, result, last_seen FROM (',
    `  SELECT ${ident('plant')} AS plant,`,
    `         ${ident('machine')} AS machine,`,
    `         ${ident('process')} AS process,`,
    `         ${ident('zone')} AS zone,`,
    `         ${ident('Result')} AS result,`,
    `         ${ident('time')} AS last_seen,`,
    `         ROW_NUMBER() OVER (PARTITION BY ${ident('plant')}, ${ident('machine')}`,
    `                            ORDER BY ${ident('time')} DESC) AS rn`,
    '  FROM production_machine_status',
    `  WHERE ${ident('time')} > now() - INTERVAL '${windowHours} hours'`,
    // No `process` predicate here on purpose - the column travels on the row and
    // each request narrows it (config/policy.ts). One poll, every scope.
    //
    // The status predicate makes the ROW_NUMBER pick the latest SUBSTANTIVE row
    // rather than the latest row - see SUBSTANTIVE_STATUSES above.
    `    AND ${ident('Result')} IN (${SUBSTANTIVE_STATUSES.map(literal).join(', ')})`,
    ') t WHERE rn = 1',
  ].join('\n');
}

/**
 * Q-03's window for %OA.
 *
 * Longer than the status window on purpose: %OA is an aggregate over a PO's
 * run, and a 2 h window would clip every order that started before it and
 * report a partial figure as if it were the whole. 24 h reproduces the
 * production board's per-machine numbers exactly (see machineOaSql).
 *
 * Note this is NOT a shift-relative window (D-26). Every order live at the
 * time of the reconciliation had started inside the current day shift, so 24 h,
 * "today" and "current shift" all gave the same answer and the data could not
 * tell them apart. 24 h is the choice that matches the window the old
 * dashboard's own output figures agree with; revisit when an order that spans
 * two shifts is available to test against.
 */
export const OA_WINDOW_HOURS = 24;

/**
 * One row per (plant, machine, PO slots) inside the window. Everything the
 * %OA roll-up needs is here, so no second query and no join.
 *
 * The four `ProductionOrder` slots are returned RAW rather than concatenated
 * server-side, because the count of non-empty slots is itself a load-bearing
 * fact: a machine running more than one order in the same physical shot makes
 * the %OA formula inflate by the slot count (see domain/oa.ts). Concatenating
 * in SQL would throw that count away, and splitting the string back apart in
 * JS would break the moment an order number contains an underscore.
 *
 * `last_row` is what identifies the order a machine is running NOW: the newest
 * row belongs to exactly one slot combination, so the group holding MAX(time)
 * is the current one. That is the rule the production board's cards follow -
 * they show the loaded order, not everything the machine ran today - and
 * reproducing it is what makes our average agree with theirs.
 */
export interface MachineOaRow {
  plant: string | null;
  machine: string | null;
  /** Narrowed per request, exactly like the census - see LatestMachineStatusRow. */
  process: string | null;
  po0: string | null;
  po1: string | null;
  po2: string | null;
  po3: string | null;
  /** Numerator's standard time. `MIN`, per DESIGN.md §9.1 - see §9.1 note 4. */
  min_std_time: number | null;
  sum_qty: number | null;
  /**
   * Q-04's TotalPlan inputs, one per slot: the order's lot size.
   *
   * `MAX`, never `SUM`. `plan_qty` is an attribute of the ORDER repeated on
   * every shot row, not a per-shot increment - verified against the live
   * instance on 2026-08-25: every `(plant, machine, PO slots)` group in a 24 h
   * window at every plant had `COUNT(DISTINCT plan_qty0) = 1`, no exceptions.
   * Summing it would have reported machine I5's plan of 400 as 400 x 295 rows
   * = 118,000 and the achievement card as 0.25%.
   */
  plan0: number | null;
  plan1: number | null;
  plan2: number | null;
  plan3: number | null;
  /** DESIGN.md §8.5: shots are `COUNT(cavity)`, pieces are `SUM(qty)`. */
  shot_count: number | null;
  /** The clamped denominator - long cycles counted as standard (D-19). */
  weighted_time: number | null;
  last_row: string | null;
  /**
   * When each active order was created - the input to the Order-End shift check
   * (`domain/orderShift.ts`), which is layer 2 of DESIGN.md §8.4.
   *
   * `MAX` is safe and not a choice between values: measured over the live
   * instance, `vCreateDateTxtN` is constant within a `(plant, machine, PO
   * slots)` group, exactly like `plan_qtyN` - both are attributes of the order
   * repeated onto every shot row.
   *
   * All four slots are read because the old panel's JavaScript reads all four
   * and treats the order as current if ANY of them lands in the current shift.
   * BACKEND-HANDOVER §4.5(c) recorded that "nothing states which one the
   * original JavaScript read"; the panel source now in
   * docs/grafana/MACHINE-STATUS-V2.md §4.2 states it.
   */
  cd0: string | null;
  cd1: string | null;
  cd2: string | null;
  cd3: string | null;
}

/**
 * Q-03 and Q-04: %OA and achievement inputs per (Group_PO x machine),
 * DESIGN.md §9.1 and §9.2. One query, because both ratios are read off the same
 * order group and asking twice would let the plan and the output it is divided
 * by come from two different moments.
 *
 * Verified against the production `Machine Status V2.0` board on 2026-08-25:
 * machine I5 on plant 6332, order 110000962985, came back `min_std_time` 31 /
 * `sum_qty` 295 / `weighted_time` 19236.09, which is the 47.5% and the 295
 * pieces the board showed for that card at that moment.
 *
 * The `std_time + 100` threshold is deliberate and NOT the `+ 20` used by the
 * old `SumCycle` column (D-22, still open): a cycle longer than standard + 100 s
 * is counted as if it had taken standard, so a long stop does not register as
 * lost efficiency. That is why `Kpi.downtime_sec` has to exist separately.
 */
export function machineOaSql(windowHours: number = OA_WINDOW_HOURS): string {
  assertWindow(windowHours);
  const slots = ['ProductionOrder0', 'ProductionOrder1', 'ProductionOrder2', 'ProductionOrder3'];
  const plans = ['plan_qty0', 'plan_qty1', 'plan_qty2', 'plan_qty3'];
  const created = ['vCreateDateTxt0', 'vCreateDateTxt1', 'vCreateDateTxt2', 'vCreateDateTxt3'];
  return [
    `SELECT ${ident('plant')} AS plant,`,
    `       ${ident('machine')} AS machine,`,
    `       ${ident('process')} AS process,`,
    ...slots.map((c, i) => `       ${ident(c)} AS po${i},`),
    // MAX, not SUM - the plan is a property of the order, not of the shot.
    ...plans.map((c, i) => `       MAX(${ident(c)}) AS plan${i},`),
    // Same reasoning as the plans: constant within the group, so MAX picks the
    // one value there is rather than choosing between several.
    ...created.map((c, i) => `       MAX(${ident(c)}) AS cd${i},`),
    `       MIN(${ident('std_time')}) AS min_std_time,`,
    `       SUM(${ident('qty')}) AS sum_qty,`,
    `       COUNT(${ident('cavity')}) AS shot_count,`,
    `       SUM(CASE WHEN ${ident('cycle_time')} > ${ident('std_time')} + 100`,
    `                THEN ${ident('std_time')} * ${ident('qty')}`,
    `                ELSE ${ident('cycle_time')} * ${ident('qty')} END) AS weighted_time,`,
    `       MAX(${ident('time')}) AS last_row`,
    '  FROM production_machine_io',
    `  WHERE ${ident('time')} > now() - INTERVAL '${windowHours} hours'`,
    `  GROUP BY ${ident('plant')}, ${ident('machine')}, ${ident('process')}, ${slots.map(ident).join(', ')}`,
  ].join('\n');
}

/**
 * Q-05's chart width: 24 hourly points, the newest being the hour in progress.
 *
 * Matches what the frontend has always drawn against the mock (24 points,
 * oldest first) so the axis, the tick spacing and the "-24h / now" end labels
 * need no change to take real data.
 */
export const TREND_POINTS = 24;

/**
 * One row per (hour x plant x machine x PO slots). Same shape as `MachineOaRow`
 * minus the plan and shot columns, which the trend does not use - the chart
 * plots a ratio, and Q-04's plan belongs to the KPI strip.
 */
export interface MachineHourOaRow {
  /** `date_bin` output: the hour's start, UTC, with no zone marker. */
  bucket: string | null;
  plant: string | null;
  machine: string | null;
  po0: string | null;
  po1: string | null;
  po2: string | null;
  po3: string | null;
  min_std_time: number | null;
  sum_qty: number | null;
  weighted_time: number | null;
}

/**
 * Q-05 - the hourly %OA trend, DESIGN.md §10's `date_bin(INTERVAL '1 hour', time)`.
 *
 * Deliberately NOT the same query as `machineOaSql` even though the columns
 * overlap and every one of them re-aggregates exactly (MIN of MINs, SUM of
 * SUMs). Two reasons, both about failure rather than arithmetic: the KPI strip's
 * number is reconciled against the production board and under test, and
 * rebuilding it out of hourly buckets would put that at risk to save one query;
 * and separate queries mean a failing trend costs the board its chart, not its
 * KPI strip (see the `Promise.allSettled` in services/liveSnapshot.ts).
 *
 * The two therefore answer deliberately different questions and will not print
 * the same number: the strip is the CURRENT order over a rolling 24 h, this is
 * every order worked in each clock hour. Measured 2026-08-26 08:41: the strip
 * read 81.8% over 17 machines while the 08:00 bucket read 81.0% over 13.
 *
 * Buckets are clock hours in UTC, not shift-relative (D-26, still open) -
 * that is what Q-05 literally specifies, and it is also the only definition
 * that survives a chart mixing THS/ASI (2 shifts) with STJ (3 shifts, B ending
 * 22:15). The frontend already draws the axis in one named reference zone (D-04).
 *
 * The window is bounded by `date_bin` on the DATABASE's clock, so the bucket
 * edges the query bins to and the edge it cuts at can never disagree. The
 * server reconciles those buckets against its own clock when it builds the
 * points, and says so on the envelope if they differ (domain/trend.ts).
 */
export function machineHourOaSql(points: number = TREND_POINTS): string {
  if (!Number.isInteger(points) || points < 2 || points > MAX_WINDOW_HOURS) {
    throw new Error(
      `points must be an integer in 2..${MAX_WINDOW_HOURS} (got ${points}). ` +
        'Wider windows return HTTP 500 with an empty body - see BACKEND-HANDOVER §4.2.',
    );
  }
  const slots = ['ProductionOrder0', 'ProductionOrder1', 'ProductionOrder2', 'ProductionOrder3'];
  const bin = `date_bin(INTERVAL '1 hour', ${ident('time')})`;
  return [
    `SELECT ${bin} AS bucket,`,
    `       ${ident('plant')} AS plant,`,
    `       ${ident('machine')} AS machine,`,
    ...slots.map((c, i) => `       ${ident(c)} AS po${i},`),
    `       MIN(${ident('std_time')}) AS min_std_time,`,
    `       SUM(${ident('qty')}) AS sum_qty,`,
    `       SUM(CASE WHEN ${ident('cycle_time')} > ${ident('std_time')} + 100`,
    `                THEN ${ident('std_time')} * ${ident('qty')}`,
    `                ELSE ${ident('cycle_time')} * ${ident('qty')} END) AS weighted_time`,
    '  FROM production_machine_io',
    // `points - 1`, not `points`: the newest bucket is the hour in progress, so
    // asking for a full `points` hours back would return one extra partial
    // bucket at the far end that the chart has no slot for.
    ` WHERE ${ident('time')} >= date_bin(INTERVAL '1 hour', now()) - INTERVAL '${points - 1} hours'`,
    // Unfiltered by `process`, like the KPI strip above it: a chart measuring a
    // different set of machines than the cards is worse than no chart.
    ` GROUP BY bucket, ${ident('plant')}, ${ident('machine')}, ${slots.map(ident).join(', ')}`,
  ].join('\n');
}
