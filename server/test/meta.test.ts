import { describe, expect, it } from 'vitest';
import { zMeta } from '@dashboard/contract';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';
import { COMPANIES } from '../src/config/masterData.ts';
import { buildMeta } from '../src/services/metaService.ts';
import type { LiveSnapshot, MachineObservation } from '../src/services/liveSnapshot.ts';

/** A successful snapshot carrying just the machine rows a test cares about. */
function snapshotWith(machines: Record<string, MachineObservation[]>): LiveSnapshot {
  const at = new Date().toISOString();
  return {
    fetchedAt: at,
    lastSuccessAt: at,
    ok: true,
    error: null,
    everSeen: {},
    plants: {},
    machines,
    unknownStatuses: [],
    oa: [],
    oaLastSuccessAt: at,
    oaOk: true,
    oaError: null,
    trend: [],
    trendLastSuccessAt: at,
    trendOk: true,
    trendError: null,
  };
}

const machine = (over: Partial<MachineObservation>): MachineObservation => ({
  plant: '6332',
  machine: 'M1',
  process: 'Injection',
  zone: null,
  status: 'Mass Pro',
  lastSeen: null,
  statusStartTime: null,
  ...over,
});

describe('GET /api/v1/meta', () => {
  it('returns a payload that satisfies the contract, with no Influx/MSSQL call', async () => {
    const app = await buildApp(loadEnv({ CORS_ORIGIN: 'http://localhost:5173' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(res.statusCode).toBe(200);

    const parsed = zMeta.parse(res.json());
    expect(parsed.companies).toHaveLength(9);
    expect(parsed.countries.length).toBeGreaterThan(0);

    // Milestone-1 reality (design doc section 11): only THS/ASI/STJ are live.
    const live = parsed.companies.filter((c) => c.data_readiness === 'live').map((c) => c.code);
    expect(live.sort()).toEqual(['ASI', 'STJ', 'THS']);

    // Only sources this deployment actually has are listed. MSSQL is absent
    // because it is unconfigured (D-18) - listing it permanently `down` would
    // pin `partial` true forever and dim the dashboard over a source no route
    // reads. Influx is present and honestly `down`: these env vars are unset
    // in the test, so nothing has connected.
    expect(parsed.meta.sources.map((s) => s.name)).toEqual(['influxdb']);
    expect(parsed.meta.sources[0]!.status).toBe('down');
    expect(parsed.meta.sources[0]!.last_success).toBeNull();
    expect(parsed.meta.partial).toBe(true);

    await app.close();
  });

  it('lists every process the snapshot reports, not just Injection', () => {
    const snap = snapshotWith({
      '6332': [
        machine({ machine: 'I1', process: 'Injection' }),
        machine({ machine: 'AF2', process: 'Surface' }),
        machine({ machine: 'BP6', process: 'Surface' }),
      ],
      '6051': [machine({ plant: '6051', machine: 'A1', process: 'Assembly' })],
    });

    // Contract order, de-duplicated, regardless of which plant reported first.
    expect(buildMeta([], snap).processes).toEqual(['Injection', 'Surface', 'Assembly']);
  });

  it('drops a process tag the contract enum does not know, rather than failing validation', () => {
    const snap = snapshotWith({
      '6332': [
        machine({ machine: 'I1', process: 'Injection' }),
        machine({ machine: 'X1', process: 'Moulding' }),
      ],
    });

    const meta = buildMeta([], snap);
    expect(meta.processes).toEqual(['Injection']);
    expect(() => zMeta.shape.processes.parse(meta.processes)).not.toThrow();
  });

  it('falls back to Injection while the poller is cold, keeping the picker usable', () => {
    expect(buildMeta([], snapshotWith({})).processes).toEqual(['Injection']);
  });

  it('generated_at advances across requests, never freezing', async () => {
    const app = await buildApp(loadEnv({ CORS_ORIGIN: 'http://localhost:5173' }));
    const first = zMeta.parse((await app.inject({ method: 'GET', url: '/api/v1/meta' })).json());
    await new Promise((r) => setTimeout(r, 5));
    const second = zMeta.parse((await app.inject({ method: 'GET', url: '/api/v1/meta' })).json());
    expect(second.meta.generated_at).not.toBe(first.meta.generated_at);
    await app.close();
  });
});

describe('/meta ever_reported - what the plant picker filters on', () => {
  /*
   * `/meta` stays the complete roster: it is master data, and a roster that
   * quietly drops rows lies about what exists. The flag is how the pickers and
   * the board hide a dead end without the roster itself losing it.
   */
  it('keeps every plant listed and marks the ones that never reported', () => {
    const snap = snapshotWith({});
    snap.everSeen = { '6332': 'yes', '6337': 'no', '6321': 'no' };

    const meta = zMeta.parse(buildMeta([], snap));
    const ths = meta.companies.find((c) => c.code === 'THS')!;

    // All four still present - nothing is deleted from the roster.
    expect(ths.plants.map((p) => p.code).sort()).toEqual(['6321', '6332', '6337', '6338']);
    expect(ths.plants.find((p) => p.code === '6332')!.ever_reported).toBe(true);
    expect(ths.plants.find((p) => p.code === '6337')!.ever_reported).toBe(false);
    expect(ths.plants.find((p) => p.code === '6321')!.ever_reported).toBe(false);
  });

  it('reads unknown as reported, so a probe outage cannot empty the picker', () => {
    // No ledger at all - every plant `unknown`, which is every plant at boot.
    const meta = zMeta.parse(buildMeta([], snapshotWith({})));
    for (const c of meta.companies) {
      for (const p of c.plants) expect(p.ever_reported).toBe(true);
    }
  });
});

describe('master data adds context, never claims', () => {
  /*
   * Added after three separate fabrications got as far as the screen while this
   * feature was being written: SEH's absence was given `since: '2026-07-01'`
   * (nothing supports that date - master data has only ever carried "gateway
   * installation in progress, 16 machines, phase 2", and DESIGN.md 11 leaves
   * the column `?`), the board then rendered a confident "69 days" off it, and
   * STJ's reason was attributed to the IoT team, who had not been asked.
   *
   * The rule the design owner settled on 2026-09-08 is the fix: go by the
   * database. A site with no telemetry is read off the `everSeen` ledger and the
   * screen states what was observed; this field may only add what no query can
   * know. So the shape itself is the guard - there is nowhere left to put a date.
   */
  it('lets an absence carry only a reason and an owner', () => {
    for (const c of COMPANIES) {
      if (!c.absence) continue;
      expect(
        Object.keys(c.absence).sort(),
        `${c.code}: an absence may add context, not dates or counts`,
      ).toEqual(['owner', 'reason']);
    }
  });

  it('leaves STJ unannotated, because the query is the whole answer', () => {
    // Every attempt to say more about STJ here had to be withdrawn. The tile
    // reads "no telemetry received" off the ledger and needs nothing from config.
    const stj = COMPANIES.find((c) => c.code === 'STJ')!;
    expect(stj.readiness).toBe('live'); // the claim is preserved, not edited away
    expect(stj.absence).toBeNull();
  });

  it('still annotates the sites where a human genuinely knows more', () => {
    // SEH is mid-installation and VNS has no date - facts no query can reach,
    // and exactly what this field is for.
    for (const code of ['SEH', 'VNS']) {
      const c = COMPANIES.find((x) => x.code === code)!;
      expect(c.absence, `${code} should carry its rollout context`).not.toBeNull();
      expect(c.absence!.reason.length).toBeGreaterThan(10);
      expect(c.absence!.owner.length).toBeGreaterThan(0);
    }
  });
});
