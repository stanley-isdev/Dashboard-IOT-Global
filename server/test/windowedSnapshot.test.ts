import { describe, expect, it } from 'vitest';
import {
  chunkWindow,
  latestMachineStatusInSql,
  machineHourOaInSql,
  machineOaInSql,
  MAX_WINDOW_HOURS,
  type MachineOaRow,
  type LatestMachineStatusRow,
} from '../src/influx/queries.ts';
import {
  mergeLatestStatus,
  mergeOaGroups,
  resolveWindow,
} from '../src/services/windowedSnapshot.ts';

/**
 * The window machinery, which exists because one InfluxDB query on this
 * instance cannot scan more than ~71 h of `production_machine_status` before
 * the file-scan cap rejects it.
 *
 * The claim these tests have to hold up is not "chunking runs" - it is that
 * chunking is EXACT: three queries over a week must produce what one query
 * would have produced if the instance could run it. If that is not true then
 * this is not a way of working within the cap, it is a way of blurring it, and
 * a board built on it would report numbers nobody can reconcile.
 */

const HOUR = 3_600_000;
const TZ = 'Asia/Bangkok';
/** 2026-09-03T05:00:00Z = 12:00 in Bangkok, mid-afternoon, mid-shift. */
const NOW = new Date('2026-09-03T05:00:00.000Z');
/** 28 days of retention, as the route derives it. */
const EARLIEST = '2026-08-06';

describe('chunkWindow', () => {
  it('leaves a window inside the cap as a single query', () => {
    const w = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' };
    expect(chunkWindow(w)).toEqual([w]);
  });

  it('splits a week into pieces that each stay under the cap', () => {
    const chunks = chunkWindow({
      from: '2026-08-27T05:00:00.000Z',
      to: '2026-09-03T05:00:00.000Z',
    });
    expect(chunks.length).toBe(3);
    for (const c of chunks) {
      const hours = (Date.parse(c.to) - Date.parse(c.from)) / HOUR;
      expect(hours).toBeGreaterThan(0);
      expect(hours).toBeLessThanOrEqual(MAX_WINDOW_HOURS);
    }
  });

  it('tiles the window exactly - no gap, no overlap, no lost hour', () => {
    const w = { from: '2026-08-20T13:37:00.000Z', to: '2026-09-03T05:00:00.000Z' };
    const chunks = chunkWindow(w);
    expect(chunks[0].from).toBe(w.from);
    expect(chunks[chunks.length - 1].to).toBe(w.to);
    for (let i = 1; i < chunks.length; i++) {
      // Half-open [from, to): each chunk starts exactly where the last ended.
      // A gap loses rows; an overlap counts the %OA sums twice.
      expect(chunks[i].from).toBe(chunks[i - 1].to);
    }
  });

  /**
   * The property the trend depends on. `date_bin(INTERVAL '1 hour', time)` bins
   * to absolute clock hours, so a cut inside one would split that bucket across
   * two queries and the concatenated result would carry the same hour twice,
   * each holding half its rows.
   */
  it('cuts only on whole hours, so no hourly bucket straddles two chunks', () => {
    const chunks = chunkWindow({
      from: '2026-08-20T13:37:00.000Z',
      to: '2026-09-03T05:42:00.000Z',
    });
    // Every internal boundary - not the outer ends, which are the caller's.
    for (let i = 1; i < chunks.length; i++) {
      expect(Date.parse(chunks[i].from) % HOUR).toBe(0);
    }
  });

  it('never returns an empty plan, even for a zero-width window', () => {
    const w = { from: '2026-09-03T05:00:00.000Z', to: '2026-09-03T05:00:00.000Z' };
    expect(chunkWindow(w).length).toBe(1);
  });
});

