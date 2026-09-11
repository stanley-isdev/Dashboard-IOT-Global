import { describe, expect, it } from 'vitest';
import {
  chunkWindow,
  everSeenWindows,
  plantEverSeenInSql,
  latestMachineStatusInSql,
  machineHourOaInSql,
  machineOaInSql,
  machineOaSql,
  MAX_WINDOW_HOURS,
  NARROW_WINDOW_HOURS,
  type MachineOaRow,
  type LatestMachineStatusRow,
  type Window,
} from '../src/influx/queries.ts';
import {
  createWindowStore,
  describeGaps,
  mergeLatestStatus,
  mergeOaGroups,
  RANGE_HOURS,
  resolveWindow,
  type WindowStore,
} from '../src/services/windowedSnapshot.ts';
import { COMPANIES } from '../src/config/masterData.ts';
import type { InfluxClient } from '../src/influx/client.ts';

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
   * Regression for the 2026-09-10 break: `isDefault` used to compare
   * `RANGE_HOURS[request.range]` against `OA_WINDOW_HOURS`, which only ever
   * held because both happened to equal 24. A site whose %OA window is wider
   * than the default range broke that equality for the ONE range value the
   * fast path exists for - the front end's own default - and every ordinary
   * page load would then have missed it: an extra `windows.get` round trip
   * per request, and that request's %OA recomputed over a window other than
   * the one the poller already holds. ASI is such a site (3 days, confirmed
   * against IOT), so the invariant is live, not hypothetical.
   */
  it("keeps the default fast path even though a site's %OA window is wider", () => {
    const wider = COMPANIES.filter((c) => c.oaWindowHours > RANGE_HOURS['24h']);
    expect(wider.map((c) => c.code)).toContain('ASI');
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

/**
 * %OA's window belongs to the SITE, because each production board sums its own
 * `TotalOutput_Per_PO` over its own interval: THS's reads a day, ASI's reads
 * three (confirmed against IOT, 2026-09-10). One global constant cannot be
 * both, and setting it to ASI's for a few hours that day is what put THS 6332
 * machine `P1I8` at 294 pieces against its own board's 43.
 */
describe('machineOaSql - one window per site, in one statement', () => {
  it('emits a single plain SELECT when every site reads the same window', () => {
    const sql = machineOaSql(24);
    expect(sql).not.toContain('UNION ALL');
    expect(sql).toContain("now() - INTERVAL '24 hours'");
    // No plant predicate to write when there is nothing to tell apart.
    expect(sql).not.toContain('"plant" IN');
  });

  it('gives the named plants their own window and everyone else the default', () => {
    const sql = machineOaSql({
      defaultHours: 24,
      overrides: [{ plants: ['6051'], hours: 71 }],
    });

    const [asi, rest] = sql.split('\nUNION ALL\n');
    expect(rest).toBeDefined();

    // ASI's branch: its plants, its 3-day window.
    expect(asi).toContain(`"plant" IN ('6051')`);
    expect(asi).toContain("now() - INTERVAL '71 hours'");

    // Everyone else's: explicitly NOT those plants, and the default window.
    // `IS NULL` too, or three-valued logic drops a row with no plant here
    // instead of at `foldMachineOa`, where the rule for it actually lives.
    expect(rest).toContain(`"plant" NOT IN ('6051')`);
    expect(rest).toContain(`"plant" IS NULL`);
    expect(rest).toContain("now() - INTERVAL '24 hours'");
    expect(rest).not.toContain("INTERVAL '71 hours'");
  });

  it('refuses a window wider than one query may scan', () => {
    expect(() =>
      machineOaSql({ defaultHours: 24, overrides: [{ plants: ['6051'], hours: 96 }] }),
    ).toThrow(/MAX_WINDOW_HOURS|1\.\.71/);
  });

  it('ignores an override that names no plants', () => {
    const sql = machineOaSql({ defaultHours: 24, overrides: [{ plants: [], hours: 71 }] });
    expect(sql).not.toContain('UNION ALL');
    expect(sql).toContain("now() - INTERVAL '24 hours'");
  });
});

/**
 * What a refused chunk costs.
 *
 * `MAX_WINDOW_HOURS` is the width of the FIRST attempt and not a width the
 * instance always honours - the cap counts Parquet files and the newest days
 * are held in many small ones, so the same 71 h that answers over mid-August is
 * refused over the start of September (queries.ts records the measurement).
 *
 * The claim here is that such a chunk costs its own hours and nothing more.
 * Before this, the first rejection threw and the route emptied the census: a
 * month-wide pick came back as nine offline sites and a row of zeros while nine
 * of its ten chunks had answered perfectly well.
 */
describe('a window whose chunks the instance refuses', () => {
  /** 168 h - three chunks at the first-attempt width. */
  const WEEK = { from: '2026-08-27T05:00:00.000Z', to: '2026-09-03T05:00:00.000Z' };
  const FILE_CAP =
    'InfluxDB returned HTTP 500: External error: Query would scan 432 Parquet files, ' +
    'exceeding the file limit.';

  /** The window a query is bounded by, read back off its own SQL. */
  function boundsOf(sql: string): Window {
    const stamps = [...sql.matchAll(/timestamp '([^']+)'/g)].map((m) => m[1]!);
    return { from: stamps[0]!, to: stamps[1]! };
  }

  const overlaps = (a: Window, b: Window) =>
    Date.parse(a.from) < Date.parse(b.to) && Date.parse(b.from) < Date.parse(a.to);

  /**
   * A client that refuses any query overlapping `dead`, and answers every other
   * one with a single machine row stamped with the window it was asked for - so
   * the assembled snapshot says which slices actually contributed.
   */
  function clientRefusing(dead: Window | null) {
    const asked: Window[] = [];
    const client: InfluxClient = {
      configured: true,
      async query<T>(sql: string): Promise<T[]> {
        const w = boundsOf(sql);
        asked.push(w);
        if (dead && overlaps(w, dead)) throw new Error(FILE_CAP);
        // Only the census family carries rows here; the %OA and trend families
        // fold empty without complaint and are not what these tests are about.
        if (!sql.includes('status_start_time')) return [] as T[];
        return [
          {
            plant: '6332',
            machine: `M@${w.from}`,
            process: 'Injection',
            zone: 'A',
            result: 'Mass Pro',
            last_seen: w.from,
            status_start_time: Date.parse(w.from),
          } satisfies LatestMachineStatusRow as unknown as T,
        ];
      },
    };
    return { client, asked };
  }

  const machinesOf = (snap: Awaited<ReturnType<WindowStore['get']>>) =>
    (snap.machines['6332'] ?? []).map((m) => m.machine.replace('M@', '')).sort();

  it('retries a refused chunk in narrower slices rather than losing the window', async () => {
    // Refuses the middle chunk outright, and every slice of it as well.
    const middle = chunkWindow(WEEK)[1]!;
    const { client, asked } = clientRefusing(middle);
    const store = createWindowStore({ client });

    // The middle chunk is unreadable at ANY width here, so this is the gap
    // case; the retry itself is asserted by what was asked for.
    const snap = await store.get(WEEK);
    const slices = chunkWindow(middle, NARROW_WINDOW_HOURS);
    expect(slices.length).toBeGreaterThan(1);

    for (const s of slices) {
      expect(asked.some((w) => w.from === s.from && w.to === s.to)).toBe(true);
    }
    // The two chunks that were never refused still answered.
    expect(machinesOf(snap)).toEqual([chunkWindow(WEEK)[0]!.from, chunkWindow(WEEK)[2]!.from]);
  });

  it('serves the hours it could read and records only the ones it could not', async () => {
    /* One hour inside the middle chunk's SECOND slice. The wide attempt fails,
       and of the three slices it splits into only that one does. */
    const dead = { from: '2026-08-31T05:00:00.000Z', to: '2026-08-31T06:00:00.000Z' };
    const { client } = clientRefusing(dead);
    const snap = await createWindowStore({ client }).get(WEEK);

    const slices = chunkWindow(chunkWindow(WEEK)[1]!, NARROW_WINDOW_HOURS);
    const lost = slices.filter((s) => overlaps(s, dead));
    expect(lost).toHaveLength(1);

    expect(snap.gaps).toEqual([{ from: lost[0]!.from, to: lost[0]!.to, error: FILE_CAP }]);
    /* Four of the five queries answered, and their rows are all here: the point
       of the change is that one dense day does not cost the other six. */
    expect(machinesOf(snap)).toHaveLength(4);
    expect(machinesOf(snap)).not.toContain(lost[0]!.from);
    // The read succeeded - the window is served, with a hole the envelope names.
    expect(snap.ok).toBe(true);
  });

  it('reports what the window actually cost, retries included', async () => {
    const dead = { from: '2026-08-31T05:00:00.000Z', to: '2026-08-31T06:00:00.000Z' };
    const { client } = clientRefusing(dead);
    const snap = await createWindowStore({ client }).get(WEEK);

    /* Three chunks planned; the middle one was refused and split into three
       slices. Six queries per family - the refused attempt included, because it
       cost the instance a scan too - where `resolveWindow` promised three. */
    expect(snap.chunksQueried).toBe(6);
  });

  it('still fails when no chunk of the window could be read', async () => {
    const { client } = clientRefusing(WEEK);
    await expect(createWindowStore({ client }).get(WEEK)).rejects.toThrow(/Parquet files/);
  });

  /**
   * A chunk already at the retry width has nothing to narrow to, and sending
   * the same query again would cost a second rejection to learn nothing.
   */
  it('does not retry a chunk that is already one slice wide', async () => {
    const day = { from: '2026-09-02T05:00:00.000Z', to: '2026-09-03T05:00:00.000Z' };
    const { client, asked } = clientRefusing(day);
    await expect(createWindowStore({ client }).get(day)).rejects.toThrow(/Parquet files/);
    // One attempt per family, no more.
    expect(asked).toHaveLength(3);
  });
});

describe('describeGaps', () => {
  it('says nothing when the window came back whole', () => {
    expect(describeGaps([])).toBeNull();
  });

  /* Named rather than counted: a reader deciding whether to trust a month-wide
     average has to know WHICH hours are not in it - "3 slices missing" cannot
     be checked against anything, where a pair of instants can be re-queried. */
  it('names the hours that are missing, and what InfluxDB said', () => {
    const said = describeGaps([
      { from: '2026-08-31T04:00:00.000Z', to: '2026-09-01T04:00:00.000Z', error: 'file limit' },
    ]);
    expect(said).toContain('2026-08-31T04:00:00.000Z .. 2026-09-01T04:00:00.000Z');
    expect(said).toContain('file limit');
    expect(said).toContain('NOT in these');
  });
});

describe('everSeenWindows - Q-09 slicing', () => {
  const NOW = Date.parse('2026-09-08T12:00:00.000Z');

  it('covers the whole horizon and no more', () => {
    const slices = everSeenWindows(NOW, 30, 24);
    const earliest = Math.min(...slices.map((w) => Date.parse(w.from)));
    const latest = Math.max(...slices.map((w) => Date.parse(w.to)));
    expect(latest).toBe(NOW);
    expect(earliest).toBe(NOW - 30 * 24 * 3_600_000);
  });

  it('hands slices out newest first, so a live plant hits on the first one', () => {
    // The ordering IS the optimisation: measured 2026-09-08, a reporting plant
    // costs one query (74 ms) rather than a 30-slice crawl.
    const slices = everSeenWindows(NOW, 30, 24);
    expect(Date.parse(slices[0]!.to)).toBe(NOW);
    for (let i = 1; i < slices.length; i++) {
      expect(Date.parse(slices[i]!.to)).toBeLessThanOrEqual(Date.parse(slices[i - 1]!.from));
    }
  });

  it('keeps every slice inside the instance file cap', () => {
    // Measured: 72 h answers, 84 h is refused outright with "would scan 432
    // Parquet files". A slice wider than the cap makes every probe fail.
    for (const w of everSeenWindows(NOW, 30, 24)) {
      expect(Date.parse(w.to) - Date.parse(w.from)).toBeLessThanOrEqual(72 * 3_600_000);
    }
  });

  it('rejects nonsense rather than silently probing the wrong range', () => {
    expect(() => everSeenWindows(NOW, 0, 24)).toThrow(/horizonDays/);
    expect(() => everSeenWindows(NOW, 30, 0)).toThrow(/sliceHours/);
  });

  it('builds a single-plant existence probe bounded to the slice', () => {
    const sql = plantEverSeenInSql('STJ-1', {
      from: '2026-09-07T12:00:00.000Z',
      to: '2026-09-08T12:00:00.000Z',
    });
    expect(sql).toContain(`"plant" = 'STJ-1'`);
    expect(sql).toContain('LIMIT 1');
    expect(sql).toContain('ORDER BY "time" DESC');
    // No Result predicate: any row at all proves the plant reached us.
    expect(sql).not.toContain('Result');
  });
});
