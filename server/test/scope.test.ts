import { describe, expect, it } from 'vitest';
import { zCompanyDetail, zPlantDetail, type MachineStatus, type ServedWindow } from '@dashboard/contract';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';
import { buildCompanyDetail, buildPlantDetail } from '../src/services/scopeService.ts';
import type { MachineOa } from '../src/domain/oa.ts';
import type { MachineHourOa } from '../src/domain/trend.ts';
import type { LiveSnapshot } from '../src/services/liveSnapshot.ts';

/**
 * The two drill-downs.
 *
 * The point most worth pinning is the one the service is built around: these
 * endpoints narrow `buildGlobalOverview` rather than re-implementing it, so a
 * plant's counts and %OA must equal the same plant's row inside the board.
 * That is what stops a drill-down disagreeing with the card that was clicked to
 * reach it, and it is checked directly below rather than assumed.
 *
 * Nothing here dials out. Every case builds a synthetic snapshot the way
 * globalOverview.test.ts does.
 */

const ENV = loadEnv({ CORS_ORIGIN: 'http://localhost:5173' });

const NOW = new Date('2026-08-25T02:00:00.000Z');
const WINDOW: ServedWindow = {
  from: new Date(NOW.getTime() - 24 * 3_600_000).toISOString(),
  to: NOW.toISOString(),
  hours: 24,
  source: 'range',
  chunks: 1,
  clamped: false,
};
const FILTERS = { range: '24h', process: 'Injection' } as const;

/* THS 6332 - a real code in master data, which is what these endpoints 404 on. */
const COMPANY = 'THS';
const PLANT = '6332';

function snapshot(
  machinesByPlant: Record<string, [string, MachineStatus, string | null][]> = {},
  oa: MachineOa[] = [],
  trend: MachineHourOa[] = [],
): LiveSnapshot {
  const seen = NOW.toISOString();
  const plants = Object.fromEntries(
    Object.entries(machinesByPlant).map(([plant, list]) => [
      plant,
      { plant, lastSeen: seen, machineCount: list.length },
    ]),
  );
  const machines = Object.fromEntries(
    Object.entries(machinesByPlant).map(([plant, list]) => [
      plant,
      list.map(([machine, status, zone]) => ({
        plant,
        machine,
        process: 'Injection',
        zone,
        status,
        lastSeen: seen,
        statusStartTime: NOW.getTime() - 600_000,
      })),
    ]),
  );

  return {
    fetchedAt: seen,
    lastSuccessAt: seen,
    ok: true,
    error: null,
    everSeen: {},
    plants,
    machines,
    unknownStatuses: [],
    oa,
    oaLastSuccessAt: seen,
    oaOk: true,
    oaError: null,
    trend,
    trendLastSuccessAt: seen,
    trendOk: true,
    trendError: null,
  };
}

function onOrder(plant: string, machine: string, oaPct: number | null, qty = 100): MachineOa {
  return {
    plant,
    machine,
    process: 'Injection',
    groupPo: `PO-${machine}`,
    oaPct,
    actualQty: qty,
    planQty: 200,
    shotCount: qty,
    poSlots: 1,
    createdRaw: [null],
    gap: null,
    finishedOrders: [],
  };
}

/** An hour of trend for one machine, `hoursAgo` before NOW. */
function hour(
  plant: string,
  machine: string,
  hoursAgo: number,
  oaPct: number,
  output: Partial<Pick<MachineHourOa, 'qtyPcs' | 'shotCount' | 'plans'>> = {},
): MachineHourOa {
  return {
    ts: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    plant,
    machine,
    oaPct,
    poSlots: 1,
    qtyPcs: null,
    shotCount: null,
    plans: {},
    ...output,
  };
}

const company = (snap: LiveSnapshot) =>
  buildCompanyDetail({
    company: COMPANY,
    snapshot: snap,
    filters: FILTERS,
    window: WINDOW,
    env: ENV,
    now: NOW,
  });

const plant = (snap: LiveSnapshot) =>
  buildPlantDetail({
    company: COMPANY,
    plant: PLANT,
    shift: 'current',
    snapshot: snap,
    filters: FILTERS,
    window: WINDOW,
    env: ENV,
    now: NOW,
  });

