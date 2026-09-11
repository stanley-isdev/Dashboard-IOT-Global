import { ident, literal } from './client.ts';

/**
 * The widest window ONE query may scan.
 *
 * BACKEND-HANDOVER §4.2 recorded this as "queries spanning more than 3 days
 * fail" with an **empty-bodied HTTP 500** and the cause unknown - possibly
 * retention expiry, possibly a schema conflict in older parquet files, and
 * only diagnosable by someone with InfluxDB host log access.
 *
 * **Re-measured 2026-09-03, and the instance now names it:**
 *
 * ```
 *   24h / 36h / 48h / 60h / 71h   OK   (5,405 -> 11,633 rows)
 *   96h                           HTTP 500: External error: Query would scan
 *                                 432 Parquet files, exceeding the file limit
 * ```
 *
 * So it is a **file-scan cap, not retention and not width**, and that
 * distinction is what makes the absolute time picker possible: the cap counts
 * files per query, so a wider window can be served as SEVERAL bounded queries
 * that each stay under it. See `chunkWindow` below. Bounded windows well into
 * the past answer fine - a 48 h window ending 24 h ago returned 6,305 rows in
 * 200 ms, and single-day windows answer back to the retention edge.
 *
 * 71 keeps a margin under the 72 h boundary that still worked.
 *
 * **Re-measured 2026-09-08, and 71 is not a safe width - only a usually-safe
 * one.** The cap counts FILES, and the file count for a given width is not
 * constant: Core never compacts, so the newest days are held in many small
 * files and the same 71 h that answers over mid-August is rejected over the
 * start of September. Walking 11 Aug - 8 Sep as ten 71 h chunks:
 *
 * ```
 *   chunk 0..6, 8, 9                        OK   (36 -> 73 rows each)
 *   chunk 7   31 Aug 20:00 .. 3 Sep 19:00   HTTP 500: would scan 432 Parquet
 *                                           files, exceeding the file limit
 * ```
 *
 * One rejected chunk used to cost the whole board (`fetchWindow` threw, the
 * route emptied the census), so every window reaching over that stretch - any
 * pick wider than ~4 days - came back as zeros behind the amber banner. So 71
 * is now the width of the FIRST attempt only, and a rejected chunk is retried
 * at `NARROW_WINDOW_HOURS` rather than losing the window. See `fetchWindow`.
 */
export const MAX_WINDOW_HOURS = 71;

/**
 * The width a rejected chunk is retried at.
 *
 * 24 h, because that is the widest re-attempt measured to hold over the whole
 * retention depth: on 2026-09-08 all 28 single-day chunks of 11 Aug - 8 Sep
 * answered (0 rejections, slowest 1,058 ms), where the same window in 71 h
 * chunks lost one and in 12 h chunks cost 56 queries for no further gain.
 *
 * Retrying narrow rather than chunking narrow in the first place is what keeps
 * the common windows fast: a 3-day pick still costs one query per family, and
 * only the stretch that is actually too dense pays for the split. Measured
 * end-to-end over the full 28 days - the worst case there is - 71 h chunks with
 * narrow retries took ~10 s and 39 queries against ~19 s and 84 for chunking
 * everything at 24 h.
 */
export const NARROW_WINDOW_HOURS = 24;

/**
 * How far back the instance still holds data, in days - the calendar's `min`.
 *
 * Measured 2026-09-03 by walking single-day windows backwards: 28 days ago
 * returned 1,127 rows, 29 days ago returned none. This is the default the
 * poller starts from and re-probes; it is published on `/meta` rather than
 * compiled into the bundle because retention moves and a stale `min` lets a
 * reader pick a fortnight the instance threw away last night.
 */
export const RETENTION_DAYS = 28;

/**
 * The widest window the server will assemble out of chunks.
 *
 * A ceiling on the chunk count, not a statement about the data: without it a
 * hand-written `?from=2020-01-01` would ask this instance for four hundred
 * sequential queries. Set to the retention depth, because nothing beyond it
 * can return a row anyway.
 */
