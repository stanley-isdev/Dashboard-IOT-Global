import type { MachineStatus } from '@dashboard/contract';
import { zMachineStatus } from '@dashboard/contract';
import {
  EVER_SEEN,
  EVER_SEEN_PROBE_INTERVAL_MS,
  EVER_SEEN_RECHECK_INTERVAL_MS,
} from '../config/policy.ts';
import { foldMachineOa, type MachineOa } from '../domain/oa.ts';
import type { EverSeen } from '../domain/siteStatus.ts';
import { foldMachineHours, type MachineHourOa } from '../domain/trend.ts';
import type { InfluxClient } from '../influx/client.ts';
import {
  everSeenWindows,
  latestMachineStatusSql,
  machineHourOaSql,
  machineOaSql,
  plantEverSeenInSql,
  type LatestMachineStatusRow,
  type MachineHourOaRow,
  type MachineOaRow,
  type PlantEverSeenRow,
} from '../influx/queries.ts';
import { influxTimeToIsoUtc } from '../influx/time.ts';

/**
 * The backend polls InfluxDB on its own clock and every request reads the
 * result. This is not a performance nicety - it is what makes a fast refresh
 * safe. With N wall-mounted screens polling the API directly at Influx, load
 * scales with the number of viewers; here it does not scale at all.
 *
 * The interval MUST stay shorter than the frontend's `refreshMs`. The UI's
 * freeze detector (src/domain/connectionState.ts, `FREEZE_THRESHOLD = 3`)
 * flags the connection as frozen after three consecutive polls, so a poller
 * slower than the client would light up a "data is frozen" banner on a
 * perfectly healthy system. 3 s poll / 5 s refresh holds that margin.
 *
 * On a failed poll the previous data is kept, not cleared. The last numbers
 * that were true stay on screen with the source marked degraded - blanking
 * them is the "shows 0" bug the whole contract is written against.
 */

/** One machine's most recent known status inside the query window. */
export interface MachineObservation {
  plant: string;
  machine: string;
  /**
   * The `process` tag, `null` when the row carries none.
   *
   * Here so a request can narrow to one process the way the plant board does.
   * Measured 2026-08-27: THS 6332 has 26 `Injection` machines and 3 `Surface`
   * (`AF2`, `BP6`, `HC2`), and the Lamp 2 board - which is `Injection`-scoped -
   * shows none of the three. Without this the two screens count different
   * machines and no amount of status logic makes them agree.
   */
  process: string | null;
  /**
   * The `zone` tag, `null` when the row carries none.
   *
   * Nothing on this board counts, groups or filters by zone. It is here so the
   * Grafana drill-down can be built for the zones a plant actually reports -
   * see @dashboard/domain-shared's grafana.ts for why a link without them opens an empty board.
   */
  zone: string | null;
  status: MachineStatus;
  lastSeen: string | null;
  /**
   * Epoch milliseconds UTC when `status` began - Q-06's input, carried
   * straight off `LatestMachineStatusRow.status_start_time`. `null` when the
   * row carried none. See influx/queries.ts for how the epoch was confirmed
   * and domain/alerts.ts for what reads it.
   */
  statusStartTime: number | null;
}

export interface PlantLiveness {
  plant: string;
  lastSeen: string | null;
  /** Distinct machines heard from in the window. */
  machineCount: number;
}

/**
 * A slice of a windowed fetch that no query could read - see `fetchWindow`.
 *
 * Recorded rather than thrown because the alternative is worse: one dense
 * stretch of the picked window used to cost the reader every other day in it.
 * A gap makes the response say which hours are missing, so the numbers can be
 * served AND read for what they are - "27 of these 28 days" - instead of the
 * board choosing between a lie and a blank.
 */
export interface WindowGap {
  /** Inclusive start of the unreadable slice, UTC. */
  from: string;
  /** Exclusive end, UTC. */
  to: string;
  /** What InfluxDB said, for the envelope warning. */
  error: string;
}

