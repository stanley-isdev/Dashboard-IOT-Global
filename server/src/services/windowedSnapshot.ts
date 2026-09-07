import type { Range, ServedWindow } from '@dashboard/contract';
import { zonedToUtc } from '@dashboard/domain-shared';
import { foldMachineOa } from '../domain/oa.ts';
import { foldMachineHours } from '../domain/trend.ts';
import type { InfluxClient } from '../influx/client.ts';
import {
  chunkWindow,
  latestMachineStatusInSql,
  machineHourOaInSql,
  machineOaInSql,
  MAX_ASSEMBLED_HOURS,
  MAX_WINDOW_HOURS,
  OA_WINDOW_HOURS,
  type LatestMachineStatusRow,
  type MachineHourOaRow,
  type MachineOaRow,
  type Window,
} from '../influx/queries.ts';
import { influxTimeToIsoUtc } from '../influx/time.ts';
import { foldRows, type LiveSnapshot, type MiniLogger } from './liveSnapshot.ts';

/**
 * Serving a window the poller does not hold.
 *
 * ## Why this exists at all
 *
 * Every other request on this server is answered out of one background
 * snapshot, and that is deliberate: with N wall-mounted screens polling the
 * API, load on InfluxDB does not scale with the number of viewers (see the
 * note at the top of liveSnapshot.ts). Nothing here weakens that. The poller
 * still holds the default window and still answers the overwhelming majority
 * of requests untouched.
 *
 * What this adds is the one case that snapshot cannot answer: a reader who has
 * picked a window of their own. Until 2026-09-03 `range` was accepted, echoed
 * back in `filters_applied` and applied to **nothing** - `8h`, `24h` and `7d`
 * all returned the poller's fixed 24 h, so the control changed what the board
 * *said* its scope was and not what it showed. That is the same class of fault
 * as the Process filter before it was made real, and the calendar's disabled
 * Apply button existed to avoid committing it a third time.
 *
 * ## Why it can be done at all
 *
 * BACKEND-HANDOVER §4.2 recorded queries past ~3 days failing with an
 * empty-bodied 500 and no diagnosis, which is why the absolute picker shipped
 * disabled. Re-measured 2026-09-03, the instance names the cause:
 * `Query would scan 432 Parquet files, exceeding the file limit`. A **file cap
 * per query**, not a limit on how far back the data goes - and bounded windows
 * deep in the past answer fine. So a wide window is servable as several narrow
 * ones, which is what `chunkWindow` and the merges below do.
 *
 * ## What is exact and what is not
 *
 * The merges are exact rather than approximations, and that matters more than
 * the speed: the %OA columns re-aggregate (MIN of MINs, SUM of SUMs), the
 * census takes the newest row per machine across chunks, and the hourly buckets
 * cannot straddle a chunk boundary because the chunker only cuts on whole
 * hours. A three-chunk week returns what one query would have returned if the
 * instance could run it.
 *
 * The cost is not hidden: `ServedWindow.chunks` travels on the payload, so a
 * seven-day board being slower than the default one is answerable from the
 * response rather than from a log nobody has.
 */

/** The default window - what the poller already holds, in hours. */
export const DEFAULT_WINDOW_HOURS = OA_WINDOW_HOURS;

const HOUR_MS = 3_600_000;

/** Hours behind `now` each quick range reaches. */
export const RANGE_HOURS: Record<Range, number> = {
  '8h': 8,
  '24h': 24,
  '7d': 24 * 7,
};

export interface WindowRequest {
  range: Range;
  /** Calendar days from the picker, or null for "use `range`". */
  from?: string | null;
  to?: string | null;
}

export interface ResolvedWindow {
  /** The instants to query. */
  window: Window;
  /** What to tell the reader was measured - travels on the payload. */
  served: ServedWindow;
  /**
   * True when this is exactly the window the poller already holds, so the
   * route can serve it from the snapshot without touching InfluxDB.
   */
  isDefault: boolean;
  /**
   * Why an absolute pair was rejected, if it was. Becomes an envelope warning:
   * a board that silently fell back to the quick range would be telling the
   * reader their pick had been honoured.
   */
  rejection: string | null;
}

