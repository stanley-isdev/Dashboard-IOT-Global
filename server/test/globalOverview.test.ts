import { describe, expect, it } from 'vitest';
import { zGlobalOverview, type MachineStatus } from '@dashboard/contract';
import { checkGlobalOverview } from '@dashboard/domain-shared';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';
import { buildGlobalOverview } from '../src/services/globalOverviewService.ts';
import type { MachineOa } from '../src/domain/oa.ts';
import type { MachineHourOa } from '../src/domain/trend.ts';
import type { LiveSnapshot } from '../src/services/liveSnapshot.ts';

const ENV = loadEnv({ CORS_ORIGIN: 'http://localhost:5173' });

/**
 * Influx credentials present, so source health reports on the *connection*
 * rather than short-circuiting to "not configured". Nothing here dials out:
 * these tests call buildGlobalOverview directly with a synthetic snapshot.
 */
const ENV_WITH_INFLUX = loadEnv({
  CORS_ORIGIN: 'http://localhost:5173',
  INFLUX_URL: 'http://influx.invalid:8181',
  INFLUX_DATABASE: 'iot_test',
  INFLUX_TOKEN: 'apiv3_test_token',
});

const NOW = new Date('2026-08-25T02:00:00.000Z');
const FILTERS = { range: '24h', process: 'Injection', region: 'all', plant: 'all' } as const;

/**
 * A successful snapshot: each named plant was last seen `ageSec` ago, and
 * optionally reported the given machines.
 */
function snapshot(
  ages: Record<string, number>,
  machinesByPlant: Record<string, [string, MachineStatus][]> = {},
  oa: MachineOa[] = [],
  trend: MachineHourOa[] = [],
): LiveSnapshot {
  const seenAt = (ageSec: number) => new Date(NOW.getTime() - ageSec * 1000).toISOString();

  const plants = Object.fromEntries(
    Object.entries(ages).map(([plant, ageSec]) => [
      plant,
      {
        plant,
        lastSeen: seenAt(ageSec),
        machineCount: machinesByPlant[plant]?.length ?? 1,
      },
    ]),
  );

  const machines = Object.fromEntries(
    Object.entries(machinesByPlant).map(([plant, list]) => [
      plant,
      list.map(([machine, status]) => ({
        plant,
        machine,
        process: 'Injection',
        zone: null,
        status,
        lastSeen: seenAt(ages[plant] ?? 0),
      })),
    ]),
  );

  return {
    fetchedAt: NOW.toISOString(),
    lastSuccessAt: NOW.toISOString(),
    ok: true,
    error: null,
    plants,
    machines,
    unknownStatuses: [],
    oa,
    oaLastSuccessAt: NOW.toISOString(),
    oaOk: true,
    oaError: null,
    trend,
    trendLastSuccessAt: NOW.toISOString(),
    trendOk: true,
    trendError: null,
  };
}

/**
 * A machine on an order at the given %OA. `qty` only matters to the fields the
 * card shows next to the number - the %OA average itself is a plain mean (D-20).
 * `plan` is what Q-04 divides by, and defaults to absent.
 */
function onOrder(
  plant: string,
  machine: string,
  oaPct: number | null,
  qty = 100,
  plan: number | null = null,
): MachineOa {
  return {
    plant,
    machine,
    process: 'Injection',

    groupPo: `PO-${machine}`,
    oaPct,
    actualQty: qty,
    planQty: plan,
    shotCount: qty,
    poSlots: 1,
    // Inside NOW's shift, so `Order End` layer 2 keeps it. NOW is 02:00Z =
    // 09:00 Bangkok, in THS/ASI's Day shift (01:00Z-13:00Z), and these tests
    // are about the roll-up rather than about the shift rule - `orderShift`
    // tests own that. A machine dated outside the shift is exercised in
    // "excludes a machine whose order was created in an earlier shift".
    createdRaw: ['2026-08-25 01:30:00'],
    gap: null,
  };
}

/** A machine with no order loaded: the board prints 0.0%, the contract says null. */
function idle(plant: string, machine: string): MachineOa {
  return {
    plant,
    machine,
    process: 'Injection',

    groupPo: null,
    oaPct: null,
    actualQty: null,
    planQty: null,
    shotCount: null,
    poSlots: 0,
    createdRaw: [],
    gap: null,
  };
}

const build = (snap: LiveSnapshot) =>
  buildGlobalOverview({ snapshot: snap, filters: FILTERS, env: ENV, now: NOW });

const buildConnected = (snap: LiveSnapshot) =>
  buildGlobalOverview({ snapshot: snap, filters: FILTERS, env: ENV_WITH_INFLUX, now: NOW });

