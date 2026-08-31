import type { MachineStatus } from '@dashboard/contract';
import { zMachineStatus } from '@dashboard/contract';
import { foldMachineOa, type MachineOa } from '../domain/oa.ts';
import { foldMachineHours, type MachineHourOa } from '../domain/trend.ts';
import type { InfluxClient } from '../influx/client.ts';
import {
  latestMachineStatusSql,
  machineHourOaSql,
  machineOaSql,
  type LatestMachineStatusRow,
  type MachineHourOaRow,
  type MachineOaRow,
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
}

export interface PlantLiveness {
  plant: string;
  lastSeen: string | null;
  /** Distinct machines heard from in the window. */
  machineCount: number;
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
}

interface MiniLogger {
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
    log,
  } = opts;

  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let snapshot = emptySnapshot(client.configured);
  let oaAttemptedAtMs: number | null = null;
  let trendAttemptedAtMs: number | null = null;

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

    return snapshot;
  }

  function tick(): void {
    if (inFlight) return; // a slow Influx must not queue up overlapping polls
    inFlight = true;
    void refreshOnce().finally(() => {
      inFlight = false;
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