/**
 * Turns what the picker sent into the window that will actually be queried.
 *
 * Absolute days are read in the fleet's reference zone, because that is the
 * zone the calendar drew them in - resolving "1 Aug" against the server's own
 * clock would shift a Bangkok reader's window by seven hours and put six of
 * their morning's rows in the previous day.
 *
 * The end day is inclusive, which is what a reader means by "1 Aug to 3 Aug",
 * so it resolves to the START of the following day - the half-open `[from, to)`
 * the chunker and the SQL both use.
 *
 * Nothing here refuses a pick unless it is meaningless. A window reaching past
 * retention is CLAMPED and flagged (`served.clamped`), because a reader who
 * asks for a fortnight the instance no longer holds is better served by the ten
 * days it does hold, labelled as ten days, than by an error.
 */
export function resolveWindow(opts: {
  request: WindowRequest;
  now: Date;
  /** The zone the calendar's days were drawn in. */
  timeZone: string;
  /** Oldest day the instance still answers for, `YYYY-MM-DD` in `timeZone`. */
  earliestDate: string;
  maxAssembledHours?: number;
}): ResolvedWindow {
  const { request, now, timeZone, earliestDate } = opts;
  const maxHours = opts.maxAssembledHours ?? MAX_ASSEMBLED_HOURS;
  const nowMs = now.getTime();
  const floorMs = startOfDay(earliestDate, timeZone);

  const absolute = request.from && request.to ? { from: request.from, to: request.to } : null;
  let rejection: string | null = null;

  if (absolute) {
    const fromMs = startOfDay(absolute.from, timeZone);
    // Inclusive end day: "to 3 Aug" means up to the start of 4 Aug.
    const toMs = Math.min(startOfDay(absolute.to, timeZone) + 86_400_000, nowMs);

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      rejection = `could not read the picked dates (${absolute.from} .. ${absolute.to}) in ${timeZone}`;
    } else if (toMs <= fromMs) {
      // Wholly in the future, or reversed once clamped at `now`.
      rejection =
        `the picked window ${absolute.from} .. ${absolute.to} ends before it starts once clamped ` +
        'to now - the board cannot read hours the machines have not worked yet';
    } else {
      const clampedFrom = Math.max(fromMs, floorMs);
      const widthHours = (toMs - clampedFrom) / HOUR_MS;
      if (widthHours > maxHours) {
        // Keep the END the reader picked and give up the far edge: they are
        // nearly always reaching back from a date they care about.
        const cut = toMs - maxHours * HOUR_MS;
        return built(cut, toMs, 'absolute', true, null);
      }
      return built(clampedFrom, toMs, 'absolute', clampedFrom > fromMs, null);
    }
  }

  const hours = RANGE_HOURS[request.range];
  const wantFrom = nowMs - hours * HOUR_MS;
  const from = Math.max(wantFrom, floorMs);
  return built(from, nowMs, 'range', from > wantFrom, rejection);

  function built(
    fromMs: number,
    toMs: number,
    source: ServedWindow['source'],
    clamped: boolean,
    why: string | null,
  ): ResolvedWindow {
    const window = { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
    const spanHours = (toMs - fromMs) / HOUR_MS;
    return {
      window,
      served: {
        ...window,
        hours: Math.round(spanHours * 100) / 100,
        source,
        chunks: chunkWindow(window).length,
        clamped,
      },
      /*
       * The fast path, and deliberately narrow: only a `now`-anchored 24 h
       * range is the poller's own window. An absolute pick that happens to be
       * 24 h wide is NOT - it ends at midnight, not at now - and serving it out
       * of the snapshot would answer a question about yesterday with today's
       * numbers.
       */
      isDefault:
        source === 'range' &&
        !clamped &&
        RANGE_HOURS[request.range] === DEFAULT_WINDOW_HOURS &&
        toMs === nowMs,
      rejection: why,
    };
  }
}

/** Midnight of `YYYY-MM-DD` in `timeZone`, as epoch ms. */
function startOfDay(date: string, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return Number.NaN;
  return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone).getTime();
}

export interface WindowStore {
  /** The snapshot for one window, from cache when it is still warm. */
  get(window: Window): Promise<LiveSnapshot>;
  /** Exposed for tests - how many windows are held. */
  size(): number;
}