describe('buildCompanyDetail', () => {
  it('answers the agreed shape for a real company', () => {
    const payload = company(
      snapshot({ [PLANT]: [['I1', 'Mass Pro', '2A-A'], ['I2', 'Stop', '2A-A']] }, [
        onOrder(PLANT, 'I1', 80),
        onOrder(PLANT, 'I2', 60),
      ]),
    );

    expect(payload).not.toBeNull();
    expect(() => zCompanyDetail.parse(payload)).not.toThrow();
    expect(payload?.company.code).toBe(COMPANY);
  });

  it('is null for a code master data has never heard of', () => {
    expect(
      buildCompanyDetail({
        company: 'NOPE',
        snapshot: snapshot(),
        filters: FILTERS,
        window: WINDOW,
        env: ENV,
        now: NOW,
      }),
    ).toBeNull();
  });

  it('groups the census into zones and leaves untagged machines out of every one', () => {
    const payload = company(
      snapshot({
        [PLANT]: [
          ['I1', 'Mass Pro', '2A-A'],
          ['I2', 'Mass Pro', '2B-B'],
          // No zone tag: real, and it must not be collected into a synthetic
          // bucket that no zone on the floor answers for.
          ['I3', 'Mass Pro', null],
        ],
      }),
    );

    const zones = payload?.plants.find((p) => p.code === PLANT)?.zones ?? [];
    expect(zones.map((z) => z.code)).toEqual(['2A-A', '2B-B']);
    expect(zones.reduce((n, z) => n + z.counts.total, 0)).toBe(2);
  });

  it('carries the shift configuration and one row per shift', () => {
    const payload = company(snapshot({ [PLANT]: [['I1', 'Mass Pro', null]] }));

    // THS runs two twelve-hour shifts (masterData.ts).
    expect(payload?.shift_config?.shifts).toHaveLength(2);
    expect(payload?.shift_breakdown).toHaveLength(2);
    expect(payload?.shift_breakdown.map((s) => s.index)).toEqual([1, 2]);
    // Every row states its own length rather than assuming sixty minutes.
    for (const row of payload?.shift_breakdown ?? []) {
      expect(row.duration_min).toBeGreaterThan(0);
    }
  });

  it('adds the output of every hour in the shift, and only those hours', () => {
    /*
     * NOW is 02:00Z, which is 09:00 in Bangkok and inside THS's Day shift
     * (08:00-20:00 local = 01:00Z-13:00Z). So of the three hours below, two
     * land in Day and the third - 00:00Z, an hour before the shift opened -
     * belongs to the Night row and must not be added to this one.
     */
    const payload = company(
      snapshot(
        { [PLANT]: [['I1', 'Mass Pro', null]] },
        [],
        [
          hour(PLANT, 'I1', 0, 70, { qtyPcs: 100, shotCount: 90, plans: { 'PO-A': 400 } }),
          hour(PLANT, 'I1', 1, 80, { qtyPcs: 60, shotCount: 55, plans: { 'PO-A': 400 } }),
          hour(PLANT, 'I1', 2, 90, { qtyPcs: 999, shotCount: 999, plans: { 'PO-B': 999 } }),
        ],
      ),
    );

    const row = payload?.shift_breakdown.find((s) => s.state === 'in_progress');
    expect(row?.qty_pcs).toBe(160);
    expect(row?.shot_count).toBe(145);
    /*
     * 400, not 800. The same order ran in both hours and carries one plan; a
     * sum of the hourly totals would report a twelve-hour shift on one order as
     * twelve times its lot size. See `sumPlans` in domain/trend.ts.
     */
    expect(row?.plan_qty).toBe(400);
    expect(row?.achievement_pct).toBe(40);
    expect(row?.oa_pct).toBe(75);
    // The 999s went to the other shift, not into this row and not nowhere.
    expect(row?.qty_pcs).not.toBe(1159);
  });

  it('still reports running_avg as unknown, because nothing measures it', () => {
    // The one figure in the row the census cannot answer: it holds the status a
    // machine has NOW, not a history of them across the shift.
    const payload = company(
      snapshot({ [PLANT]: [['I1', 'Mass Pro', null]] }, [], [hour(PLANT, 'I1', 1, 70)]),
    );

    expect(payload?.shift_breakdown.find((s) => s.state === 'in_progress')?.running_avg).toBeNull();
  });
});