export const MAX_ASSEMBLED_HOURS = RETENTION_DAYS * 24;

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
  /**
   * Epoch milliseconds, UTC, marking when the current `Result` began - Q-06's
   * input (DESIGN.md §10, "top-10 longest active stop ... from `StatusStartTime`
   * of `Result='Stop'`").
   *
   * BACKEND-HANDOVER §4.6 had flagged this as "a Float64 of unknown epoch".
   * Resolved against the live instance on 2026-09-02: a `Stop` row's own
   * `StatusStartTime` matched its `time` column to the millisecond on the poll
   * that first observed the stop (e.g. `1788316143298` -> `2026-09-02T02:29:
   * 03.298Z`, equal to that row's `time`), and an older, still-active stop's
   * `StatusStartTime` decoded to a plausible earlier UTC instant. Millisecond
   * Unix epoch, UTC - see domain/alerts.ts for the duration math.
   */
  status_start_time: number | null;
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
 * `Warning` and `Alarm` are the ones left out - flags that flap on and off a
 * machine that never stopped producing. Measured on 2026-08-27, THS 6332
 * machine `HC2` over 71 h: `Warning` 78 rows, `Mass Pro` 63, `Alarm` 14,
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
 *
 * **`Pending` moved from the flapping group to here, 2026-09-10.** It used to
 * be measured alongside `Warning`/`Alarm` (2026-08-27, before it meant
 * anything held): the same 71 h THS survey read `Pending` 62 rows against the
 * same machine, which looked like the same kind of flicker. It is not. The
 * panel's v4 added a widget button that writes `Result='Pending'` to
 * deliberately park a job (`docs/grafana/MACHINE-STATUS-V2.md` §0) - a state
 * an operator holds on purpose, for as long as the job stays parked, not one
 * that flickers under it. Filtering it out here used to mean a parked machine
 * silently read whatever it was doing before, while the production board's own
 * `EXCLUDE_FROM_TOTAL`/`EXCLUDE_FROM_OA` (`MACHINE-STATUS-V2.md` §0) both drop
 * it on purpose - a real, un-reconciled divergence for plant 6051's %OA,
 * confirmed against IOT 2026-09-10: a `Pending` machine's %OA should not be
 * counted. Reading `Pending` here is step one of matching that - see
 * `domain/oa.ts`'s `oaExcludedMachines` for step two, where it is actually
 * dropped from the average.
 */
const SUBSTANTIVE_STATUSES = [
  'Mass Pro',
  'Dandori',
  'Stop',
  'No Plan',
  'Order End',
  '4M Change',
  'Offline',
  'Pending',
];

/* ------------------------------------------------------------ windows */

/**
 * A half-open instant window, `[from, to)`, both ISO-8601 UTC.
 *
 * Half-open rather than closed so adjacent chunks tile the window exactly once:
 * a closed pair would count every boundary row twice, which for the %OA sums
 * below is not a rounding error but a doubled numerator.
 */
export interface Window {
  from: string;
  to: string;
}

const HOUR_MS = 3_600_000;

/** `timestamp '...'` - the literal form the v3 SQL endpoint accepts for a time bound. */
function instant(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`not an ISO instant: ${iso}`);
  return `timestamp ${literal(new Date(ms).toISOString())}`;
}

/**
 * Splits a window into pieces no wider than `maxHours`, oldest first.
 *
 * **Aligned to whole hours from the far end, not from the near one.** The
 * hourly trend bins with `date_bin(INTERVAL '1 hour', time)`, whose buckets sit
 * on absolute clock hours; a chunk boundary in the middle of one would split
 * that bucket across two queries and the merge would emit the same hour twice,
 * each holding half its rows. Cutting only on hour edges means every bucket
 * lands wholly inside exactly one chunk, so merging chunks is concatenation
 * rather than re-aggregation.
 *
 * Returns at least one chunk, so a caller never has to special-case an empty
 * plan for a zero-width window.
 */
export function chunkWindow(w: Window, maxHours: number = MAX_WINDOW_HOURS): Window[] {
  const from = Date.parse(w.from);
  const to = Date.parse(w.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(`chunkWindow needs two ISO instants (got ${w.from} .. ${w.to})`);
  }
  if (to <= from) return [{ from: new Date(from).toISOString(), to: new Date(to).toISOString() }];

  const span = maxHours * HOUR_MS;
  const out: Window[] = [];
  let cursor = from;
  while (cursor < to) {
    /* Land the cut on the hour boundary at or below the naive end, so the trend
       buckets stay whole. Never below `cursor` - a sub-hour remainder would
       otherwise produce a zero-width chunk and loop forever. */
    const naive = Math.min(cursor + span, to);
    const aligned = naive === to ? to : Math.max(cursor + HOUR_MS, Math.floor(naive / HOUR_MS) * HOUR_MS);
    const end = Math.min(aligned, to);
    out.push({ from: new Date(cursor).toISOString(), to: new Date(end).toISOString() });
    cursor = end;
  }
  return out;
}