export interface LiveSnapshot {
  /** When the last poll attempt finished, success or not. */
  fetchedAt: string;
  /** When data was last actually retrieved. Drives `SourceHealth.last_success`. */
  lastSuccessAt: string | null;
  ok: boolean;
  error: string | null;
  /** Keyed by plant code, from the most recent SUCCESSFUL poll. */
  plants: Record<string, PlantLiveness>;
  /** Q-01's output, grouped by plant code. */
  machines: Record<string, MachineObservation[]>;

  /**
   * Q-09's output: per plant code, whether its telemetry has EVER reached this
   * backend - over a horizon far wider than `plants` above can see.
   *
   * Separate from `plants` because it answers a different question on a
   * different clock. `plants` is this window: who is reporting right now, reread
   * every couple of seconds. This is all of history: who has ever reported,
   * settled once and then left alone (config/policy.ts's EVER_SEEN_PROBE_INTERVAL_MS
   * explains why an hour is generous rather than lax).
   *
   * A plant missing from this map is `'unknown'` to every reader - which is what
   * a poller constructed without `plantCodes` produces, and what every plant
   * looks like until the first probe lands.
   */
  everSeen: Record<string, EverSeen>;
  /**
   * Raw `Result` values the contract's enum does not cover, as
   * `"PLANT/MACHINE: value"`. Such a machine is left OUT of the observed set
   * rather than guessed into a bucket, so it reconciles as `Offline` against
   * `machinesExpected` and the operator gets told which value to add.
   */
  unknownStatuses: string[];

  /**
   * Q-03's output: one entry per machine, carrying the %OA of the order it is
   * running now. Flat rather than keyed by plant because the averages are taken
   * over machines at every level (see domain/oa.ts) and a nested shape would
   * have to be flattened again at each one.
   */
  oa: MachineOa[];
  /** When the %OA query last succeeded. Separate clock - see `oaIntervalMs`. */
  oaLastSuccessAt: string | null;
  oaOk: boolean;
  oaError: string | null;

  /**
   * Q-05's output: one entry per (clock hour x machine) over the last 24 h.
   * Flat for the same reason `oa` is - the chart is drawn at whatever level the
   * route asks for, and every level averages over machines.
   */
  trend: MachineHourOa[];
  trendLastSuccessAt: string | null;
  trendOk: boolean;
  trendError: string | null;

  /*
   * The two below are set by windowed fetches only (windowedSnapshot.ts) and
   * left undefined by the poller, whose window is one query wide and has
   * nothing to split or lose. Optional rather than defaulted so a reader can
   * tell "no gaps" from "not that kind of fetch" - the poller's own failures
   * are already carried by `ok`/`error`.
   */

  /** Sub-windows of the picked window that no query could read. */
  gaps?: WindowGap[];
  /**
   * How many queries the window actually cost, per query family - the chunk
   * count plus whatever the narrow retries added. Travels to the payload's
   * `window.chunks`, which would otherwise advertise the pre-retry plan.
   */
  chunksQueried?: number;
}

export interface MiniLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface SnapshotPoller {
  /**
   * Resolves once the first poll has landed, so a caller can fill the snapshot
   * before it starts serving traffic. Without that await there is a window -
   * short, but real - where a freshly booted server answers `no_data` for
   * every site on a perfectly healthy system, which is indistinguishable on
   * screen from every gateway having died at once.
   */
  start(): Promise<void>;
  stop(): void;
  current(): LiveSnapshot;
  /** Exposed so tests can drive one deterministic cycle without a timer. */
  refreshOnce(): Promise<LiveSnapshot>;
}

const KNOWN_STATUSES = new Set<string>(zMachineStatus.options);

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function emptySnapshot(configured: boolean): LiveSnapshot {
  return {
    fetchedAt: new Date().toISOString(),
    lastSuccessAt: null,
    ok: false,
    error: configured
      ? 'no poll has completed yet'
      : 'InfluxDB is not configured (INFLUX_URL / INFLUX_DATABASE / INFLUX_TOKEN)',
    plants: {},
    machines: {},
    everSeen: {},
    unknownStatuses: [],
    oa: [],
    oaLastSuccessAt: null,
    oaOk: false,
    oaError: configured ? 'no %OA poll has completed yet' : null,
    trend: [],
    trendLastSuccessAt: null,
    trendOk: false,
    trendError: configured ? 'no trend poll has completed yet' : null,
  };
}