describe('buildGlobalOverview - phase 1 liveness', () => {
  it('satisfies the contract and every data-integrity invariant', () => {
    // 6332 fresh, 6338 gone quiet, 6051 fresh. 6337/6321/STJ-1 never seen.
    const payload = build(snapshot({ '6332': 10, '6338': 400, '6051': 5 }));

    expect(() => zGlobalOverview.parse(payload)).not.toThrow();
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('maps plant liveness onto the four distinct site states', () => {
    const payload = build(snapshot({ '6332': 10, '6338': 400, '6051': 5 }));
    const ths = payload.companies.find((c) => c.code === 'THS')!;
    const plant = (code: string) => ths.plants.find((p) => p.code === code)!;

    expect(plant('6332').status).toBe('online'); // fresh
    expect(plant('6338').status).toBe('stale'); // quiet past stale_after_sec
    expect(plant('6337').status).toBe('no_data'); // never seen in the window
    expect(plant('6321').status).toBe('no_data');

    // Some plants report, some do not - the case `degraded` exists for.
    expect(ths.status).toBe('degraded');

    // A single-plant company that is fully reporting is plainly online.
    expect(payload.companies.find((c) => c.code === 'ASI')!.status).toBe('online');
  });

  it('keeps last_seen on a stale plant - that is what separates quiet from dead', () => {
    const payload = build(snapshot({ '6338': 400 }));
    const stale = payload.companies
      .find((c) => c.code === 'THS')!
      .plants.find((p) => p.code === '6338')!;

    expect(stale.status).toBe('stale');
    expect(stale.last_seen).toBe(new Date(NOW.getTime() - 400_000).toISOString());
  });

  it('never attributes telemetry to a site with no gateway', () => {
    const payload = build(snapshot({ '6332': 10 }));
    for (const c of payload.companies.filter((x) => x.data_readiness !== 'live')) {
      expect(c.status).toBe('not_connected');
      expect(c.last_seen).toBeNull();
      expect(c.counts.total).toBe(0);
      expect(c.kpi.oa_pct).toBeNull();
    }
  });

  it('reports STJ as no_data rather than live, because this instance has none of its data', () => {
    // BACKEND-HANDOVER §4.3b: STJ is master-data `live` but absent from this
    // InfluxDB entirely. Claiming `online` from config alone would be the
    // fabrication the project exists to prevent.
    const stj = build(snapshot({ '6332': 10 })).companies.find((c) => c.code === 'STJ')!;
    expect(stj.data_readiness).toBe('live');
    expect(stj.status).toBe('no_data');
    expect(stj.last_seen).toBeNull();
  });

  it('rolls the machine census plant -> company -> global', () => {
    const payload = build(
      snapshot(
        { '6332': 10, '6051': 5 },
        {
          '6332': [
            ['I1', 'Mass Pro'],
            ['I2', 'Stop'],
          ],
          '6051': [
            ['M-IS-01', 'Mass Pro'],
            ['M-IS-02', 'Dandori'],
          ],
        },
      ),
    );

    const ths = payload.companies.find((c) => c.code === 'THS')!;
    const p6332 = ths.plants.find((p) => p.code === '6332')!;

    // Only what InfluxDB confirmed. masterData claims 10 machines here; that
    // number never reaches the census any more.
    expect(p6332.counts.total).toBe(2);
    expect(p6332.counts.running).toBe(1);
    expect(p6332.counts.stopped).toBe(1);
    expect(p6332.counts.no_data).toBe(0);

    // THS's other three plants heard nothing, so they contribute nothing.
    expect(ths.counts.total).toBe(2);
    expect(ths.counts.running).toBe(1);

    // Global totals sum the reporting companies only.
    const asi = payload.companies.find((c) => c.code === 'ASI')!;
    expect(payload.totals.counts.total).toBe(ths.counts.total + asi.counts.total);
    // 1 THS (Mass Pro) + 2 ASI (Mass Pro and Dandori - both are running).
    expect(payload.totals.counts.running).toBe(3);
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it("keeps the board's TOTAL at every level of the roll-up", () => {
    const payload = build(
      snapshot(
        { '6332': 10, '6051': 5 },
        {
          '6332': [
            ['I1', 'Mass Pro'],
            ['I2', 'Stop'],
            ['I3', 'No Plan'],
            ['I5', 'Pending'],
            ['I6', 'Order End'],
          ],
          '6051': [['M-IS-01', 'Dandori']],
        },
      ),
    );

    const p6332 = payload.companies
      .find((c) => c.code === 'THS')!
      .plants.find((p) => p.code === '6332')!;

    // Four of five: `No Plan` and `Pending` count, as they do on the board;
    // `Order End` does not, because layer 1 emits it as an extra card.
    expect(p6332.counts.total).toBe(4);
    expect(p6332.counts.running).toBe(1);
    expect(p6332.counts.stopped).toBe(1);
    expect(p6332.counts.idle).toBe(1);
    expect(p6332.counts.other).toBe(1);

    // The buckets partition TOTAL at every level - the invariant that replaced
    // "total === running + stopped", which only ever held by coincidence.
    const partitions = (c: {
      total: number;
      running: number;
      stopped: number;
      idle: number;
      other: number;
      no_data: number;
    }) => c.running + c.stopped + c.idle + c.other + c.no_data === c.total;

    expect(partitions(payload.totals.counts)).toBe(true);
    expect(payload.totals.counts.total).toBe(5); // 4 at 6332 + 1 at 6051
    for (const co of payload.companies) {
      expect(partitions(co.counts)).toBe(true);
      for (const p of co.plants) expect(partitions(p.counts)).toBe(true);
    }

    // The one machine left out is recorded, not silently dropped.
    expect(payload.meta.warnings.join(' ')).toMatch(
      /THS\/6332: 1 of 5 reporting machines are in `Order End`/,
    );
  });

  it('gives a non-reporting company a zero census, plants included', () => {
    // STJ is master-data `live` but silent, so it is `no_data` - and the
    // `unconnected-site-contributes-nothing` invariant means neither it nor its
    // plants may carry the 18 machines master data lists.
    const payload = build(snapshot({ '6332': 10 }));
    const stj = payload.companies.find((c) => c.code === 'STJ')!;

    expect(stj.status).toBe('no_data');
    expect(stj.counts.total).toBe(0);
    expect(stj.plants.every((p) => p.counts.total === 0)).toBe(true);
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('counts a no_data plant\'s machines, and still labels it no_data', () => {
    /*
     * Reversed on 2026-08-27. This used to assert the opposite - that a plant
     * past `no_data_after_sec` (15 min) contributed nothing even while its
     * machine rows sat inside the query window - to avoid "1 running" next to
     * "No data" on one row.
     *
     * With the window at the board's 24 h that gap is hours wide, and it cost
     * real machines: THS 6338's freshest row was 310 min old, so the board
     * showed its one machine and we showed none. The board has no freshness
     * concept, so matching it means the census follows the WINDOW and the
     * freshness label travels beside it rather than erasing it.
     *
     * The row now reads "no data · 1 running", which is more than the board
     * says rather than less: the board would show the same machine with no
     * indication its plant has been quiet for five hours.
     */
    const payload = build(
      snapshot({ '6332': 10, '6338': 1200 }, { '6332': [['I1', 'Mass Pro']], '6338': [['I24', 'Dandori']] }),
    );
    const p6338 = payload.companies
      .find((c) => c.code === 'THS')!
      .plants.find((p) => p.code === '6338')!;

    expect(p6338.status).toBe('no_data');
    expect(p6338.counts.running).toBe(1);
    expect(p6338.counts.total).toBe(1);
    // The caveat is on the row, not lost: this is what stops it reading as live.
    expect(p6338.last_seen).toBe(new Date(NOW.getTime() - 1_200_000).toISOString());
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('still zeroes a company whose plants have ALL gone silent', () => {
    // The company-level gate is what keeps `unconnected-site-contributes-nothing`
    // true now that the per-plant one is gone. STJ is `live` in master data and
    // sends nothing, which is the case that invariant exists for.
    const payload = build(snapshot({ '6332': 10 }, { '6332': [['I1', 'Mass Pro']] }));
    const stj = payload.companies.find((c) => c.code === 'STJ')!;

    expect(stj.status).toBe('no_data');
    expect(stj.counts.total).toBe(0);
    expect(stj.kpi.oa_pct).toBeNull();
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('still counts a stale plant - its last numbers are real (T-11)', () => {
    const payload = build(
      snapshot({ '6332': 10, '6338': 300 }, { '6338': [['I24', 'Dandori']] }),
    );
    const p6338 = payload.companies
      .find((c) => c.code === 'THS')!
      .plants.find((p) => p.code === '6338')!;

    expect(p6338.status).toBe('stale');
    expect(p6338.counts.running).toBe(1);
    expect(p6338.counts.total).toBe(1);
  });

  it('surfaces an unrecognised status instead of folding it into a bucket', () => {
    const snap = snapshot({ '6332': 10 }, { '6332': [['I1', 'Mass Pro']] });
    snap.unknownStatuses = ['6332/I9: Rebooting'];
    expect(build(snap).meta.warnings.join(' ')).toMatch(/6332\/I9: Rebooting/);
  });

  it('counts only reporting companies in the coverage denominator', () => {
    const payload = build(snapshot({ '6332': 10, '6051': 5 }));
    const reporting = payload.companies.filter((c) =>
      ['online', 'stale', 'degraded'].includes(c.status),
    );
    expect(payload.totals.companies_reporting).toBe(reporting.length);
    expect(payload.totals.companies_total).toBe(9);
    expect(payload.totals.companies_reporting).toBeLessThan(payload.totals.companies_total);
  });

  it('leaves KPI null rather than passing zeros off as measurements', () => {
    // A plant reporting machine status but no production rows: the census is
    // real and every KPI is absent. Zeros here would read as "running flat out
    // at nought per cent", which is the defect the contract's R2 forbids.
    const payload = build(snapshot({ '6332': 10 }));
    expect(payload.totals.oa_pct).toBeNull();
    expect(payload.totals.achievement_pct).toBeNull();
    expect(payload.totals.downtime_sec).toBeNull();
    expect(payload.totals.oa_tier).toBe('unknown');
    // The chart is 24 hours wide whatever happened in them: an hour with
    // nothing on an order is `null`, so the axis stays a real timeline instead
    // of collapsing, and no hour is drawn on the floor at 0%.
    expect(payload.trend).toHaveLength(24);
    expect(payload.trend.every((p) => p.oa_pct === null && p.machine_count === 0)).toBe(true);
    expect(payload.alerts).toEqual([]);
    // %OA and %Achievement are real as of phase 3; what is left is still openly
    // unbuilt on the payload rather than filled in with zeros.
    expect(payload.meta.warnings.join(' ')).toMatch(/Downtime is still null/);
  });

  it('states on the payload which rules it follows and where it still differs', () => {
    // A consumer that never reads the source must still be able to learn from
    // the response what scope produced these numbers, and the two places they
    // deliberately part company with the board.
    const warnings = build(snapshot({ '6332': 10 })).meta.warnings.join(' ');
    expect(warnings).toMatch(/24 h window/);
    expect(warnings).toMatch(/TOTAL excludes `Order End` only/);
    // The plant card reading higher than its own drill-down needs saying.
    expect(warnings).toMatch(/Counted across ALL processes/);
    expect(warnings).toMatch(/created in an earlier shift leaves the %OA average/);
    // The two named divergences.
    expect(warnings).toMatch(/keeps its last known status instead of reading `Offline`/);
    expect(warnings).toMatch(/machineExclusions is empty by decision/);
  });

  it('reports cache_age_sec from the snapshot, not from the response time', () => {
    const snap = snapshot({ '6332': 10 });
    snap.lastSuccessAt = new Date(NOW.getTime() - 4_000).toISOString();
    expect(build(snap).meta.cache_age_sec).toBe(4);
  });

  it('keeps the last known plants when a poll fails, and marks the source degraded', () => {
    const snap = snapshot({ '6332': 10 });
    snap.ok = false;
    snap.error = 'connect ETIMEDOUT';
    // lastSuccessAt stays recent, so this is a blip on a source we still have
    // good data from - `degraded`, not the `down` of a real outage.
    const payload = buildConnected(snap);

    expect(payload.companies.find((c) => c.code === 'THS')!.plants[0]!.status).toBe('online');
    const influx = payload.meta.sources.find((s) => s.name === 'influxdb')!;
    expect(influx.status).toBe('degraded');
    expect(influx.message).toBe('connect ETIMEDOUT');
    expect(payload.meta.partial).toBe(true);
  });

  it('escalates degraded to down once the last success ages past the threshold', () => {
    const snap = snapshot({ '6332': 10 });
    snap.ok = false;
    snap.error = 'connect ETIMEDOUT';
    snap.lastSuccessAt = new Date(NOW.getTime() - 600_000).toISOString();
    expect(buildConnected(snap).meta.sources.find((s) => s.name === 'influxdb')!.status).toBe(
      'down',
    );
  });

  it('reports influx ok - and the payload not partial - on a healthy poll', () => {
    const payload = buildConnected(snapshot({ '6332': 10 }));
    const influx = payload.meta.sources.find((s) => s.name === 'influxdb')!;
    expect(influx.status).toBe('ok');
    expect(influx.last_success).toBe(NOW.toISOString());
    // MSSQL is unconfigured, so it is absent rather than pinning partial true.
    expect(payload.meta.sources).toHaveLength(1);
    expect(payload.meta.partial).toBe(false);
  });

  it('filters by region without breaking the coverage arithmetic', () => {
    const payload = buildGlobalOverview({
      snapshot: snapshot({ '6332': 10, '6051': 5 }),
      filters: { ...FILTERS, region: 'TH' },
      env: ENV,
      now: NOW,
    });
    expect(payload.companies.every((c) => c.country_code === 'TH')).toBe(true);
    expect(payload.totals.countries_total).toBe(1);
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  /*
   * The picker in the top bar is multi-select, so the parameter it writes is a
   * list: `all`, or country and company codes separated by commas. Parsing it is
   * the contract's job (region.ts) and both this service and the mock call the
   * same matcher - this asserts the endpoint honours what the URL says.
   */
  it('filters by a list of countries and companies, and counts only those', () => {
    const payload = buildGlobalOverview({
      snapshot: snapshot({ '6332': 10, '6051': 5 }),
      filters: { ...FILTERS, region: 'TH,STJ' },
      env: ENV,
      now: NOW,
    });
    expect(payload.companies.map((c) => c.code)).toEqual(['THS', 'ASI', 'STJ']);
    expect(payload.totals.companies_total).toBe(3);
    expect(payload.totals.countries_total).toBe(2);
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('serves none as an empty board - the scope the picker writes when All is tapped off', () => {
    const payload = buildGlobalOverview({
      snapshot: snapshot({ '6332': 10, '6051': 5 }),
      filters: { ...FILTERS, region: 'none' },
      env: ENV,
      now: NOW,
    });
    expect(payload.companies).toEqual([]);
    expect(payload.totals.companies_total).toBe(0);
    expect(payload.totals.counts.total).toBe(0);
    expect(payload.totals.oa_pct).toBeNull();
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('gives an unknown region an empty board rather than the whole fleet', () => {
    const payload = buildGlobalOverview({
      snapshot: snapshot({ '6332': 10 }),
      filters: { ...FILTERS, region: 'ZZ' },
      env: ENV,
      now: NOW,
    });
    expect(payload.companies).toEqual([]);
    expect(payload.totals.companies_total).toBe(0);
    expect(checkGlobalOverview(payload)).toEqual([]);
  });
});

describe('buildGlobalOverview - phase 3 %OA (Q-03)', () => {
  /** The four machines that carried an order on the board, with 6332 live. */
  const boardMachines: [string, MachineStatus][] = [
    ['IC4', 'Mass Pro'],
    ['I5', 'Stop'],
    ['IA1', 'Mass Pro'],
    ['P1I1', 'Mass Pro'],
  ];
  /*
   * The four cards, with the plans their orders carried in the live
   * `production_machine_io` rows for the same window - 220 / 400 / 309 / 816.
   * `plan_qty` is a property of the order, constant for its whole run, so it is
   * the same figure whether read at 11:45 or an hour later; the outputs are the
   * board's own.
   */
  const boardOa = [
    onOrder('6332', 'IC4', 48.9, 137, 220),
    onOrder('6332', 'I5', 47.5, 295, 400),
    onOrder('6332', 'IA1', 89.9, 71, 309),
    onOrder('6332', 'P1I1', 93, 41, 816),
  ];

  const boardSnapshot = () =>
    snapshot({ '6332': 10 }, { '6332': boardMachines }, [
      ...boardOa,
      // The other cards on that screen: running or stopped, no order loaded.
      idle('6332', 'I1'),
      idle('6332', 'I3'),
      idle('6332', 'IC6'),
    ]);

  it('excludes a machine whose order was created in an earlier shift', () => {
    /*
     * `Order End` layer 2, end to end - DESIGN.md §8.4, reconciled at THS on
     * 2026-08-27. NOW is 02:00Z = 09:00 Bangkok, so the Day shift began at
     * 01:00Z. `I5`'s order predates it by twelve hours, which is the shape of
     * the real case: `I5` and `IC5` were both on orders created 20:06 Bangkok
     * the previous night, and dropping them moved Avg %OA from 75.2% to the
     * board's 81.0%.
     *
     * The machine keeps its Stop status in the census - layer 2 only ever
     * touched the %OA figure - so this asserts both halves.
     */
    const stale = { ...onOrder('6332', 'I5', 47.5, 295, 400), createdRaw: ['2026-08-24 13:06:23'] };
    const payload = build(
      snapshot({ '6332': 10 }, { '6332': boardMachines }, [
        onOrder('6332', 'IC4', 48.9, 137, 220),
        stale,
        onOrder('6332', 'IA1', 89.9, 71, 309),
        onOrder('6332', 'P1I1', 93, 41, 816),
      ]),
    );
    const p6332 = payload.companies
      .find((c) => c.code === 'THS')!
      .plants.find((p) => p.code === '6332')!;

    // Mean of the three that remain: (48.9 + 89.9 + 93) / 3 = 77.3.
    expect(p6332.kpi.oa_pct).toBe(77.3);
    expect(p6332.kpi.oa_machine_count).toBe(3);
    // Its plan and output leave with it, so plan/actual/% still divide out.
    expect(p6332.kpi.plan_qty).toBe(220 + 309 + 816);
    expect(p6332.kpi.actual_qty).toBe(137 + 71 + 41);
    // Still counted as a machine, and still Stop.
    expect(p6332.counts.total).toBe(4);
    expect(p6332.counts.stopped).toBe(1);
    // Named, not silently removed from the denominator.
    expect(payload.meta.warnings.join(' ')).toMatch(
      /THS\/6332: 1 machine\(s\) are running an order created in an earlier shift \(I5 47\.5%\)/,
    );
  });

  it("puts the board's 69.8% on the card, at plant, company and group level", () => {
    const payload = build(boardSnapshot());
    const ths = payload.companies.find((c) => c.code === 'THS')!;

    expect(ths.plants.find((p) => p.code === '6332')!.kpi.oa_pct).toBe(69.8);
    expect(ths.kpi.oa_pct).toBe(69.8);
    // Only 6332 reports, so the group figure is the same number - and critically
    // it is a mean of MACHINES, so the six silent THS/ASI plants cannot dilute it.
    expect(payload.totals.oa_pct).toBe(69.8);
    expect(checkGlobalOverview(payload)).toEqual([]);
    expect(() => zGlobalOverview.parse(payload)).not.toThrow();
  });

  it('colours it against the served policy, not a hardcoded 95/80', () => {
    const payload = build(boardSnapshot());
    // 69.8 is under warn_at 75, so the card and the map pin both read critical.
    expect(payload.totals.oa_tier).toBe('critical');
    expect(payload.tier_policy.warn_at).toBe(75);
    expect(payload.oa_aggregation).toBe('simple_avg');
  });

  it('counts sites needing attention off the tier it resolved', () => {
    const payload = build(boardSnapshot());
    expect(payload.totals.companies_needing_attention).toBe(1);
    expect(payload.totals.plants_needing_attention).toBe(1);
  });

  it('divides the summed output by the summed plan, not the mean of the ratios', () => {
    const payload = build(boardSnapshot());
    const plant = payload.companies
      .find((c) => c.code === 'THS')!
      .plants.find((p) => p.code === '6332')!;

    expect(plant.kpi.actual_qty).toBe(544); // 137 + 295 + 71 + 41
    expect(plant.kpi.plan_qty).toBe(1745); // 220 + 400 + 309 + 816
    // 544 / 1745. The mean of the four machines' own ratios (62.3 / 73.8 / 23.0
    // / 5.0) is 41.0% - it gives P1I1's 816-piece order the same say as IC4's
    // 220-piece one, and it contradicts the plan and actual on the same card.
    expect(plant.kpi.achievement_pct).toBe(31.2);
    // Still unbuilt, and still not a zero.
    expect(plant.kpi.downtime_sec).toBeNull();
  });

  it('carries the ratio unchanged up to company and group level', () => {
    // Only 6332 has orders loaded, so all three levels are the same fraction -
    // which is the point: a company is Σplan/Σactual over its MACHINES, never a
    // mean of its plants' percentages.
    const payload = build(boardSnapshot());
    const ths = payload.companies.find((c) => c.code === 'THS')!;

    expect(ths.kpi.achievement_pct).toBe(31.2);
    expect(payload.totals.achievement_pct).toBe(31.2);
    expect(payload.totals.plan_qty).toBe(1745);
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('says on the payload what the plan is measured against', () => {
    // The card is labelled "%Achievement" but the denominator is the loaded
    // order's lot size, not a shift target. An executive cannot be expected to
    // infer that, so the payload states it (the D-19 lesson applied to Q-04).
    const warnings = build(boardSnapshot()).meta.warnings.join(' ');
    expect(warnings).toMatch(/LOT SIZE of the order each machine has loaded now/);
    expect(warnings).toMatch(/%Achievement \(Q-04\) and the hourly trend \(Q-05\) are real/);
  });

  it('reports no plan rather than 0% when the orders carry none', () => {
    // THS 6338's whole gateway: real output, plan_qty 0 on every row. "The plan
    // is zero" and "we do not know the plan" are different claims (R2), and the
    // KPI strip already has a "no plan" state for the second one.
    const payload = build(
      snapshot({ '6338': 10 }, { '6338': [['I24', 'Mass Pro']] }, [
        onOrder('6338', 'I24', null, 313, null),
      ]),
    );
    const plant = payload.companies
      .find((c) => c.code === 'THS')!
      .plants.find((p) => p.code === '6338')!;

    expect(plant.kpi.actual_qty).toBe(313);
    expect(plant.kpi.plan_qty).toBeNull();
    expect(plant.kpi.achievement_pct).toBeNull();
  });

  it('takes the group mean over machines, not over company averages', () => {
    // One machine at 40% at ASI against three at 90% at THS. A mean of the two
    // company figures would say 65%; the mean of the four machines is 77.5%.
    const payload = build(
      snapshot(
        { '6332': 10, '6051': 5 },
        { '6332': [['I1', 'Mass Pro']], '6051': [['M-ID-01', 'Mass Pro']] },
        [
          onOrder('6332', 'A', 90),
          onOrder('6332', 'B', 90),
          onOrder('6332', 'C', 90),
          onOrder('6051', 'M-ID-01', 40),
        ],
      ),
    );
    expect(payload.totals.oa_pct).toBe(77.5);
  });

  it('leaves a machine with no standard time out instead of scoring it 0%', () => {
    // THS 6338's whole gateway looks like this. Scoring it 0% dragged the
    // company average down 9 points on a number nobody measured.
    const payload = build(
      snapshot({ '6332': 10, '6338': 10 }, { '6332': [['I5', 'Stop']], '6338': [['I24', 'Mass Pro']] }, [
        onOrder('6332', 'I5', 47.5, 295),
        { ...onOrder('6338', 'I24', null, 313), gap: 'no_std_time' },
      ]),
    );
    const ths = payload.companies.find((c) => c.code === 'THS')!;

    expect(ths.plants.find((p) => p.code === '6338')!.kpi.oa_pct).toBeNull();
    expect(ths.kpi.oa_pct).toBe(47.5);
    expect(payload.meta.warnings.some((w) => w.includes('I24') && w.includes('std_time = 0'))).toBe(
      true,
    );
  });

  it('never reports %OA for a site that is not connected', () => {
    // The invariant the frontend also checks: a site with no telemetry cannot
    // contribute to any figure, even if stale rows for it are still in hand.
    const payload = build(snapshot({ '6332': 10 }, {}, [onOrder('STJ-1', 'X1', 88)]));
    const stj = payload.companies.find((c) => c.code === 'STJ')!;

    expect(stj.kpi.oa_pct).toBeNull();
    expect(payload.totals.oa_pct).toBeNull();
    expect(checkGlobalOverview(payload)).toEqual([]);
  });

  it('says so when the %OA query is failing while telemetry is fine', () => {
    const snap = snapshot({ '6332': 10 }, { '6332': boardMachines }, boardOa);
    snap.oaOk = false;
    snap.oaError = 'InfluxDB returned HTTP 500 with an empty body';

    const payload = buildGlobalOverview({
      snapshot: snap,
      filters: FILTERS,
      env: ENV_WITH_INFLUX,
      now: NOW,
    });

    // Last known numbers stay on screen - blanking them is the bug the whole
    // contract is written against - but the source is no longer "ok".
    expect(payload.totals.oa_pct).toBe(69.8);
    expect(payload.meta.sources[0]!.status).toBe('degraded');
    expect(payload.meta.partial).toBe(true);
    expect(payload.meta.warnings.some((w) => w.includes('%OA is stale'))).toBe(true);
  });

  it('flags production from a plant master data has never heard of', () => {
    const payload = build(snapshot({ '6332': 10 }, {}, [onOrder('9999', 'Z1', 80)]));
    expect(
      payload.meta.warnings.some((w) => w.includes('9999') && w.includes('absent from master data')),
    ).toBe(true);
  });
});

describe('buildGlobalOverview - phase 4 hourly trend (Q-05)', () => {
  /** One machine-hour, `h` whole hours before NOW's hour. */
  function machineHour(
    plant: string,
    machine: string,
    hoursAgo: number,
    oaPct: number | null,
  ): MachineHourOa {
    const ts = new Date(NOW.getTime());
    ts.setUTCMinutes(0, 0, 0);
    return {
      ts: new Date(ts.getTime() - hoursAgo * 3_600_000).toISOString(),
      plant,
      machine,
      oaPct,
      poSlots: 1,
    };
  }

  it('draws 24 hourly points, oldest first, ending at the hour in progress', () => {
    const payload = build(
      snapshot({ '6332': 10 }, {}, [], [machineHour('6332', 'I5', 0, 80)]),
    );
    expect(payload.trend).toHaveLength(24);
    expect(payload.trend[23]!.ts).toBe('2026-08-25T02:00:00.000Z');
    expect(payload.trend[23]!.oa_pct).toBe(80);
    // The 23 hours before it had nothing on an order - a gap, never a zero (R2).
    expect(payload.trend[0]!.oa_pct).toBeNull();
  });

  it('averages an hour the same way the card averages the day: a plain mean', () => {
    const payload = build(
      snapshot(
        { '6332': 10 },
        {},
        [],
        [
          machineHour('6332', 'A', 0, 40),
          machineHour('6332', 'B', 0, 60),
          machineHour('6332', 'C', 0, 110),
        ],
      ),
    );
    expect(payload.trend[23]!.oa_pct).toBe(70);
    expect(payload.trend[23]!.machine_count).toBe(3);
  });

  it('carries the denominator on every point, because it moves hour to hour', () => {
    const payload = build(
      snapshot(
        { '6332': 10 },
        {},
        [],
        [
          machineHour('6332', 'A', 0, 90),
          machineHour('6332', 'B', 0, 90),
          machineHour('6332', 'A', 1, 90),
        ],
      ),
    );
    expect(payload.trend[23]!.machine_count).toBe(2);
    expect(payload.trend[22]!.machine_count).toBe(1);
    // Both hours read 90%, and only `machine_count` says one of them is half
    // the measurement - which is why it is on the payload rather than inferred.
    expect(payload.trend[22]!.oa_pct).toBe(payload.trend[23]!.oa_pct);
  });

  it('counts sites, so a company joining the chart is visible as a denominator change', () => {
    const payload = build(
      snapshot(
        { '6332': 10, '6337': 10, '6051': 10 },
        {},
        [],
        [
          machineHour('6332', 'A', 0, 90),
          machineHour('6337', 'B', 0, 90),
          machineHour('6051', 'C', 0, 90),
          // An hour earlier, only THS was on an order.
          machineHour('6332', 'A', 1, 90),
        ],
      ),
    );
    expect(payload.trend[23]!.site_count).toBe(2);
    expect(payload.trend[22]!.site_count).toBe(1);
  });

  it('does not chart a plant that has aged into no_data', () => {
    // 20 min silent, past `no_data_after_sec` (900). Its KPI card is already
    // blanked; its history must go with it rather than keep drawing a line.
    const payload = build(
      snapshot({ '6332': 1200 }, {}, [], [machineHour('6332', 'I5', 0, 80)]),
    );
    expect(payload.trend.every((p) => p.oa_pct === null)).toBe(true);
  });

  it('leaves the chart out of the region the filter excluded', () => {
    const payload = buildGlobalOverview({
      snapshot: snapshot({ '6332': 10 }, {}, [], [machineHour('6332', 'I5', 0, 80)]),
      filters: { ...FILTERS, region: 'JP' },
      env: ENV_WITH_INFLUX,
      now: NOW,
    });
    // THS is Thai; filtering to Japan must take its hours with it, or the chart
    // would be a history of machines that are not on the screen.
    expect(payload.trend.every((p) => p.oa_pct === null)).toBe(true);
  });

  it('keeps the last known chart when the hourly query starts failing, and says so', () => {
    const base = snapshot({ '6332': 10 }, {}, [], [machineHour('6332', 'I5', 0, 80)]);
    const payload = buildGlobalOverview({
      snapshot: {
        ...base,
        trendOk: false,
        trendError: 'InfluxDB did not respond within 5000 ms',
        trendLastSuccessAt: new Date(NOW.getTime() - 90_000).toISOString(),
      },
      filters: FILTERS,
      env: ENV_WITH_INFLUX,
      now: NOW,
    });

    expect(payload.trend[23]!.oa_pct).toBe(80);
    expect(payload.meta.warnings.some((w) => w.includes('trend is stale'))).toBe(true);
    expect(payload.meta.sources[0]!.status).toBe('degraded');
  });

  it('says how wide the denominator swung when it swung far enough to matter', () => {
    const payload = build(
      snapshot(
        { '6332': 10 },
        {},
        [],
        [
          machineHour('6332', 'only', 0, 90),
          ...Array.from({ length: 8 }, (_, i) => machineHour('6332', `m${i}`, 1, 90)),
        ],
      ),
    );
    expect(payload.meta.warnings.some((w) => w.includes('swings from 1 to 8'))).toBe(true);
  });
});

describe('GET /api/v1/global-overview', () => {
  it('serves a contract-valid payload with no Influx configured', async () => {
    const app = await buildApp(ENV);
    const res = await app.inject({ method: 'GET', url: '/api/v1/global-overview' });
    expect(res.statusCode).toBe(200);

    const payload = zGlobalOverview.parse(res.json());
    // Nothing configured means nothing is reporting - and it says so rather
    // than showing nine healthy pins.
    expect(payload.totals.companies_reporting).toBe(0);
    expect(payload.companies).toHaveLength(9);
    // `process: 'all'`, not `'Injection'`. No query filters by process, so
    // anything narrower here would name a scope the numbers do not have.
    expect(payload.filters_applied).toEqual({ range: '24h', process: 'all', region: 'all', plant: 'all' });

    await app.close();
  });

  it('applies the process filter rather than echoing it', async () => {
    // This used to assert the opposite - that the filter could not be applied
    // and said so. It can now, and it is what makes this board readable against
    // the Injection-scoped plant board: THS 6332 has 26 Injection machines and
    // 3 Surface, and the two screens counted different sets until this worked.
    const app = await buildApp(ENV);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/global-overview?process=Injection',
    });
    expect(res.statusCode).toBe(200);

    const payload = zGlobalOverview.parse(res.json());
    expect(payload.filters_applied.process).toBe('Injection');

    await app.close();
  });

  it('narrows the census to one process, dropping the machines outside it', async () => {
    // Two Injection machines and one Surface at the same plant. Asking for
    // Injection must move TOTAL, not just the label - the bug this replaced was
    // a filter that reported itself applied while nothing was filtered.
    const snap = snapshot({ '6332': 10 }, { '6332': [] });
    snap.machines['6332'] = [
      { plant: '6332', machine: 'I1', process: 'Injection', zone: '2A-A', status: 'Mass Pro', lastSeen: null },
      { plant: '6332', machine: 'I2', process: 'Injection', zone: '2A-B', status: 'Stop', lastSeen: null },
      { plant: '6332', machine: 'HC2', process: 'Surface', zone: '2A-B', status: 'Mass Pro', lastSeen: null },
    ];

    const all = buildGlobalOverview({ snapshot: snap, filters: { ...FILTERS, process: 'all' }, env: ENV, now: NOW });
    const inj = buildGlobalOverview({ snapshot: snap, filters: { ...FILTERS, process: 'Injection' }, env: ENV, now: NOW });

    const p = (payload: typeof all) =>
      payload.companies.find((c) => c.code === 'THS')!.plants.find((x) => x.code === '6332')!.counts;

    expect(p(all).total).toBe(3);
    expect(p(all).running).toBe(2);
    expect(p(inj).total).toBe(2);
    expect(p(inj).running).toBe(1);
    expect(checkGlobalOverview(inj)).toEqual([]);
  });

  it('scopes to one Lamp, which is what makes it comparable with the plant board', async () => {
    const app = await buildApp(ENV);
    const res = await app.inject({ method: 'GET', url: '/api/v1/global-overview?plant=6332' });
    expect(res.statusCode).toBe(200);

    const payload = zGlobalOverview.parse(res.json());
    expect(payload.filters_applied.plant).toBe('6332');
    // Only the company that owns it, and only that one plant under it. The
    // point of the control: "THS 30" vs "Lamp 2: 29" stops being a mismatch
    // once the reader can ask the board the same question the wall board answers.
    expect(payload.companies.map((c) => c.code)).toEqual(['THS']);
    expect(payload.companies[0].plants.map((p) => p.code)).toEqual(['6332']);

    await app.close();
  });

  it('rejects an out-of-contract range instead of silently defaulting', async () => {
    const app = await buildApp(ENV);
    const res = await app.inject({ method: 'GET', url: '/api/v1/global-overview?range=99d' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