/**
 * The `WHERE` fragment for a bounded window.
 *
 * The relative builders below keep their `now() - INTERVAL` form rather than
 * being rewritten in terms of this: that form is what the production board's
 * own SQL says, it is what every measurement in this file was taken against,
 * and it bounds on the DATABASE's clock. A server whose clock has drifted
 * still asks for "the last 24 hours" and not for a window the instance
 * considers partly in the future.
 */
function betweenClause(w: Window): string {
  return `${ident('time')} >= ${instant(w.from)} AND ${ident('time')} < ${instant(w.to)}`;
}

/**
 * Q-01: one row per machine, carrying its most recent status inside the window.
 *
 * The window is the SITE's, like %OA's above it. ASI's board reads its status
 * table over `3 days` where THS's reads `1 days` (`panel-v4-asi.sql`), and a
 * machine silent for longer than the window simply is not on the board - it has
 * no card, so it is in no count. Ours behaved the same way with one number for
 * everybody, which made ASI's census narrower than ASI's board: measured
 * 2026-09-11, `M-IS-38` last reported `Dandori` two days earlier, so the board
 * carried 43 machines and we carried 42.
 *
 * A stale status stays on screen rather than becoming `Offline` - that is T-11,
 * accepted on 2026-08-27 for the same reason as here: the board does it, and
 * our own freshness label travels beside the figure to say the site is quiet.
 */
export function latestMachineStatusSql(
  window: number | SiteWindowPlan = HOT_WINDOW_HOURS,
): string {
  return perSiteWindowSql(latestMachineStatusWhere, window);
}

/**
 * Q-01 over an explicit window - one chunk of an absolute or multi-day pick.
 *
 * Each chunk returns the latest substantive row per machine *within that
 * chunk*, so the chunks must be merged by taking the newest per machine rather
 * than concatenated (`mergeLatestStatus` in services/windowedSnapshot.ts). That
 * merge is exact: the newest row of the newest chunk holding one is the newest
 * row of the whole window, because the chunks tile it without overlap.
 */
export function latestMachineStatusInSql(w: Window): string {
  return latestMachineStatusWhere(betweenClause(w));
}

