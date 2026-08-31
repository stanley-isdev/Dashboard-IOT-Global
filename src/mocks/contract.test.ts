import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  zCompanyDetail,
  zGlobalOverview,
  zMeta,
  zPlantDetail,
  type Counts,
  type MachineStatus,
  type ShiftConfig,
} from '../api/contract';
import { buildBuckets, buildCompanyDetail, buildGlobalOverview, buildMeta, buildPlantDetail, resolveShift } from './generate';
import { COMPANIES, type CompanySeed } from './masterData';

/**
 * Proves the mock emits legal payloads and that the payloads satisfy the
 * correctness rules the design doc's section 16 lists as Definition of Done.
 *
 * This is not "testing the mock". The mock is the executable specification the
 * backend will be built against, so a rule asserted here is a rule the API has
 * to keep. Section 16's one-off reconciliation becomes a check that runs on
 * every commit.
 */

const FILTERS = { range: '24h', process: 'Injection', region: 'all', plant: 'all' } as const;

/** A fixed instant so shift-boundary assertions are reproducible. */
const AT = (iso: string) => new Date(iso);

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`contract violation:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

describe('payloads satisfy the contract', () => {
  const now = AT('2026-08-04T08:15:00Z'); // 15:15 ICT, 17:15 JST

  it('meta', () => {
    expect(() => parse(zMeta, buildMeta(now))).not.toThrow();
  });

  it('global overview', () => {
    expect(() => parse(zGlobalOverview, buildGlobalOverview(now, 'default', FILTERS))).not.toThrow();
  });

  it('company detail, for every company including the unconnected ones', () => {
    for (const c of COMPANIES) {
      const payload = buildCompanyDetail(c.code, now, 'default', {
        range: '24h',
        process: 'Injection',
      });
      expect(payload, `${c.code} must resolve`).not.toBeNull();
      expect(() => parse(zCompanyDetail, payload)).not.toThrow();
    }
  });

  it('plant detail', () => {
    const payload = buildPlantDetail('THS', '6332', now, 'default', {
      range: '24h',
      process: 'Injection',
      shift: 'current',
    });
    expect(() => parse(zPlantDetail, payload)).not.toThrow();
  });
});

describe('a site with no telemetry is never reported as stopped', () => {
  const now = AT('2026-08-04T08:15:00Z');
  const overview = parse(zGlobalOverview, buildGlobalOverview(now, 'default', FILTERS));

  const unconnected = overview.companies.filter((c) => c.status === 'not_connected');

  it('six of the nine bases are not connected', () => {
    expect(overview.companies).toHaveLength(9);
    expect(unconnected.map((c) => c.code).sort()).toEqual([
      'IIS',
      'ISE',
      'SEH',
      'SMX',
      'SUS',
      'VNS',
    ]);
  });

  it('contributes zero to every machine bucket - including stopped', () => {
    for (const c of unconnected) {
      expect(c.counts.stopped, `${c.code} must not report stopped machines`).toBe(0);
      expect(c.counts.running).toBe(0);
      expect(c.counts.total).toBe(0);
    }
  });

  it('reports unknown rather than zero for every metric', () => {
    for (const c of unconnected) {
      expect(c.kpi.oa_pct, `${c.code} %OA must be unknown, not 0`).toBeNull();
      expect(c.kpi.achievement_pct).toBeNull();
      expect(c.kpi.actual_qty).toBeNull();
      expect(c.kpi.oa_tier).toBe('unknown');
    }
  });

  it('is excluded from the KPI denominator', () => {
    expect(overview.totals.companies_reporting).toBe(3);
    expect(overview.totals.companies_total).toBe(9);
    const reportingTotal = overview.companies
      .filter((c) => c.status === 'online' || c.status === 'stale')
      .reduce((a, c) => a + c.counts.total, 0);
    expect(overview.totals.counts.total).toBe(reportingTotal);
  });

  it('is not counted as needing attention', () => {
    expect(overview.totals.companies_needing_attention).toBeLessThanOrEqual(3);
  });

  it('never sources an alert - a site with no data cannot report a fault', () => {
    const reporting = new Set(
      overview.companies
        .filter((c) => c.status === 'online' || c.status === 'stale')
        .map((c) => c.code),
    );
    for (const alert of overview.alerts) {
      expect(reporting.has(alert.company), `alert ${alert.id} came from ${alert.company}`).toBe(
        true,
      );
    }
  });
});

describe('a site that goes quiet reads as stale, not stopped', () => {
  const now = AT('2026-08-04T08:15:00Z');
  const overview = parse(zGlobalOverview, buildGlobalOverview(now, 'site-offline', FILTERS));
  const ths = overview.companies.find((c) => c.code === 'THS')!;

  it('is marked stale', () => {
    expect(ths.status).toBe('stale');
  });

  it('keeps its last known numbers on screen', () => {
    expect(ths.kpi.oa_pct).not.toBeNull();
    expect(ths.counts.total).toBeGreaterThan(0);
  });

  it('still counts toward coverage, because it did report', () => {
    expect(overview.totals.companies_reporting).toBe(3);
  });

  it('carries a last_seen the banner can quote', () => {
    expect(ths.last_seen).not.toBeNull();
    const ageSec = (now.getTime() - new Date(ths.last_seen!).getTime()) / 1000;
    expect(ageSec).toBeGreaterThan(120); // past the stale_after_sec policy
  });
});

describe('the machine census adds up', () => {
  const now = AT('2026-08-04T08:15:00Z');
  const overview = parse(zGlobalOverview, buildGlobalOverview(now, 'default', FILTERS));

  const assertPartition = (counts: Counts, label: string) => {
    const summed = (Object.values(counts.by_status) as number[]).reduce((a, b) => a + b, 0);
    expect(summed, `${label}: sum(by_status) must equal total`).toBe(counts.total);
    expect(
      counts.running + counts.stopped + counts.idle + counts.other + counts.no_data,
      `${label}: buckets must partition the total`,
    ).toBe(counts.total);
  };

  it('at global, company and plant level', () => {
    assertPartition(overview.totals.counts, 'global');
    for (const c of overview.companies) {
      assertPartition(c.counts, c.code);
      for (const p of c.plants) assertPartition(p.counts, `${c.code}/${p.code}`);
    }
  });

  it('never folds No Plan or Order End into stopped', () => {
    for (const c of overview.companies) {
      const byStatus = c.counts.by_status as Record<MachineStatus, number>;
      expect(c.counts.stopped).toBe(byStatus.Stop ?? 0);
      expect(c.counts.idle).toBe((byStatus['No Plan'] ?? 0) + (byStatus['Order End'] ?? 0));
    }
  });

  it("keeps 4M Change in its own bucket while D-21 is open", () => {
    for (const c of overview.companies) {
      const byStatus = c.counts.by_status as Record<MachineStatus, number>;
      expect(c.counts.other).toBe(byStatus['4M Change'] ?? 0);
    }
  });
});

describe('shift resolution handles all three patterns (section 16 DoD)', () => {
  const ths = COMPANIES.find((c) => c.code === 'THS')!;
  const stj = COMPANIES.find((c) => c.code === 'STJ')!;

  it('two twelve-hour shifts - THS day', () => {
    // 08:15 UTC is 15:15 in Bangkok, inside the 08:00-20:00 day shift.
    const shift = resolveShift(ths, AT('2026-08-04T08:15:00Z'))!;
    expect(shift.code).toBe('D');
    expect(shift.index).toBe(1);
    expect(shift.of).toBe(2);
    expect(shift.start_local).toBe('2026-08-04T08:00:00+07:00');
    expect(shift.end_local).toBe('2026-08-04T20:00:00+07:00');
    expect(shift.production_date).toBe('2026-08-04');
  });

  it('three shifts with an off-the-hour boundary - STJ B ends 22:15', () => {
    // 12:00 UTC is 21:00 in Tokyo, inside B (14:00-22:15).
    const shift = resolveShift(stj, AT('2026-08-04T12:00:00Z'))!;
    expect(shift.code).toBe('B');
    expect(shift.index).toBe(2);
    expect(shift.of).toBe(3);
    expect(shift.end_local).toBe('2026-08-04T22:15:00+09:00');
  });

  it('the 22:15 boundary is respected, not rounded to 22:00', () => {
    // 13:10 UTC is 22:10 JST - still B, by ten minutes.
    expect(resolveShift(stj, AT('2026-08-04T13:10:00Z'))!.code).toBe('B');
    // 13:20 UTC is 22:20 JST - now C.
    expect(resolveShift(stj, AT('2026-08-04T13:20:00Z'))!.code).toBe('C');
  });

  it('a shift that crosses midnight keeps the production date it started on', () => {
    // 18:00 UTC on the 4th is 03:00 JST on the 5th, inside C (22:15-06:00),
    // which began at 22:15 on the 4th. The anchor is shift_start, so the
    // production date must be the 4th even though the local calendar says the 5th.
    const shift = resolveShift(stj, AT('2026-08-04T18:00:00Z'))!;
    expect(shift.code).toBe('C');
    expect(shift.start_local).toBe('2026-08-04T22:15:00+09:00');
    expect(shift.end_local).toBe('2026-08-05T06:00:00+09:00');
    expect(shift.production_date).toBe('2026-08-04');
  });

  it('a company with no shift config resolves to null, never a default', () => {
    const seh = COMPANIES.find((c) => c.code === 'SEH')!;
    expect(seh.shiftConfig).toBeNull();
    expect(resolveShift(seh, AT('2026-08-04T08:15:00Z'))).toBeNull();
  });
});

describe('hourly buckets are generated from shift config, never hardcoded', () => {
  const stj = COMPANIES.find((c) => c.code === 'STJ')!;
  const ths = COMPANIES.find((c) => c.code === 'THS')!;

  it('THS day shift yields twelve equal hours', () => {
    const now = AT('2026-08-04T12:00:00Z');
    const shift = resolveShift(ths, now)!;
    const buckets = buildBuckets(shift, 'Asia/Bangkok', now, 'test');
    expect(buckets).toHaveLength(12);
    expect(buckets.every((b) => b.duration_min === 60)).toBe(true);
    expect(buckets.some((b) => b.is_partial)).toBe(false);
  });

  it('STJ B yields nine - eight hours plus a fifteen-minute tail', () => {
    const now = AT('2026-08-04T12:00:00Z'); // 21:00 JST
    const shift = resolveShift(stj, now)!;
    const buckets = buildBuckets(shift, 'Asia/Tokyo', now, 'test');
    expect(buckets).toHaveLength(9);
    expect(buckets.at(-1)!.duration_min).toBe(15);
    expect(buckets.at(-1)!.is_partial).toBe(true);
    expect(buckets.at(-1)!.label).toBe('22:00-22:15');
    expect(buckets.slice(0, 8).every((b) => b.duration_min === 60)).toBe(true);
  });

  it('STJ C yields eight - a forty-five-minute head plus seven hours', () => {
    const now = AT('2026-08-04T18:00:00Z'); // 03:00 JST next day
    const shift = resolveShift(stj, now)!;
    const buckets = buildBuckets(shift, 'Asia/Tokyo', now, 'test');
    expect(buckets).toHaveLength(8);
    expect(buckets[0].duration_min).toBe(45);
    expect(buckets[0].is_partial).toBe(true);
    expect(buckets[0].label).toBe('22:15-23:00');
  });

  it('a bucket that has not happened reports null, never zero', () => {
    const now = AT('2026-08-04T05:30:00Z'); // 14:30 JST, early in B
    const shift = resolveShift(stj, now)!;
    const buckets = buildBuckets(shift, 'Asia/Tokyo', now, 'test');
    const future = buckets.filter((b) => b.state === 'not_started');
    expect(future.length).toBeGreaterThan(0);
    for (const b of future) {
      expect(b.qty_pcs).toBeNull();
      expect(b.qty_per_hour).toBeNull();
      expect(b.oa_pct).toBeNull();
    }
  });

  it('supplies a per-hour rate so unequal buckets stay comparable', () => {
    const now = AT('2026-08-04T13:00:00Z'); // 22:00 JST - the 15 min tail is running
    const shift = resolveShift(stj, now)!;
    const buckets = buildBuckets(shift, 'Asia/Tokyo', now, 'test');
    const done = buckets.filter((b) => b.state === 'complete');
    for (const b of done) expect(b.qty_per_hour).not.toBeNull();
  });
});

describe('a new shift pattern needs config only, not code (section 16 DoD)', () => {
  it('a four-shift company resolves and buckets correctly', () => {
    const fourShift: ShiftConfig = {
      effective_from: '2026-01-01',
      timezone: 'Europe/Budapest',
      production_date_anchor: 'shift_start',
      shifts: [
        { code: 'S1', label: 'Shift 1', start: '06:00', end: '12:00' },
        { code: 'S2', label: 'Shift 2', start: '12:00', end: '18:00' },
        { code: 'S3', label: 'Shift 3', start: '18:00', end: '23:30' },
        { code: 'S4', label: 'Shift 4', start: '23:30', end: '06:00' },
      ],
    };
    const seed: CompanySeed = {
      ...COMPANIES.find((c) => c.code === 'SEH')!,
      shiftConfig: fourShift,
    };

    const now = AT('2026-08-04T18:00:00Z'); // 20:00 CEST - inside S3
    const shift = resolveShift(seed, now)!;
    expect(shift.code).toBe('S3');
    expect(shift.of).toBe(4);

    const buckets = buildBuckets(shift, 'Europe/Budapest', now, 'test');
    // 18:00-23:30 is five whole hours plus a thirty-minute tail.
    expect(buckets).toHaveLength(6);
    expect(buckets.at(-1)!.duration_min).toBe(30);
  });
});

describe('degraded sources are named, not hidden', () => {
  it('flags the payload as partial and says which source failed', () => {
    const now = AT('2026-08-04T08:15:00Z');
    const overview = parse(zGlobalOverview, buildGlobalOverview(now, 'partial', FILTERS));
    expect(overview.meta.partial).toBe(true);
    const mssql = overview.meta.sources.find((s) => s.name === 'mssql')!;
    expect(mssql.status).toBe('down');
    expect(mssql.message).toBeTruthy();
  });
});

/**
 * The region parameter is the one filter that changes the denominator, so its
 * encoding is asserted here rather than left to the picker that writes it: the
 * frontend, the mock and the server all read it through the same matcher in the
 * contract, and a URL somebody pasted into a kiosk has to keep meaning what it
 * meant when it was copied.
 */
describe('region scopes the board, one code or several', () => {
  const now = AT('2026-08-04T08:15:00Z');
  const scoped = (region: string) =>
    parse(zGlobalOverview, buildGlobalOverview(now, 'default', { ...FILTERS, region }));

  const codes = (region: string) => scoped(region).companies.map((c) => c.code);

  it('takes a country code, and includes every base under it', () => {
    expect(codes('TH')).toEqual(['THS', 'ASI']);
  });

  it('takes a single company code', () => {
    expect(codes('STJ')).toEqual(['STJ']);
  });

  it('takes a comma-separated list mixing countries and companies', () => {
    expect(codes('TH,STJ')).toEqual(['THS', 'ASI', 'STJ']);
    expect(codes('THS,SEH')).toEqual(['THS', 'SEH']);
  });

  it('reads TH the same as THS,ASI - the short form is only shorter', () => {
    expect(codes('TH')).toEqual(codes('THS,ASI'));
  });

  it('keeps the coverage arithmetic inside the scope it was given', () => {
    const overview = scoped('TH,STJ');
    expect(overview.totals.companies_total).toBe(3);
    expect(overview.totals.companies_reporting).toBe(3);
    expect(overview.totals.countries_total).toBe(2);
    const machines = overview.companies.reduce((a, c) => a + c.counts.total, 0);
    expect(overview.totals.counts.total).toBe(machines);
  });

  it('never sources an alert from a base outside the scope', () => {
    const overview = scoped('JP');
    for (const alert of overview.alerts) expect(alert.company).toBe('STJ');
  });

  it('matches nothing for an unknown token rather than widening back to all', () => {
    expect(codes('ZZ')).toEqual([]);
  });

  /*
   * `none` is what the picker's All row writes when it is tapped off, so it is
   * the one empty scope a reader reaches on purpose. It has to survive the trip
   * through the URL as itself: coming back as the whole fleet would mean the
   * board silently disagreeing with the ticks in the menu above it.
   */
  it('takes none as the empty scope, and keeps the totals honest at zero', () => {
    const overview = scoped('none');
    expect(overview.companies).toEqual([]);
    expect(overview.totals.companies_total).toBe(0);
    expect(overview.totals.companies_reporting).toBe(0);
    expect(overview.totals.oa_pct).toBeNull();
    expect(overview.totals.actual_qty).toBeNull();
    expect(overview.alerts).toEqual([]);
  });

  it('lets a real token win over a leftover none', () => {
    expect(codes('none,TH')).toEqual(['THS', 'ASI']);
  });

  it('treats all as the whole fleet however it arrives', () => {
    expect(codes('all')).toHaveLength(9);
    expect(codes('')).toHaveLength(9);
    // `all` in a list wins: it is already the widest scope.
    expect(codes('TH,all')).toHaveLength(9);
  });
});