describe('resolveWindow', () => {
  const base = { now: NOW, timeZone: TZ, earliestDate: EARLIEST };

  it('anchors a quick range at now', () => {
    const r = resolveWindow({ ...base, request: { range: '8h' } });
    expect(r.served.source).toBe('range');
    expect(r.served.hours).toBe(8);
    expect(r.served.to).toBe(NOW.toISOString());
    expect(r.served.clamped).toBe(false);
  });

  it('serves the default 24h window straight from the poller', () => {
    expect(resolveWindow({ ...base, request: { range: '24h' } }).isDefault).toBe(true);
  });

  /**
   * 7d is 168 h - well past what one query can scan, and the reason it was
   * cosmetic until this existed.
   */
  it('assembles 7d out of three queries rather than refusing it', () => {
    const r = resolveWindow({ ...base, request: { range: '7d' } });
    expect(r.isDefault).toBe(false);
    expect(r.served.hours).toBe(168);
    expect(r.served.chunks).toBe(3);
  });

  it('reads the picked days in the reference zone, not the server clock', () => {
    const r = resolveWindow({
      ...base,
      request: { range: '24h', from: '2026-09-01', to: '2026-09-01' },
    });
    // Bangkok is UTC+7, so 1 Sep 00:00 local is 31 Aug 17:00Z.
    expect(r.served.from).toBe('2026-08-31T17:00:00.000Z');
    expect(r.served.source).toBe('absolute');
  });

  /** "1 Aug to 3 Aug" means three days, not two - the end day is inclusive. */
  it('treats the end day as inclusive', () => {
    const r = resolveWindow({
      ...base,
      request: { range: '24h', from: '2026-08-20', to: '2026-08-22' },
    });
    expect(r.served.hours).toBe(72);
  });

  it('never serves an absolute window out of the poller, even a 24h-wide one', () => {
    const r = resolveWindow({
      ...base,
      request: { range: '24h', from: '2026-08-20', to: '2026-08-20' },
    });
    // 24 h wide, but it ends at midnight rather than at `now`. Answering it from
    // the snapshot would answer a question about 20 August with today's numbers.
    expect(r.served.hours).toBe(24);
    expect(r.isDefault).toBe(false);
  });

  it('clamps a window reaching past retention and says so', () => {
    const r = resolveWindow({
      ...base,
      request: { range: '24h', from: '2026-07-01', to: '2026-08-10' },
    });
    expect(r.served.clamped).toBe(true);
    expect(r.served.from).toBe('2026-08-05T17:00:00.000Z'); // 6 Aug 00:00 Bangkok
    expect(r.rejection).toBeNull();
  });

  it('clips the end at now rather than reading hours that have not happened', () => {
    const r = resolveWindow({
      ...base,
      request: { range: '24h', from: '2026-09-02', to: '2026-12-31' },
    });
    expect(r.served.to).toBe(NOW.toISOString());
  });

  /**
   * A pick wholly in the future is not clamped into something - it is refused,
   * and the board falls back to the quick range with the reason on the
   * envelope. Silently showing the last 24 h under next week's dates is the
   * failure this endpoint is written against.
   */
  it('rejects a window that is entirely in the future, naming why', () => {
    const r = resolveWindow({
      ...base,
      request: { range: '8h', from: '2026-12-01', to: '2026-12-31' },
    });
    expect(r.served.source).toBe('range');
    expect(r.served.hours).toBe(8);
    expect(r.rejection).toMatch(/have not worked yet/);
  });

  it('ignores a half-set pair rather than inventing the other end', () => {
    const r = resolveWindow({ ...base, request: { range: '8h', from: '2026-09-01', to: null } });
    expect(r.served.source).toBe('range');
    expect(r.rejection).toBeNull();
  });

  it('bounds a hostile pick at the assembled ceiling', () => {
    const r = resolveWindow({
      ...base,
      request: { range: '24h', from: '2020-01-01', to: '2026-09-03' },
      maxAssembledHours: 48,
    });
    expect(r.served.hours).toBeLessThanOrEqual(48);
    expect(r.served.clamped).toBe(true);
  });
});

/* ------------------------------------------------------------- the merges */

const statusRow = (
  plant: string,
  machine: string,
  result: string,
  lastSeen: string,
): LatestMachineStatusRow => ({
  plant,
  machine,
  process: 'Injection',
  zone: 'A',
  result,
  last_seen: lastSeen,
  status_start_time: null,
});