interface Entry {
  at: number;
  /** The in-flight promise, so ten screens picking "7d" at once cost one fetch. */
  value: Promise<LiveSnapshot>;
}

/**
 * A small cache of windowed snapshots, keyed on the window itself.
 *
 * `ttlMs` is short for a reason that is not performance: a window ending at
 * `now` moves every second, so its key changes every second and it would never
 * hit anyway. What the cache actually protects is the case that matters - a
 * wall of screens all showing the same ABSOLUTE window, whose key is stable,
 * and which would otherwise each pay nine queries per refresh.
 *
 * Entries hold the promise, not the result, so concurrent requests for one
 * window share a single fetch rather than racing three of them into Influx.
 */
export function createWindowStore(opts: {
  client: InfluxClient;
  ttlMs?: number;
  /** Beyond this many windows the oldest are dropped. Bounds a hostile caller. */
  maxEntries?: number;
  log?: MiniLogger;
}): WindowStore {
  const { client, ttlMs = 30_000, maxEntries = 32, log } = opts;
  const cache = new Map<string, Entry>();

  return {
    size: () => cache.size,

    async get(window: Window): Promise<LiveSnapshot> {
      const key = `${window.from}..${window.to}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;

      const value = fetchWindow(client, window, log);
      cache.set(key, { at: Date.now(), value });

      // A failed fetch must not be cached: the next reader should retry, not be
      // handed the same rejection for the next thirty seconds.
      void value.catch(() => cache.delete(key));

      if (cache.size > maxEntries) {
        // Map preserves insertion order, so the first key is the oldest.
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return value;
    },
  };
}

/**
 * One window, assembled from however many chunks it takes.
 *
 * The three QUERY FAMILIES are settled rather than raced, exactly as the poller
 * settles them: a dead trend query must cost this window its chart, not its
 * machine counts.
 *
 * Within a family the chunks run **one at a time**, and that is a correctness
 * fix rather than politeness. Firing all of them at once put nine concurrent
 * reads of a multi-day window at the instance and it answered one of them with
 * the empty-bodied 500 - measured on 2026-09-03, where a 7-day board came back
 * with an empty census while every one of its three chunks succeeded when run
 * on its own. Nine is also simply more than this board has any business asking
 * a shared production instance for in one burst; three is the width of the
 * families, and they are genuinely different questions.
 *
 * The cost is wall-clock on the widest windows only, and it is bounded by the
 * chunk count the payload already declares.
 */
async function fetchWindow(
  client: InfluxClient,
  window: Window,
  log?: MiniLogger,
): Promise<LiveSnapshot> {
  const at = new Date().toISOString();

  if (!client.configured) {
    throw new Error('InfluxDB is not configured (INFLUX_URL / INFLUX_DATABASE / INFLUX_TOKEN)');
  }

  const chunks = chunkWindow(window, MAX_WINDOW_HOURS);
  /* Sequential, not `Promise.all` - see the note above. A `for` loop rather
     than a reduce chain so a failing chunk rejects the family immediately
     instead of after every remaining chunk has also been sent. */
  const all = async <T>(sql: (w: Window) => string): Promise<T[]> => {
    const out: T[] = [];
    for (const c of chunks) out.push(...(await client.query<T>(sql(c))));
    return out;
  };

  const [status, oa, trend] = await Promise.allSettled([
    all<LatestMachineStatusRow>(latestMachineStatusInSql),
    all<MachineOaRow>(machineOaInSql),
    all<MachineHourOaRow>(machineHourOaInSql),
  ]);

  if (status.status === 'rejected') {
    // Unlike the poller, there is no previous good snapshot for this window to
    // fall back to - it has never been fetched. Failing loudly is the honest
    // answer; the route turns it into a degraded envelope.
    throw status.reason instanceof Error ? status.reason : new Error(String(status.reason));
  }

  const folded = foldRows(mergeLatestStatus(status.value), log);
  const oaFailed = oa.status === 'rejected' ? reasonOf(oa.reason) : null;
  const trendFailed = trend.status === 'rejected' ? reasonOf(trend.reason) : null;

  return {
    fetchedAt: at,
    lastSuccessAt: at,
    ok: true,
    error: null,
    ...folded,
    oa: oa.status === 'fulfilled' ? foldMachineOa(mergeOaGroups(oa.value)) : [],
    oaLastSuccessAt: oa.status === 'fulfilled' ? at : null,
    oaOk: oa.status === 'fulfilled',
    oaError: oaFailed,
    // Concatenated, not merged: `chunkWindow` cuts only on whole hours and
    // `date_bin` bins to those same hours, so no bucket straddles two chunks.
    trend: trend.status === 'fulfilled' ? foldMachineHours(trend.value) : [],
    trendLastSuccessAt: trend.status === 'fulfilled' ? at : null,
    trendOk: trend.status === 'fulfilled',
    trendError: trendFailed,
  };
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Q-01 across chunks: the newest substantive row per machine.
 *
 * Each chunk's SQL already reduced to one row per machine WITHIN that chunk, so
 * this only has to pick between chunks - and the newest of those is the newest
 * of the whole window, because the chunks tile it without overlap. Concatenating
 * instead would hand `foldRows` several rows per machine and inflate every
 * plant's `machineCount` by the chunk count.
 */
export function mergeLatestStatus(rows: LatestMachineStatusRow[]): LatestMachineStatusRow[] {
  const newest = new Map<string, { row: LatestMachineStatusRow; at: string }>();
  for (const row of rows) {
    if (!row.plant || !row.machine) continue;
    // Keyed on plant AND machine: machine names repeat across plants (`I1`
    // exists at more than one), and a key on the name alone would let one
    // plant's row displace another's.
    const key = `${row.plant}|${row.machine}`;
    // Compared as ISO-UTC strings, which sort lexicographically in time order.
    // A row with no readable timestamp loses to any row that has one.
    const at = influxTimeToIsoUtc(row.last_seen) ?? '';
    const held = newest.get(key);
    if (!held || at > held.at) newest.set(key, { row, at });
  }
  return [...newest.values()].map((v) => v.row);
}

/**
 * Q-03/Q-04 across chunks: re-aggregate each `(plant, machine, PO slots)` group.
 *
 * Every column re-aggregates exactly - MIN of MINs, SUM of SUMs, COUNT of
 * COUNTs, MAX of MAXs - so the group this produces is the row a single query
 * over the whole window would have returned. That equality is the entire
 * justification for chunking; without it this would be a way of blurring the
 * file-scan cap rather than working within it.
 *
 * `plan*` and `cd*` are order attributes repeated onto every shot row and
 * constant within a group (verified against the live instance - see the
 * `MachineOaRow.plan0` note), so MAX picks the one value there is.
 */
export function mergeOaGroups(rows: MachineOaRow[]): MachineOaRow[] {
  const groups = new Map<string, MachineOaRow>();
  for (const row of rows) {
    const key = [row.plant, row.machine, row.po0, row.po1, row.po2, row.po3].join(' ');
    const held = groups.get(key);
    if (!held) {
      groups.set(key, { ...row });
      continue;
    }
    held.min_std_time = least(held.min_std_time, row.min_std_time);
    held.sum_qty = add(held.sum_qty, row.sum_qty);
    held.shot_count = add(held.shot_count, row.shot_count);
    held.weighted_time = add(held.weighted_time, row.weighted_time);
    held.plan0 = greatest(held.plan0, row.plan0);
    held.plan1 = greatest(held.plan1, row.plan1);
    held.plan2 = greatest(held.plan2, row.plan2);
    held.plan3 = greatest(held.plan3, row.plan3);
    held.cd0 = greatestText(held.cd0, row.cd0);
    held.cd1 = greatestText(held.cd1, row.cd1);
    held.cd2 = greatestText(held.cd2, row.cd2);
    held.cd3 = greatestText(held.cd3, row.cd3);
    held.last_row = greatestText(held.last_row, row.last_row);
    // `process` is a tag on the row and identical across a group's chunks;
    // keeping the first non-null covers the case where one chunk's rows predate
    // the tag being set.
    held.process ??= row.process;
  }
  return [...groups.values()];
}

/* Null-tolerant folds. `null` means "this chunk contributed nothing here", not
   zero: treating it as zero would collapse MIN(std_time) to 0 and take every
   %OA on the machine with it. */
const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
const least = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);
const greatest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);
const greatestText = (a: string | null, b: string | null) =>
  a === null ? b : b === null ? a : a >= b ? a : b;
