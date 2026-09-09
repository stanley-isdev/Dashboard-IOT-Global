import { describe, expect, it } from 'vitest';
import { EVER_SEEN } from '../src/config/policy.ts';
import { createSnapshotPoller } from '../src/services/liveSnapshot.ts';
import type { InfluxClient } from '../src/influx/client.ts';

/**
 * The Q-09 probe's cost, which is the whole of the review concern raised on
 * 2026-09-08: the probe shares one InfluxDB with the poll every screen depends
 * on AND with the calendar picks that do run inside a request. How often it
 * walks, and how much of the horizon it re-walks, is therefore not an
 * implementation detail - it is the thing that was objected to.
 */

/**
 * Counts Q-09 queries specifically.
 *
 * Discriminated on the `"plant" = '...'` predicate rather than on `last_seen`,
 * which the hot status query also selects - a fake that confuses the two
 * reports the poll's own traffic as probe cost and makes these assertions
 * meaningless.
 */
function fakeClient(everSeenPlants: Set<string> = new Set()): InfluxClient & {
  probeQueries: number;
} {
  const c = {
    configured: true,
    probeQueries: 0,
    async query<T>(sql: string): Promise<T[]> {
      const probed = /"plant" = '([^']+)'/.exec(sql)?.[1];
      if (probed === undefined) return [] as T[]; // the hot status/oa/trend polls
      c.probeQueries++;
      return (everSeenPlants.has(probed) ? [{ last_seen: '2026-09-08T00:00:00' }] : []) as T[];
    },
  };
  return c as InfluxClient & { probeQueries: number };
}

/** The probe is detached from the tick on purpose, so tests wait it out. */
async function settle(): Promise<void> {
  for (let i = 0; i < 400; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Slices are cut on whole-hour boundaries (`chunkWindow`), and `now` is not one,
 * so a horizon of N days yields N full slices plus up to two partial ones. The
 * count that matters is the bound, not a magic number.
 */
const MAX_SLICES = EVER_SEEN.horizon_days + 2;

describe('ever-seen probe cost', () => {
  it('walks the horizon once, then leaves a completed `no` alone', async () => {
    const client = fakeClient();
    const poller = createSnapshotPoller({
      client,
      intervalMs: 60_000,
      plantCodes: ['STJ-1'],
      everSeenIntervalMs: 0, // due on every tick
      everSeenRecheckMs: 60_000, // but a completed `no` stands for a minute
    });

    await poller.start();
    await settle();

    expect(poller.current().everSeen['STJ-1']).toBe('no');
    const afterFirst = client.probeQueries;
    expect(afterFirst).toBeGreaterThanOrEqual(EVER_SEEN.horizon_days);
    expect(afterFirst).toBeLessThanOrEqual(MAX_SLICES);

    // Three more probe-due ticks. Before the recheck clock existed each of these
    // re-walked the whole horizon - the 2,088 queries a day the review flagged.
    for (let i = 0; i < 3; i++) {
      await poller.refreshOnce();
      await settle();
    }
    expect(client.probeQueries).toBe(afterFirst);

    poller.stop();
  });

  it('stops at the first slice that holds a row, and never re-walks a `yes`', async () => {
    const client = fakeClient(new Set(['6332']));
    const poller = createSnapshotPoller({
      client,
      intervalMs: 60_000,
      plantCodes: ['6332'],
      everSeenIntervalMs: 0,
      everSeenRecheckMs: 0, // even with the recheck clock wide open
    });

    await poller.start();
    await settle();

    // Newest slice first, so a reporting plant costs ONE query, not twenty-eight.
    expect(client.probeQueries).toBe(1);
    expect(poller.current().everSeen['6332']).toBe('yes');

    for (let i = 0; i < 3; i++) {
      await poller.refreshOnce();
      await settle();
    }
    expect(client.probeQueries).toBe(1); // `yes` is settled for the process

    poller.stop();
  });

  it('retries a walk that failed rather than calling the plant never-seen', async () => {
    let fail = true;
    const client = {
      configured: true,
      probeQueries: 0,
      async query<T>(sql: string): Promise<T[]> {
        if (!/"plant" = '/.test(sql)) return [] as T[];
        client.probeQueries++;
        if (fail) throw new Error('influx unreachable');
        return [] as T[];
      },
    } as InfluxClient & { probeQueries: number };

    const poller = createSnapshotPoller({
      client,
      intervalMs: 60_000,
      plantCodes: ['STJ-1'],
      everSeenIntervalMs: 0,
      everSeenRecheckMs: 86_400_000,
    });

    await poller.start();
    await settle();
    /*
     * A walk that threw must NOT settle as `no`. Concluding "never seen" from a
     * partial read is how an unreachable Influx would put `not_connected` on a
     * live site's tile - the failure this whole feature exists to prevent, in
     * the opposite direction.
     */
    expect(poller.current().everSeen['STJ-1']).toBe('unknown');

    fail = false;
    await poller.refreshOnce();
    await settle();
    expect(poller.current().everSeen['STJ-1']).toBe('no');

    poller.stop();
  });
});

/**
 * Slow-poll visibility. Every defence around a slow Influx is silent - the
 * tick guard drops ticks, the client aborts, the last good data stays on
 * screen - so without these lines the board degrades correctly and tells
 * nobody, which is the same shape of bug as STJ reading `no_data`.
 */
describe('poll timing warnings', () => {
  function slowClient(delayMs: number): InfluxClient {
    return {
      configured: true,
      async query<T>(): Promise<T[]> {
        await new Promise((r) => setTimeout(r, delayMs));
        return [] as T[];
      },
    } as InfluxClient;
  }

  function recorder() {
    const warns: { obj: Record<string, unknown>; msg: string }[] = [];
    return {
      warns,
      info: () => {},
      warn: (obj: object, msg?: string) => warns.push({ obj: obj as never, msg: msg ?? '' }),
    };
  }

  it('says so when a poll outruns its interval and costs a tick', async () => {
    const log = recorder();
    const poller = createSnapshotPoller({
      client: slowClient(120),
      intervalMs: 40, // ticks arrive while the 120 ms poll is still running
      plantCodes: [],
      log,
    });

    await poller.start();
    await new Promise((r) => setTimeout(r, 300));
    poller.stop();

    const skipped = log.warns.find((w) => w.msg.includes('outran its interval'));
    expect(skipped).toBeDefined();
    expect(skipped!.obj.ticksSkipped as number).toBeGreaterThan(0);
    expect(skipped!.obj.tookMs as number).toBeGreaterThanOrEqual(120);
  });

  it('stays quiet while polls are comfortably inside the interval', async () => {
    const log = recorder();
    const poller = createSnapshotPoller({
      client: slowClient(1),
      intervalMs: 400,
      plantCodes: [],
      log,
    });

    await poller.start();
    await new Promise((r) => setTimeout(r, 250));
    poller.stop();

    // A healthy poller must not cry wolf, or the warning above stops meaning
    // anything the first time it fires for real.
    expect(log.warns.filter((w) => w.msg.includes('poll'))).toHaveLength(0);
  });
});