export function createSnapshotPoller(opts: {
  client: InfluxClient;
  intervalMs: number;
  windowHours?: number;
  /**
   * How often %OA (Q-03/Q-04) is re-read.
   *
   * **Was 30 s, and that was the visible lag.** The card sat up to 30 s behind
   * the plant board, which recomputes its own %OA on every dashboard refresh -
   * so two screens side by side disagreed for half a minute at a time and the
   * newer number was always Grafana's.
   *
   * Re-measured on 2026-08-27 at the current scope: **473-894 ms**. At 5 s that
   * is under a fifth of the interval, which is a duty cycle worth paying for a
   * headline KPI that an executive reads against another screen.
   */
  oaIntervalMs?: number;

  /**
   * How often the hourly trend (Q-05) is re-read - on its own clock, and
   * deliberately much slower.
   *
   * This used to share `oaIntervalMs`, on the reasoning that both read the same
   * table over the same day so no interval could be right for one and wrong for
   * the other. That was wrong, and in the expensive direction: the trend is the
   * costlier query (**418-1828 ms** measured, against 473-894 ms for %OA) and
   * the one that cannot move. Its newest point is an hour-long bucket - a
   * five-second refresh cannot change it by anything a reader could see, while
   * a stale %OA is visible immediately.
   *
   * Splitting them is what lets %OA go fast without paying for the chart twenty
   * times a minute.
   *
   * Safe for the freeze detector: it compares `meta.generated_at` only, which
   * is rebuilt on every request regardless of which query last ran.
   */
  trendIntervalMs?: number;
  oaWindowHours?: number;
  trendPoints?: number;

  /**
   * The plant codes to answer `everSeen` for - master data's, supplied by the
   * caller rather than imported here so this service stays free of the company
   * table (app.ts owns that wiring).
   *
   * Omitted means "do not probe", which is what every `.inject()` test wants:
   * no plant codes, no Q-09 traffic, and every reader sees `'unknown'`.
   */
  plantCodes?: readonly string[];

  /** Overridable for tests; see EVER_SEEN_PROBE_INTERVAL_MS for why an hour. */
  everSeenIntervalMs?: number;

  /**
   * How long a completed `'no'` stands before it is walked again. Overridable
   * for tests; see EVER_SEEN_RECHECK_INTERVAL_MS for why a day.
   */
  everSeenRecheckMs?: number;
  log?: MiniLogger;
}): SnapshotPoller {
  const {
    client,
    intervalMs,
    windowHours,
    oaIntervalMs = 5_000,
    trendIntervalMs = 30_000,
    oaWindowHours,
    trendPoints,
    plantCodes = [],
    everSeenIntervalMs = EVER_SEEN_PROBE_INTERVAL_MS,
    everSeenRecheckMs = EVER_SEEN_RECHECK_INTERVAL_MS,
    log,
  } = opts;

  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let snapshot = emptySnapshot(client.configured);
  let oaAttemptedAtMs: number | null = null;
  let trendAttemptedAtMs: number | null = null;

  /*
   * The ever-seen ledger, held here rather than rebuilt per poll BECAUSE it is
   * monotonic: a `'yes'` is a fact about all of history that no later tick can
   * withdraw, so re-deriving it every two seconds would be re-asking a settled
   * question. It is also what makes the probe's cost fall to zero over time -
   * `pending` shrinks as sites come online and never grows back.
   */
  const everSeen: Record<string, EverSeen> = {};
  for (const code of plantCodes) everSeen[code] = 'unknown';
  snapshot = { ...snapshot, everSeen: { ...everSeen } };

  /**
   * When each plant last gave a COMPLETE `'no'` - the walk finished, every
   * slice read, nothing found.
   *
   * Only definitive answers are recorded. A walk that threw part-way leaves the
   * plant `'unknown'` and unrecorded, so the hourly retry keeps picking it up;
   * that is the difference between "we asked and the answer is no" and "we
   * could not finish asking", and it is what stops a flaky Influx from being
   * mistaken for a settled negative.
   */
  const everSeenAnsweredAtMs: Record<string, number> = {};

  let everSeenProbedAtMs: number | null = null;
  let probeInFlight = false;

  /**
   * The free half of the answer: anything in the hot window has, by definition,
   * reached us. Costs no query at all - the rows are already in hand - which is
   * why the probe below only ever has to deal with the leftovers.
   */
  function noteSeenInHotWindow(): void {
    let changed = false;
    for (const code of Object.keys(everSeen)) {
      if (everSeen[code] !== 'yes' && snapshot.plants[code]?.lastSeen) {
        everSeen[code] = 'yes';
        changed = true;
      }
    }
    if (changed) snapshot = { ...snapshot, everSeen: { ...everSeen } };
  }

  /**
   * The paid half: walk the horizon in narrow slices for each plant we still
   * have not heard from, newest first, stopping at the first row found.
   *
   * **Sequential, and detached from the tick that triggers it.** Detached
   * because proving a negative costs every slice in the horizon and the
   * 2-second status poll must never wait behind it; sequential because these
   * are the expensive reads, and firing them at once is not merely rude to the
   * hot poll - windowedSnapshot.ts records this instance answering HTTP 200
   * with *fewer rows* under concurrency, silently. Nothing reads this result
   * sooner for being parallel; it is an hourly answer either way.
   *
   * Measured 2026-09-08: a reporting plant costs one query (21-26 ms) because
   * its newest slice hits immediately; the three plants with nothing cost their
   * full 29-slice walk, 3.1-4.7 s each, 11.6 s together.
   */
  async function probeEverSeen(): Promise<void> {
    if (probeInFlight) return;

    /*
     * Two speeds, because `'unknown'` and `'no'` are different situations.
     *
     * `'unknown'` never got an answer - a probe that failed, or one that has
     * not run yet - so it is retried on the hourly clock this was written for.
     * `'no'` DID get an answer, and re-walking it hourly re-asks a settled
     * question 24 times a day; a site that starts reporting is caught by the
     * 2-second hot poll long before this probe would notice, so the daily
     * re-walk exists only for back-filled history (see the policy note).
     */
    const now = Date.now();
    const pending = Object.keys(everSeen).filter((code) => {
      if (everSeen[code] === 'yes') return false; // settled forever
      if (everSeen[code] === 'unknown') return true; // never answered - retry
      const answeredAt = everSeenAnsweredAtMs[code];
      return answeredAt === undefined || now - answeredAt >= everSeenRecheckMs;
    });
    if (pending.length === 0) return; // the steady state, most hours

    probeInFlight = true;
    try {
      const slices = everSeenWindows(Date.now(), EVER_SEEN.horizon_days, EVER_SEEN.slice_hours);

      for (const code of pending) {
        try {
          let found = false;
          for (const slice of slices) {
            const rows = await client.query<PlantEverSeenRow>(plantEverSeenInSql(code, slice));
            if (rows.length > 0) {
              found = true;
              break;
            }
          }
          everSeen[code] = found ? 'yes' : 'no';
          // Stamped only on a walk that completed - see everSeenAnsweredAtMs.
          if (!found) everSeenAnsweredAtMs[code] = Date.now();
        } catch (err) {
          /*
           * Left untouched, and the `catch` sits OUTSIDE the slice loop for a
           * reason: a slice that throws means part of the horizon went unread,
           * and "we did not find it in the part we could read" is not evidence
           * of never. Concluding `'no'` from a partial walk is exactly how an
           * unreachable Influx would turn a live site into `not_connected` on
           * screen. Next cycle starts the walk again.
           */
          log?.warn(
            { plant: code, err: reasonOf(err) },
            'ever-seen probe failed part-way - leaving as-is, retrying next cycle',
          );
        }
      }
      snapshot = { ...snapshot, everSeen: { ...everSeen } };
    } finally {
      probeInFlight = false;
    }
  }

  async function refreshOnce(): Promise<LiveSnapshot> {
    if (!client.configured) {
      snapshot = {
        ...snapshot,
        fetchedAt: new Date().toISOString(),
        ok: false,
        error: 'InfluxDB is not configured (INFLUX_URL / INFLUX_DATABASE / INFLUX_TOKEN)',
      };
      return snapshot;
    }

    const oaDue = oaAttemptedAtMs === null || Date.now() - oaAttemptedAtMs >= oaIntervalMs;
    if (oaDue) oaAttemptedAtMs = Date.now();

    // Its own clock, so the cheap headline number is not held back by the
    // expensive chart that cannot move anyway.
    const trendDue =
      trendAttemptedAtMs === null || Date.now() - trendAttemptedAtMs >= trendIntervalMs;
    if (trendDue) trendAttemptedAtMs = Date.now();

    // Settled, not raced: the three queries answer different questions and a
    // failure in one must not throw away the others' good data. A dead %OA
    // query with live telemetry should cost the board its efficiency figure,
    // not its machine counts, and a dead trend query should cost it only the
    // chart.
    const [status, oa, trend] = await Promise.allSettled([
      client.query<LatestMachineStatusRow>(latestMachineStatusSql(windowHours)),
      oaDue ? client.query<MachineOaRow>(machineOaSql(oaWindowHours)) : Promise.resolve(null),
      trendDue
        ? client.query<MachineHourOaRow>(machineHourOaSql(trendPoints))
        : Promise.resolve(null),
    ]);

    const at = new Date().toISOString();

    if (status.status === 'fulfilled') {
      snapshot = {
        ...snapshot,
        ...foldRows(status.value, log),
        fetchedAt: at,
        lastSuccessAt: at,
        ok: true,
        error: null,
      };
    } else {
      const message = reasonOf(status.reason);
      snapshot = { ...snapshot, fetchedAt: at, ok: false, error: message };
      log?.warn({ err: message }, 'influx snapshot poll failed - serving last known data');
    }

    if (oa.status === 'fulfilled') {
      // `null` means the %OA clock was not due this tick, so the previous rows
      // stand - not that the query came back empty.
      if (oa.value !== null) {
        snapshot = {
          ...snapshot,
          oa: foldMachineOa(oa.value),
          oaLastSuccessAt: at,
          oaOk: true,
          oaError: null,
        };
      }
    } else {
      const message = reasonOf(oa.reason);
      snapshot = { ...snapshot, oaOk: false, oaError: message };
      log?.warn({ err: message }, 'influx %OA poll failed - serving last known %OA');
    }

    if (trend.status === 'fulfilled') {
      // Same contract as `oa` above: `null` is "not due this tick", not "empty".
      if (trend.value !== null) {
        snapshot = {
          ...snapshot,
          trend: foldMachineHours(trend.value),
          trendLastSuccessAt: at,
          trendOk: true,
          trendError: null,
        };
      }
    } else {
      const message = reasonOf(trend.reason);
      snapshot = { ...snapshot, trendOk: false, trendError: message };
      log?.warn({ err: message }, 'influx trend poll failed - serving last known trend');
    }

    // After the fold, so it reads the plants this tick actually returned.
    noteSeenInHotWindow();

    /*
     * The fourth clock, and the only one whose work is NOT awaited here - see
     * `probeEverSeen`. `void` is the point: this tick returns the moment the
     * status fold is done, and a probe grinding through a 90-day negative scan
     * carries on in the background without holding a single screen refresh.
     */
    const everSeenDue =
      everSeenProbedAtMs === null || Date.now() - everSeenProbedAtMs >= everSeenIntervalMs;
    if (everSeenDue) {
      everSeenProbedAtMs = Date.now();
      void probeEverSeen();
    }

    return snapshot;
  }

  /**
   * Ticks dropped because the previous poll was still running.
   *
   * Counted rather than logged where it happens: a minute of slow Influx would
   * otherwise emit thirty near-identical lines, which is how a real signal gets
   * scrolled past. Reported once, by the poll that caused them.
   */
  let ticksSkipped = 0;

  function tick(): void {
    if (inFlight) {
      // A slow Influx must not queue up overlapping polls. Skipping is the
      // correct behaviour - the board simply serves data one interval older -
      // but it is invisible from outside, which is what the timing below fixes.
      ticksSkipped++;
      return;
    }
    inFlight = true;
    const startedAt = Date.now();
    void refreshOnce().finally(() => {
      inFlight = false;
      const tookMs = Date.now() - startedAt;
      const skipped = ticksSkipped;
      ticksSkipped = 0;

      /*
       * Why this is worth ten lines: every defence around a slow poll is
       * silent. The `inFlight` guard drops ticks, the client aborts at
       * INFLUX_TIMEOUT_MS, and a failed poll keeps the last good data on
       * screen - so the system degrades correctly and tells nobody. Measured
       * 2026-09-08, a healthy poll runs 187 ms median but has touched 1,921 ms,
       * which is close enough to the 2,000 ms interval that the first skipped
       * tick deserves to leave a trace rather than be discovered months later
       * by someone wondering why the board feels sluggish.
       *
       * Thresholds come from the interval itself, not a constant: this poller
       * is constructed with whatever SNAPSHOT_INTERVAL_MS the deployment sets,
       * and a warning tuned to 2,000 ms would be wrong on any other value.
       */
      if (skipped > 0) {
        log?.warn(
          { tookMs, intervalMs, ticksSkipped: skipped },
          'influx poll outran its interval - ticks were skipped, board data is that much older',
        );
      } else if (tookMs > intervalMs / 2) {
        log?.warn(
          { tookMs, intervalMs },
          'influx poll took over half its interval - no ticks lost yet',
        );
      }
    });
  }

  return {
    async start() {
      if (timer) return;
      if (!client.configured) {
        log?.info({}, 'influx not configured - snapshot poller idle, sources report down');
        return;
      }
      log?.info({ intervalMs, oaIntervalMs }, 'influx snapshot poller started');
      timer = setInterval(tick, intervalMs);
      // Never hold the event loop open on its own; the HTTP server does that.
      timer.unref();

      // Awaited, so the first payload the server serves is already real.
      // `inFlight` is held across it for the same reason `tick` sets it: a slow
      // first poll must not have the interval running a second one alongside.
      inFlight = true;
      try {
        await refreshOnce();
      } finally {
        inFlight = false;
      }
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },

    current() {
      return snapshot;
    },

    refreshOnce,
  };
}