describe('buildPlantDetail', () => {
  it('answers the agreed shape and lists the machines', () => {
    const payload = plant(
      snapshot({ [PLANT]: [['I2', 'Stop', '2A-A'], ['I1', 'Mass Pro', '2A-A']] }, [
        onOrder(PLANT, 'I1', 80),
      ]),
    );

    expect(() => zPlantDetail.parse(payload)).not.toThrow();
    // Sorted, so the grid does not reorder itself between polls.
    expect(payload?.machines.map((m) => m.id)).toEqual(['I1', 'I2']);
  });

  it('keeps a machine that reports status but no shots', () => {
    // Common and real: a stopped machine produces nothing, and dropping it from
    // the grid would hide the one machine the reader opened the page for.
    const payload = plant(snapshot({ [PLANT]: [['I9', 'Stop', null]] }));

    const m = payload?.machines[0];
    expect(m?.id).toBe('I9');
    expect(m?.status).toBe('Stop');
    expect(m?.oa_pct).toBeNull();
    expect(m?.actual_qty).toBeNull();
  });

  it('leaves a parked or finished machine out of a ZONE %OA, as the plant above it does', () => {
    /*
     * ASI 6051 zone F, 2026-09-11. The zone read 45.8% and the plant card
     * above it 34.8% off the same machines, because the zone roll-up was the
     * only %OA on the payload that did not apply the board's
     * `EXCLUDE_FROM_OA`. `M-ID-06` was in `Order End` carrying a stale 111.6%
     * off its last shot; the production board, narrowed to that same zone, read
     * the plant's figure.
     *
     * `Order End` and not `Pending` only because it is the status that was
     * measured moving the number - `oaExcludedMachines` holds the whole list.
     */
    const snap = snapshot(
      {
        [PLANT]: [
          ['I1', 'Mass Pro', '2A-A'],
          ['I2', 'Mass Pro', '2A-A'],
          ['I3', 'Order End', '2A-A'],
        ],
      },
      [onOrder(PLANT, 'I1', 80), onOrder(PLANT, 'I2', 20), onOrder(PLANT, 'I3', 200)],
    );

    const payload = plant(snap);
    const zone = payload?.zones.find((z) => z.code === '2A-A');

    // The mean of 80 and 20, not of 80, 20 and 200.
    expect(zone?.kpi.oa_pct).toBe(50);
    expect(zone?.kpi.oa_machine_count).toBe(2);
    // The whole point: one plant, one zone, therefore one figure.
    expect(zone?.kpi.oa_pct).toBe(payload?.plant.kpi.oa_pct);
    expect(zone?.counts.finished_orders).toBe(payload?.plant.counts.finished_orders);
  });

  it('keeps the orders a parked machine finished today, while leaving it out of %OA', () => {
    /*
     * The two figures part company on purpose. The board draws a finished order
     * as its own card off the ORDER rows (`global_machine_seq > 1`, §2.1 of
     * MACHINE-STATUS-V2.md) and never asks what the machine is doing now -
     * `EXCLUDE_FROM_OA` then keeps that card out of the average. So an operator
     * parking a machine, or its order running out, may not retract the orders it
     * already completed today.
     */
    const finished: MachineOa = {
      ...onOrder(PLANT, 'I3', 200),
      finishedOrders: ['2026-08-25T01:00:00.000Z'], // 08:00 Bangkok, today
    };
    const snap = snapshot(
      {
        [PLANT]: [
          ['I1', 'Mass Pro', '2A-A'],
          ['I2', 'Mass Pro', '2A-A'],
          ['I3', 'Order End', '2A-A'],
        ],
      },
      [onOrder(PLANT, 'I1', 80), onOrder(PLANT, 'I2', 20), finished],
    );

    const payload = plant(snap);
    const zone = payload?.zones.find((z) => z.code === '2A-A');

    // Out of the average - the mean of 80 and 20, not of 80, 20 and 200.
    expect(payload?.plant.kpi.oa_pct).toBe(50);
    expect(zone?.kpi.oa_pct).toBe(50);
    // In the order count, at both levels, because the board's card exists.
    expect(payload?.plant.counts.finished_orders).toBe(1);
    expect(zone?.counts.finished_orders).toBe(1);
  });

  it('is null for a plant that is not in the company', () => {
    expect(
      buildPlantDetail({
        company: COMPANY,
        plant: '9999',
        shift: 'current',
        snapshot: snapshot(),
        filters: FILTERS,
        window: WINDOW,
        env: ENV,
        now: NOW,
      }),
    ).toBeNull();
  });

  it('fills an output bucket from the hours inside it', () => {
    const payload = plant(
      snapshot(
        { [PLANT]: [['I1', 'Mass Pro', null]] },
        [],
        [hour(PLANT, 'I1', 0, 70, { qtyPcs: 120, shotCount: 100, plans: { 'PO-A': 400 } })],
      ),
    );

    const filled = payload?.output?.buckets.find((b) => b.qty_pcs !== null);
    expect(filled?.qty_pcs).toBe(120);
    expect(filled?.qty_shots).toBe(100);
    // A whole hour, so the comparable rate equals the count. The two only
    // diverge on a partial bucket, which is the case the field exists for.
    expect(filled?.qty_per_hour).toBe(120);
    expect(filled?.oa_pct).toBe(70);
  });

  it('never reports an order’s lot size as an hour’s plan', () => {
    /*
     * The regression this guards is one that shipped for a few minutes and was
     * caught against live data: `sumPlans` over one hour returns the lot sizes
     * of the orders running in it, which the table would have printed beside
     * that hour's output. A 400-piece order spread over twelve hours is not a
     * 400-piece plan in each of them, and the two columns sit side by side.
     */
    const payload = plant(
      snapshot(
        { [PLANT]: [['I1', 'Mass Pro', null]] },
        [],
        [hour(PLANT, 'I1', 0, 70, { qtyPcs: 28, plans: { 'PO-A': 1263 } })],
      ),
    );

    for (const b of payload?.output?.buckets ?? []) expect(b.plan_qty).toBeNull();
  });

  it('sizes every output bucket from the shift rather than assuming an hour', () => {
    const payload = plant(snapshot({ [PLANT]: [['I1', 'Mass Pro', null]] }));

    const buckets = payload?.output?.buckets ?? [];
    expect(buckets.length).toBeGreaterThan(0);
    for (const b of buckets) {
      expect(b.duration_min).toBeGreaterThan(0);
      expect(b.duration_min).toBeLessThanOrEqual(60);
      expect(b.is_partial).toBe(b.duration_min < 60);
    }
    // Contiguous and in order - the table lays them out end to end.
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i].start_utc).toBe(buckets[i - 1].end_utc);
    }
  });

  /*
   * The regression this locks: buckets used to carry a `label` the service
   * formatted as `HH:MM-HH:MM` in the site's own zone, and it was the only
   * pre-formatted timestamp in any payload. A formatted string has already
   * discarded the offset it was formatted at, so the client could not re-zone
   * it - which made the hourly table the one clock on the board the
   * display-zone picker could not move, and a reader on Tokyo time saw the
   * shift header two hours away from the columns under it.
   *
   * Asserted against the SERVICE's own object rather than the parsed contract,
   * because zod strips unknown keys: `zOutputBucket` dropping the field would
   * hide a service that had started emitting it again. Written as a scan for
   * any clock-shaped string rather than for `label` by name, so the next field
   * to make this mistake under a different name fails here too.
   */
  it('emits bucket bounds as instants, never as a pre-formatted clock string', () => {
    const payload = plant(snapshot({ [PLANT]: [['I1', 'Mass Pro', null]] }));

    const buckets = payload?.output?.buckets ?? [];
    expect(buckets.length).toBeGreaterThan(0);
    for (const b of buckets) {
      for (const [key, value] of Object.entries(b)) {
        if (typeof value !== 'string') continue;
        expect(
          value,
          `output bucket carries a formatted local time in '${key}' - the UI ` +
            `cannot re-zone that, so the bounds have to stay ISO instants`,
        ).not.toMatch(/^\d{2}:\d{2}/);
      }
    }
  });
});