function latestMachineStatusWhere(whereTime: string): string {
  return [
    'SELECT plant, machine, process, zone, result, last_seen, status_start_time FROM (',
    `  SELECT ${ident('plant')} AS plant,`,
    `         ${ident('machine')} AS machine,`,
    `         ${ident('process')} AS process,`,
    `         ${ident('zone')} AS zone,`,
    `         ${ident('Result')} AS result,`,
    `         ${ident('time')} AS last_seen,`,
    `         ${ident('StatusStartTime')} AS status_start_time,`,
    `         ROW_NUMBER() OVER (PARTITION BY ${ident('plant')}, ${ident('machine')}`,
    `                            ORDER BY ${ident('time')} DESC) AS rn`,
    '  FROM production_machine_status',
    `  WHERE ${whereTime}`,
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
 * Q-09: has this plant EVER reached us - an existence probe, not an aggregate,
 * over ONE slice of the horizon.
 *
 * The question `latestMachineStatusSql` cannot answer. Its window is
 * `HOT_WINDOW_HOURS` wide, so a plant missing from it is `lastSeen: null`
 * whether it is on a shutdown week or has never sent a row (config/policy.ts's
 * EVER_SEEN carries why that distinction is worth a query).
 *
 * **`ORDER BY time DESC LIMIT 1`, deliberately not `MAX(time)` or `COUNT(*)`.**
 * All three answer the question, but the aggregates have to read every row in
 * the slice before returning anything, while this one stops at the first row it
 * finds. Combined with `everSeenWindows` handing slices out newest-first, that
 * asymmetry is what makes a reporting plant nearly free: it hits on the first
 * slice and the walk ends there.
 *
 * **One slice per call, not one horizon per call** - see `everSeenWindows`.
 *
 * No `Result` predicate, unlike Q-01. Q-01 filters to SUBSTANTIVE_STATUSES
 * because it has to pick a row that means something to show on a tile; here any
 * row at all is the answer, and narrowing could only turn "we heard from this
 * plant" into a false "never" for a site whose whole history is statuses we do
 * not model.
 *
 * One plant per call rather than `GROUP BY plant`: the caller only ever asks
 * about plants it has not already seen (a set that shrinks to nothing as sites
 * come online), and a grouped query would pay for the whole estate to re-answer
 * a question already settled for most of it.
 */
export function plantEverSeenInSql(plant: string, w: Window): string {
  return [
    `SELECT ${ident('time')} AS last_seen`,
    '  FROM production_machine_status',
    ` WHERE ${ident('plant')} = ${literal(plant)}`,
    `   AND ${betweenClause(w)}`,
    ` ORDER BY ${ident('time')} DESC`,
    ' LIMIT 1',
  ].join('\n');
}

/**
 * The slices Q-09 walks, **newest first**, covering `horizonDays` back from now.
 *
 * Newest-first is not cosmetic: the probe short-circuits on its first hit, so
 * this ordering is what turns a live plant's answer into a single 74 ms query
 * instead of a 30-slice crawl.
 *
 * Slicing at all is forced by the instance. InfluxDB 3 Core caps the Parquet
 * files one query may scan, and measured on 2026-09-08 the boundary for a
 * now-anchored single-plant probe sits between 72 and 84 hours: 72 h answers in
 * 76 ms, 84 h is refused with `HTTP 500 ... would scan 432 Parquet files`. Row
 * age is not what costs - a one-day window 30 days back answers in 305 ms - so
 * the horizon is unreachable as one read and routine as thirty narrow ones.
 *
 * `sliceHours` is a margin, not a proven-safe width. The cap counts files, and
 * BACKEND-HANDOVER §4.2's re-measurement on the same day found a 71 h chunk
 * refused while its nine neighbours answered, because Core never compacts and
 * the file count for a fixed width grows as the window nears now. Callers must
 * therefore treat any slice as refusable; `probeEverSeen` aborts a whole walk
 * rather than read a partial one as a negative.
 *
 * `chunkWindow` already encodes the same constraint for windowed fetches; this
 * reuses it rather than inventing a second chunker with the same reason behind
 * it.
 */
export function everSeenWindows(nowMs: number, horizonDays: number, sliceHours: number): Window[] {
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) {
    throw new Error(`horizonDays must be a positive integer, got ${horizonDays}`);
  }
  if (!Number.isInteger(sliceHours) || sliceHours <= 0) {
    throw new Error(`sliceHours must be a positive integer, got ${sliceHours}`);
  }
  const to = new Date(nowMs).toISOString();
  const from = new Date(nowMs - horizonDays * 24 * HOUR_MS).toISOString();
  return chunkWindow({ from, to }, sliceHours).reverse();
}

/** One row of Q-09 - present means the plant reported inside that slice. */
export interface PlantEverSeenRow {
  last_seen: string | number | null;
}

/**
 * Q-03's DEFAULT window for %OA - what a site reads over unless its own master
 * data names a different one (`oaWindowHours` in `config/masterData.ts`).
 *
 * **24 h, and this is the THS number, not a universal one.** It reproduces the
 * production board's per-machine figures at THS exactly, because that panel's
 * `TotalOutput_Per_PO` CTE reads `now() - INTERVAL '1 days'`
 * (docs/grafana/MACHINE-STATUS-V2.md, captured 2026-08-27).
 *
 * ASI's panel does NOT: its CTE reads `INTERVAL '3 days'`, and IOT confirmed
 * on 2026-09-10 that this is the rule there - a machine whose current order
 * has run past 24 h has its %OA figured over 3 days rather than clipped to
 * the last day. **That rule is ASI's alone**, so it lives on ASI's company
 * record rather than here; briefly, on 2026-09-10, this constant was changed
 * to 71 for everyone, which silently moved every THS figure away from THS's
 * own board (THS 6332 machine `P1I8` read 294 pieces here against the board's
 * 43 - the wider window sweeping in nearly three days of shots the board
 * never counted).
 *
 * Longer than the status window whatever the site: %OA is an aggregate over a
 * PO's run, and a narrower window clips every order that started before it
 * and reports a partial figure as if it were the whole.
 *
 * Note this is NOT a shift-relative window (D-26).
 */
export const OA_WINDOW_HOURS = 24;

/**
 * One site group's own %OA window, for a plan that mixes several.
 *
 * `plants` are plant CODES, because that is what the rows carry - a company
 * has no column of its own on `production_machine_io` (its `codeCompany` is
 * NULL on almost every row, BACKEND-HANDOVER §4.3a), so a per-company rule
 * has to travel as the list of that company's plants.
 */
export interface SiteWindowOverride {
  readonly plants: readonly string[];
  readonly hours: number;
}

/**
 * Which window each site's %OA is read over, in one object.
 *
 * Exists because the window is a property of the SITE and the poll is a single
 * query for every site at once (see `machineOaSql`). Without this the choice
 * was one window for everybody, and every value of it is wrong for somebody:
 * 24 h is THS's board and ASI's is 3 days.
 */
export interface SiteWindowPlan {
  /** For any plant not named in `overrides`. */
  readonly defaultHours: number;
  readonly overrides: readonly SiteWindowOverride[];
}

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
export function machineOaSql(
  /**
   * A plain number is one window for every site. A `SiteWindowPlan` gives the
   * sites that read %OA over their own window (ASI's 3 days) that window and
   * everyone else the default, in ONE statement: a `UNION ALL` of one grouped
   * SELECT per window, each restricted to the plants it applies to.
   *
   * One statement rather than one query per window because this runs on the
   * poller's hot path every `oaIntervalMs`, and because the branches are
   * disjoint by plant - no row can be counted twice, so the union is exactly
   * the set of groups a per-site query would have returned.
   */
  window: number | SiteWindowPlan = OA_WINDOW_HOURS,
): string {
  return perSiteWindowSql(machineOaWhere, window);
}

/**
 * A plan turned into one statement, for any query that reads a time window.
 *
 * Shared by the %OA roll-up and the census because both meet the same fact: the
 * window is a property of the SITE, and each is a single poll for every site at
 * once. The branches are disjoint by plant - a row matches exactly one of them
 * - so the union is precisely the set of rows a per-site query would have
 * returned, and a per-machine `ROW_NUMBER` inside `where` still ranks within
 * one site's own branch.
 */
function perSiteWindowSql(
  where: (whereTime: string) => string,
  window: number | SiteWindowPlan,
): string {
  if (typeof window === 'number') {
    assertWindow(window);
    return where(sinceHours(window));
  }

  const overrides = window.overrides.filter((o) => o.plants.length > 0);
  assertWindow(window.defaultHours);
  if (overrides.length === 0) return where(sinceHours(window.defaultHours));

  const parts = overrides.map((o) => {
    assertWindow(o.hours);
    return where(`${ident('plant')} IN (${o.plants.map(literal).join(', ')}) AND ${sinceHours(o.hours)}`);
  });

  /* `IS NULL` explicitly, because `plant NOT IN (...)` is NULL for a row with
     no plant and would drop it. Such a row cannot be attributed to a site and
     the folds downstream discard it anyway, but it should be discarded THERE,
     by the rule that says so, and not silently by three-valued logic here. */
  const named = overrides.flatMap((o) => o.plants).map(literal).join(', ');
  parts.push(
    where(
      `(${ident('plant')} NOT IN (${named}) OR ${ident('plant')} IS NULL) AND ${sinceHours(window.defaultHours)}`,
    ),
  );

  return parts.join('\nUNION ALL\n');
}

const sinceHours = (hours: number) => `${ident('time')} > now() - INTERVAL '${hours} hours'`;

/**
 * Q-03/Q-04 over an explicit window - one chunk of an absolute or multi-day pick.
 *
 * Merging chunks is exact arithmetic and not an approximation: every column
 * here re-aggregates (MIN of MINs, SUM of SUMs, COUNT of COUNTs, MAX of MAXs),
 * so the per-order group assembled from three chunks equals the one a single
 * query would have returned - which is the property that makes chunking a
 * legitimate answer to the file-scan cap rather than a way to blur it.
 *
 * The one column that is NOT a sum is `last_row`, and MAX is what it needs:
 * the whole window's newest row for that group is the newest of the chunks'
 * newest, and `last_row` is what identifies the order a machine is running now.
 */
export function machineOaInSql(w: Window): string {
  return machineOaWhere(betweenClause(w));
}

function machineOaWhere(whereTime: string): string {
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
    `  WHERE ${whereTime}`,
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
 * One row per (hour x plant x machine x PO slots).
 *
 * The same shape as `MachineOaRow` minus `process` and `last_row`, which
 * nothing hourly reads. It used to be minus the plan and shot columns too, on
 * the grounds that "the chart plots a ratio, and Q-04's plan belongs to the KPI
 * strip" - true of the chart, and wrong the moment anything else needed an
 * hour's output. The shift breakdown and the hourly output table both do, and
 * both reported every quantity as unknown until these arrived.
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
  /** Q-04's TotalPlan inputs for the hour, one per slot. `MAX`, never `SUM`. */
  plan0: number | null;
  plan1: number | null;
  plan2: number | null;
  plan3: number | null;
  min_std_time: number | null;
  sum_qty: number | null;
  /** §8.5: shots are `COUNT(cavity)`, pieces are `SUM(qty)`. */
  shot_count: number | null;
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
  return machineHourOaWhere(
    // `points - 1`, not `points`: the newest bucket is the hour in progress, so
    // asking for a full `points` hours back would return one extra partial
    // bucket at the far end that the chart has no slot for.
    ` ${ident('time')} >= date_bin(INTERVAL '1 hour', now()) - INTERVAL '${points - 1} hours'`,
  );
}

/**
 * Q-05 over an explicit window - one chunk of an absolute or multi-day pick.
 *
 * Safe to concatenate rather than re-aggregate, unlike the %OA chunks above,
 * because `chunkWindow` cuts only on whole-hour boundaries and `date_bin` bins
 * to those same absolute hours: no bucket can straddle two chunks, so no hour
 * is ever emitted twice holding half its rows.
 */
export function machineHourOaInSql(w: Window): string {
  return machineHourOaWhere(betweenClause(w));
}

function machineHourOaWhere(whereTime: string): string {
  const slots = ['ProductionOrder0', 'ProductionOrder1', 'ProductionOrder2', 'ProductionOrder3'];
  const plans = ['plan_qty0', 'plan_qty1', 'plan_qty2', 'plan_qty3'];
  const bin = `date_bin(INTERVAL '1 hour', ${ident('time')})`;
  return [
    `SELECT ${bin} AS bucket,`,
    `       ${ident('plant')} AS plant,`,
    `       ${ident('machine')} AS machine,`,
    ...slots.map((c, i) => `       ${ident(c)} AS po${i},`),
    /*
     * The three quantity columns, added 2026-09-07 for the shift breakdown and
     * the hourly output table - see services/scopeService.ts, which had to
     * report every one of those figures as `null` without them.
     *
     * Additive and provably so: the GROUP BY below is untouched, and no
     * existing column's expression changed, so `min_std_time`, `sum_qty` and
     * `weighted_time` - the three the %OA the chart plots is computed from -
     * cannot move. Verified against the live instance the same day by
     * capturing `/global-overview`'s 24 trend points either side of this
     * change: identical, point for point.
     *
     * `MAX` on the plans and not `SUM`, for the reason `MachineOaRow` records
     * at length: `plan_qty` is an attribute of the ORDER repeated on every shot
     * row, and summing it reported a plan of 400 as 118,000.
     */
    ...plans.map((c, i) => `       MAX(${ident(c)}) AS plan${i},`),
    `       MIN(${ident('std_time')}) AS min_std_time,`,
    `       SUM(${ident('qty')}) AS sum_qty,`,
    /* Shots are `COUNT(cavity)`, pieces are `SUM(qty)` - DESIGN.md §8.5. The
       two get separate columns here for the same reason they get separate rows
       in the table: they are different facts and they get swapped. */
    `       COUNT(${ident('cavity')}) AS shot_count,`,
    `       SUM(CASE WHEN ${ident('cycle_time')} > ${ident('std_time')} + 100`,
    `                THEN ${ident('std_time')} * ${ident('qty')}`,
    `                ELSE ${ident('cycle_time')} * ${ident('qty')} END) AS weighted_time`,
    '  FROM production_machine_io',
    ` WHERE ${whereTime}`,
    // Unfiltered by `process`, like the KPI strip above it: a chart measuring a
    // different set of machines than the cards is worse than no chart.
    ` GROUP BY bucket, ${ident('plant')}, ${ident('machine')}, ${slots.map(ident).join(', ')}`,
  ].join('\n');
}
