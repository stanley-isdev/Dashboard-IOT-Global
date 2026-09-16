import { describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import type { InfluxClient } from '../src/influx/client.ts';
import { sourceHealthFrom } from '../src/lib/sourceHealth.ts';
import { createSnapshotPoller } from '../src/services/liveSnapshot.ts';

/**
 * One site's window must not be able to take the board down.
 *
 * ## The defect
 *
 * The poller asked for every site in ONE statement - a `UNION ALL` of one
 * branch per window, because the branches are disjoint by plant and the union
 * is exactly what a per-site query would have returned. That reasoning is sound
 * about ROWS and wrong about COST. InfluxDB 3 Core caps the Parquet files ONE
 * QUERY may scan, so a union of ASI's 71 h branch and everyone else's 24 h
 * branch is charged for the 71 h one, and the cap takes the whole statement.
 *
 * Measured on the live instance, 2026-09-16 03:02: the poll was rejected with
 * `Query would scan 432 Parquet files, exceeding the file limit`, all nine
 * plants read `No data`, and the banner said InfluxDB could not be reached -
 * while a 24 h query against the same instance answered in 138 ms. Eight sites
 * with nothing wrong with them were dark because of the ninth.
 *
 * ## Why the fix is a split, and why the split is not enough on its own
 *
 * A plant predicate prunes no files. At a width that was being refused (84 h,
 * measured the same morning) `plant IN ('6051')`, `plant NOT IN ('6051')` and
 * no predicate at all were rejected identically, while the same span read as
 * four bounded 24 h slices answered every time (3,629 / 3,884 / 2,676 / 2,928
 * rows). The cap counts files, files are laid down by time, and only the HOURS
 * move it.
 *
 * So the split keeps a rejection local to one site, and `narrow()` is what gets
 * that site its own data back. The two are tested separately below because they
 * fail separately.
 */

interface Call {
  sql: string;
  /** Concurrent reads make this instance return FEWER ROWS at HTTP 200. */
  inFlightWhenSent: number;
}

const REFUSAL = 'External error: Query would scan 432 Parquet files, exceeding the file limit';

/**
 * A fake that refuses queries the way the cap does - on WIDTH, measured off the
 * SQL, for both the relative and the bounded form.
 *
 * `refuseForPlant` is the separate knob for a site that cannot be read at any
 * width. Nothing about the real cap behaves that way; it stands in for "this
 * family is unreadable however it is sliced", which is the state the carry-over
 * and the amber banner exist for.
 *
 * Both are mutable so a test can tighten the instance under a running poller,
 * which is how the outage arrived in production.
 */
function fakeClient(opts: { refuseWiderThan?: number; refuseForPlant?: string } = {}) {
  let inFlight = 0;
  const c = {
    configured: true,
    calls: [] as Call[],
    maxConcurrent: 0,
    ...opts,
    async query<T>(sql: string): Promise<T[]> {
      inFlight++;
      c.maxConcurrent = Math.max(c.maxConcurrent, inFlight);
      c.calls.push({ sql, inFlightWhenSent: inFlight });
      try {
        await new Promise((r) => setImmediate(r));

        // Q-09's existence probe and the trend query are not what this file is
        // about; answer them emptily so they cannot colour the assertions.
        if (/"plant" = '/.test(sql) || /date_bin/.test(sql)) return [] as T[];

        const plant = /"plant" IN \('([^']+)'\)/.exec(sql)?.[1] ?? 'OTHER';
        if (c.refuseForPlant !== undefined && plant === c.refuseForPlant) throw new Error(REFUSAL);

        if (c.refuseWiderThan !== undefined && widthHours(sql) > c.refuseWiderThan) {
          throw new Error(REFUSAL);
        }

        return [
          {
            plant,
            machine: `M-${plant}`,
            process: 'Injection',
            zone: null,
            result: 'Mass Pro',
            last_seen: '2026-09-16T03:00:00',
            status_start_time: null,
          },
        ] as T[];
      } finally {
        inFlight--;
      }
    },
  };
  return c as unknown as InfluxClient & {
    calls: Call[];
    maxConcurrent: number;
    refuseWiderThan?: number;
    refuseForPlant?: string;
  };
}

/** The window a statement asks for, however it spells it. */
function widthHours(sql: string): number {
  const relative = /INTERVAL '(\d+) hours'/.exec(sql);
  if (relative) return Number(relative[1]);
  const bounds = [...sql.matchAll(/timestamp '([^']+)'/g)].map((m) => Date.parse(m[1]!));
  if (bounds.length < 2) return 0;
  return (Math.max(...bounds) - Math.min(...bounds)) / 3_600_000;
}

/** ASI reads three days, everyone else one - the plan app.ts builds. */
const PLAN = { defaultHours: 24, overrides: [{ plants: ['6051'], hours: 71 }] };

const poller = (client: InfluxClient) =>
  createSnapshotPoller({
    client,
    intervalMs: 60_000, // never auto-ticks; the tests drive refreshOnce
    windowHours: PLAN,
    oaWindowHours: PLAN,
    trendIntervalMs: 60_000,
  });

const statusCalls = (c: { calls: Call[] }) =>
  c.calls.filter((x) => x.sql.includes('ROW_NUMBER() OVER'));

const ENV = { INFLUX_URL: 'u', INFLUX_DATABASE: 'd', INFLUX_TOKEN: 't' } as Env;

describe('one query per site window', () => {
  it('never sends two windows in one statement', async () => {
    const client = fakeClient();
    const snap = await poller(client).refreshOnce();

    expect(snap.ok).toBe(true);
    for (const call of client.calls) expect(call.sql).not.toContain('UNION ALL');
    // Two families, so two census queries - ASI's and everyone else's.
    expect(statusCalls(client)).toHaveLength(2);
  });

  /*
   * The rule from windowedSnapshot.ts, which this path is now also under: six
   * reads in flight returned 828 status rows where the same work run one at a
   * time returned 1,510, at HTTP 200 and with no error on any of them. A short
   * answer is indistinguishable downstream from a quiet day, so splitting a
   * query family must not turn into firing its pieces at once.
   */
  it('runs the site families one at a time', async () => {
    const client = fakeClient();
    await poller(client).refreshOnce();

    // status + %OA + trend may overlap as they always did; the SITE families
    // inside each of them may not add to that.
    expect(client.maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('gives each site its own window and nobody else\'s', async () => {
    const client = fakeClient();
    await poller(client).refreshOnce();

    for (const call of statusCalls(client)) {
      const asi = call.sql.includes(`"plant" IN ('6051')`);
      expect(widthHours(call.sql)).toBe(asi ? 71 : 24);
    }
  });
});

describe('a site that cannot be read at all', () => {
  it('serves every site that answered', async () => {
    const client = fakeClient({ refuseForPlant: '6051' });
    const snap = await poller(client).refreshOnce();

    expect(snap.ok).toBe(true);
    expect(snap.error).toBeNull();
    expect(Object.keys(snap.plants)).toContain('OTHER');
  });

  it('names the site it lost rather than blaming the connection', async () => {
    const client = fakeClient({ refuseForPlant: '6051' });
    const snap = await poller(client).refreshOnce();

    const outage = snap.siteOutages.find((o) => o.covers === 'listed');
    expect(outage?.plants).toEqual(['6051']);
    expect(outage?.hours).toBe(71);
    expect(outage?.error).toMatch(/432 Parquet files/);
  });

  it('reports the source degraded, not down, and says which sites are behind', async () => {
    const client = fakeClient({ refuseForPlant: '6051' });
    const snap = await poller(client).refreshOnce();
    const [influx] = sourceHealthFrom(snap, ENV);

    expect(influx!.status).toBe('degraded');
    expect(influx!.message).toContain('6051');
    expect(influx!.last_success).not.toBeNull();
  });

  /*
   * The "shows 0" bug, one axis over from the one the poller has always guarded
   * against by keeping the previous snapshot on a wholly failed poll. A site we
   * could not ask must not be emptied by the tick that could not ask it.
   */
  it('keeps the previous numbers for the site it could not read', async () => {
    const client = fakeClient();
    const p = poller(client);

    const good = await p.refreshOnce();
    expect(good.plants['6051']).toBeDefined();
    expect(good.machines['6051']).toHaveLength(1);

    // The instance turns against 6051 under the poller's feet.
    client.refuseForPlant = '6051';
    const after = await p.refreshOnce();

    expect(after.ok).toBe(true);
    expect(after.siteOutages.some((o) => o.plants.includes('6051'))).toBe(true);
    // Carried, not blanked - and the sites that did answer still refreshed.
    expect(after.plants['6051']).toEqual(good.plants['6051']);
    expect(after.machines['6051']).toEqual(good.machines['6051']);
    expect(after.plants['OTHER']).toBeDefined();
  });

  it('is a failed poll, not a partial one, when every site is refused', async () => {
    const client = fakeClient({ refuseWiderThan: 0 });
    const snap = await poller(client).refreshOnce();

    expect(snap.ok).toBe(false);
    expect(snap.error).toMatch(/432 Parquet files/);
    // "These sites are behind" is a claim about a poll that partly worked.
    expect(snap.siteOutages).toEqual([]);
  });
});

describe('a refused site retries narrow rather than staying dark', () => {
  /*
   * Only the hours move the cap, so the retry is the same plants over bounded
   * slices of the same span. The fake refuses on width alone, which is exactly
   * how the instance behaved: `INTERVAL '71 hours'` rejected, the bounded 24 h
   * slices of that span all answered.
   */
  it('falls back to bounded slices of its own window', async () => {
    const client = fakeClient({ refuseWiderThan: 24 });
    const snap = await poller(client).refreshOnce();

    const slices = statusCalls(client).filter((c) => c.sql.includes('timestamp '));
    expect(slices.length).toBeGreaterThan(1);
    for (const s of slices) {
      expect(s.sql).toContain(`"plant" IN ('6051')`);
      expect(widthHours(s.sql)).toBeLessThanOrEqual(24);
    }

    // And having answered, the site is not an outage at all.
    expect(snap.siteOutages).toEqual([]);
    expect(Object.keys(snap.plants)).toContain('6051');
    expect(sourceHealthFrom(snap, ENV)[0]!.status).toBe('ok');
  });

  it('merges the slices instead of counting the machine once per slice', async () => {
    const client = fakeClient({ refuseWiderThan: 24 });
    const snap = await poller(client).refreshOnce();

    // The fake returns the same machine for every slice. Concatenating would
    // inflate `machineCount` by the slice count - the exact bug `mergeRows`
    // exists to prevent.
    expect(snap.plants['6051']!.machineCount).toBe(1);
    expect(snap.machines['6051']).toHaveLength(1);
  });

  /*
   * The poll runs every couple of SECONDS. Paying for the doomed wide query on
   * every tick before falling back is the expensive half of the work, done to
   * re-learn a settled fact.
   */
  it('remembers, and stops re-sending the query it knows will be refused', async () => {
    const client = fakeClient({ refuseWiderThan: 24 });
    const p = poller(client);
    const wide = () => statusCalls(client).filter((c) => widthHours(c.sql) === 71).length;

    await p.refreshOnce();
    expect(wide()).toBe(1);

    await p.refreshOnce();
    // Still one: the second tick went straight to the slices.
    expect(wide()).toBe(1);
  });
});