describe('mergeLatestStatus', () => {
  it('keeps one row per machine - the newest across every chunk', () => {
    const merged = mergeLatestStatus([
      statusRow('6332', 'I1', 'Stop', '2026-09-01T00:00:00Z'),
      statusRow('6332', 'I1', 'Mass Pro', '2026-09-03T00:00:00Z'),
      statusRow('6332', 'I1', 'Dandori', '2026-09-02T00:00:00Z'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].result).toBe('Mass Pro');
  });

  /**
   * Concatenating instead would hand `foldRows` three rows for one machine and
   * inflate the plant's `machineCount` by the chunk count - a census that grows
   * because the reader widened the window.
   */
  it('does not inflate the census when a machine appears in every chunk', () => {
    const rows = ['2026-09-01', '2026-09-02', '2026-09-03'].flatMap((d) => [
      statusRow('6332', 'I1', 'Mass Pro', `${d}T00:00:00Z`),
      statusRow('6332', 'I2', 'Stop', `${d}T00:00:00Z`),
    ]);
    expect(mergeLatestStatus(rows)).toHaveLength(2);
  });

  it('keeps machines of the same name at different plants apart', () => {
    const merged = mergeLatestStatus([
      statusRow('6332', 'I1', 'Mass Pro', '2026-09-03T00:00:00Z'),
      statusRow('6051', 'I1', 'Stop', '2026-09-01T00:00:00Z'),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('drops a row that cannot be attributed to a site', () => {
    expect(mergeLatestStatus([statusRow('', 'I1', 'Stop', '2026-09-01T00:00:00Z')])).toHaveLength(0);
  });
});

const oaRow = (over: Partial<MachineOaRow> = {}): MachineOaRow => ({
  plant: '6332',
  machine: 'I5',
  process: 'Injection',
  po0: 'PO-1',
  po1: null,
  po2: null,
  po3: null,
  min_std_time: 31,
  sum_qty: 100,
  plan0: 400,
  plan1: null,
  plan2: null,
  plan3: null,
  shot_count: 100,
  weighted_time: 3000,
  last_row: '2026-09-01T00:00:00Z',
  cd0: '2026-09-01 01:00:00',
  cd1: null,
  cd2: null,
  cd3: null,
  ...over,
});

describe('mergeOaGroups', () => {
  /**
   * The load-bearing test. Every column here re-aggregates, so the group built
   * from three chunks has to equal the row a single query would have returned.
   */
  it('re-aggregates a group split across chunks exactly', () => {
    const merged = mergeOaGroups([
      oaRow({ min_std_time: 31, sum_qty: 100, shot_count: 100, weighted_time: 3000 }),
      oaRow({ min_std_time: 28, sum_qty: 250, shot_count: 250, weighted_time: 7000 }),
      oaRow({ min_std_time: 33, sum_qty: 50, shot_count: 50, weighted_time: 1500 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].min_std_time).toBe(28); // MIN of MINs
    expect(merged[0].sum_qty).toBe(400); // SUM of SUMs
    expect(merged[0].shot_count).toBe(400);
    expect(merged[0].weighted_time).toBe(11500);
  });

  /**
   * `plan_qty` is an attribute of the ORDER repeated onto every shot row, not a
   * per-shot increment. Summing it across chunks would report a plan of 400 as
   * 1,200 and drive the achievement card to a third of the truth.
   */
  it('takes MAX of the plan, never the sum', () => {
    const merged = mergeOaGroups([oaRow(), oaRow(), oaRow()]);
    expect(merged[0].plan0).toBe(400);
  });

  it('keeps the newest last_row, which identifies the order running now', () => {
    const merged = mergeOaGroups([
      oaRow({ last_row: '2026-09-01T00:00:00Z' }),
      oaRow({ last_row: '2026-09-03T00:00:00Z' }),
      oaRow({ last_row: '2026-09-02T00:00:00Z' }),
    ]);
    expect(merged[0].last_row).toBe('2026-09-03T00:00:00Z');
  });

  it('keeps different order groups on one machine apart', () => {
    const merged = mergeOaGroups([oaRow({ po0: 'PO-1' }), oaRow({ po0: 'PO-2' })]);
    expect(merged).toHaveLength(2);
  });

  /**
   * A chunk that contributed no rows for a column leaves `null` there, and
   * `null` is not zero: folding it as zero would collapse MIN(std_time) to 0
   * and take the machine's whole %OA with it.
   */
  it('treats a null contribution as absent rather than as zero', () => {
    const merged = mergeOaGroups([
      oaRow({ min_std_time: 31, sum_qty: 100 }),
      oaRow({ min_std_time: null, sum_qty: null }),
    ]);
    expect(merged[0].min_std_time).toBe(31);
    expect(merged[0].sum_qty).toBe(100);
  });
});

describe('the bounded SQL builders', () => {
  const w = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' };

  /* The gotcha that fails silently: DataFusion lower-cases unquoted mixed-case
     identifiers and InfluxDB answers HTTP 500 with an empty body. */
  it('quote every mixed-case identifier', () => {
    for (const sql of [latestMachineStatusInSql(w), machineOaInSql(w), machineHourOaInSql(w)]) {
      expect(sql).not.toMatch(/(?<!")\bResult\b(?!")/);
      expect(sql).not.toMatch(/(?<!")\bProductionOrder0\b(?!")/);
      expect(sql).toContain('"time"');
    }
  });

  it('bound both ends, so chunks cannot overlap', () => {
    const sql = machineOaInSql(w);
    expect(sql).toContain(`timestamp '${w.from}'`);
    expect(sql).toContain(`timestamp '${w.to}'`);
    expect(sql).toContain('>=');
    expect(sql).toContain('<');
    // No `now()` anywhere: a bounded chunk must not drift with the clock
    // between the three queries that make up one window.
    expect(sql).not.toContain('now()');
  });
});