describe('the drill-downs reconcile with the board above them', () => {
  it('reports the same counts and %OA as the plant’s row on the global board', async () => {
    const snap = snapshot(
      {
        [PLANT]: [
          ['I1', 'Mass Pro', '2A-A'],
          ['I2', 'Stop', '2A-A'],
          ['I3', 'Dandori', '2B-B'],
        ],
      },
      [onOrder(PLANT, 'I1', 90), onOrder(PLANT, 'I2', 50), onOrder(PLANT, 'I3', 70)],
    );

    const detail = plant(snap);
    const fromCompany = company(snap)?.plants.find((p) => p.code === PLANT);

    expect(detail?.plant.counts).toEqual(fromCompany?.counts);
    expect(detail?.plant.kpi.oa_pct).toBe(fromCompany?.kpi.oa_pct);
    // And the machine list adds up to the census the counts were taken from.
    expect(detail?.machines).toHaveLength(detail?.plant.counts.total ?? -1);
  });
});

describe('routes', () => {
  it('serves both drill-downs and 404s on an unknown code', async () => {
    const app = await buildApp(ENV);

    const ok = await app.inject({ method: 'GET', url: `/api/v1/companies/${COMPANY}?range=24h` });
    expect(ok.statusCode).toBe(200);
    expect(() => zCompanyDetail.parse(ok.json())).not.toThrow();

    const plantOk = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY}/plants/${PLANT}?range=24h&shift=current`,
    });
    expect(plantOk.statusCode).toBe(200);
    expect(() => zPlantDetail.parse(plantOk.json())).not.toThrow();

    const missing = await app.inject({ method: 'GET', url: '/api/v1/companies/NOPE' });
    expect(missing.statusCode).toBe(404);

    const badPlant = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY}/plants/9999`,
    });
    expect(badPlant.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a range the contract does not define', async () => {
    const app = await buildApp(ENV);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY}?range=99y`,
    });
    // zRange has no `.catch()`, so an unknown range is a 400 rather than a
    // silent fallback to 24 h under a label the reader did not pick.
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
