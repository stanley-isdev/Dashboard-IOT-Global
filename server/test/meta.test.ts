import { describe, expect, it } from 'vitest';
import { zMeta } from '@dashboard/contract';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';
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