/** Exported for tests: turns Q-01's flat rows into the per-plant view the API needs. */
export function foldRows(
  rows: LatestMachineStatusRow[],
  log?: MiniLogger,
): Pick<LiveSnapshot, 'plants' | 'machines' | 'unknownStatuses'> {
  const plants: Record<string, PlantLiveness> = {};
  const machines: Record<string, MachineObservation[]> = {};
  const unknownStatuses: string[] = [];

  for (const row of rows) {
    // A row with no plant or machine tag cannot be attributed to a site.
    // Counting it somewhere convenient would be inventing provenance.
    if (!row.plant || !row.machine) continue;

    const lastSeen = influxTimeToIsoUtc(row.last_seen);

    const liveness = (plants[row.plant] ??= { plant: row.plant, lastSeen: null, machineCount: 0 });
    liveness.machineCount += 1;
    if (lastSeen && (!liveness.lastSeen || lastSeen > liveness.lastSeen)) {
      liveness.lastSeen = lastSeen;
    }

    if (!row.result || !KNOWN_STATUSES.has(row.result)) {
      unknownStatuses.push(`${row.plant}/${row.machine}: ${row.result ?? '(null)'}`);
      continue;
    }

    (machines[row.plant] ??= []).push({
      plant: row.plant,
      machine: row.machine,
      process: row.process,
      zone: row.zone,
      status: row.result as MachineStatus,
      lastSeen,
      statusStartTime: row.status_start_time,
    });
  }

  if (unknownStatuses.length > 0) {
    log?.warn(
      { unknownStatuses: unknownStatuses.slice(0, 20) },
      'InfluxDB emitted machine statuses outside the contract enum - add them to zMachineStatus and BUCKET_OF',
    );
  }

  return { plants, machines, unknownStatuses };
}
