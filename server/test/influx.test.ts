import { describe, expect, it } from 'vitest';
import { assertIdentifiersQuoted, ident, InfluxError } from '../src/influx/client.ts';
import { HOT_WINDOW_HOURS, latestMachineStatusSql } from '../src/influx/queries.ts';
import { influxTimeToIsoUtc } from '../src/influx/time.ts';

describe('assertIdentifiersQuoted - the silent-500 guard', () => {
  it('refuses a query with an unquoted mixed-case column', () => {
    // This exact query returns HTTP 500 with an empty body from the live
    // instance, with nothing in the response to debug from.
    expect(() =>
      assertIdentifiersQuoted('SELECT codeCompany FROM production_machine_status'),
    ).toThrow(InfluxError);
  });

  it('names the offender and how to fix it', () => {
    expect(() => assertIdentifiersQuoted('SELECT mainGroup, Result FROM t')).toThrow(
      /mainGroup, Result/,
    );
  });

  it('accepts the same columns once quoted', () => {
    expect(() =>
      assertIdentifiersQuoted(`SELECT ${ident('codeCompany')}, ${ident('Result')} FROM t`),
    ).not.toThrow();
  });

  it('does not confuse Result with Result1', () => {
    expect(() => assertIdentifiersQuoted(`SELECT ${ident('Result1')} FROM t`)).not.toThrow();
  });

  it('leaves all-lowercase columns alone - DataFusion handles those unquoted', () => {
    expect(() =>
      assertIdentifiersQuoted('SELECT plant, machine, time FROM production_machine_status'),
    ).not.toThrow();
  });
});

describe('ident', () => {
  it('quotes, and escapes an embedded quote', () => {
    expect(ident('codeCompany')).toBe('"codeCompany"');
    expect(ident('we"ird')).toBe('"we""ird"');
  });
});

describe('influxTimeToIsoUtc', () => {
  it('treats a zone-less Influx timestamp as UTC, not as local time', () => {
    // The bug this prevents: `new Date('2026-08-25T02:53:54.553')` is parsed
    // as local time, which in Asia/Bangkok is seven hours off.
    expect(influxTimeToIsoUtc('2026-08-25T02:53:54.553')).toBe('2026-08-25T02:53:54.553Z');
  });

  it('passes through a timestamp that already carries a zone', () => {
    expect(influxTimeToIsoUtc('2026-08-25T02:53:54.553Z')).toBe('2026-08-25T02:53:54.553Z');
    expect(influxTimeToIsoUtc('2026-08-25T09:53:54.553+07:00')).toBe('2026-08-25T02:53:54.553Z');
  });

  it('returns null for absence and junk, never a fabricated instant', () => {
    expect(influxTimeToIsoUtc(null)).toBeNull();
    expect(influxTimeToIsoUtc(undefined)).toBeNull();
    expect(influxTimeToIsoUtc('')).toBeNull();
    expect(influxTimeToIsoUtc('not a date')).toBeNull();
  });
});

describe('latestMachineStatusSql', () => {
  it('quotes every identifier it touches, including "Result"', () => {
    const sql = latestMachineStatusSql();
    // The guard is the real assertion here: it is what stands between a typo
    // and an empty-bodied 500 in production.
    expect(() => assertIdentifiersQuoted(sql)).not.toThrow();
    expect(sql).toContain('"plant"');
    expect(sql).toContain('"machine"');
    expect(sql).toContain('"Result"');
    expect(sql).toContain('"StatusStartTime"');
    expect(sql).toContain(`INTERVAL '${HOT_WINDOW_HOURS} hours'`);
  });

  it('takes one row per machine, newest first', () => {
    const sql = latestMachineStatusSql();
    expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY "plant", "machine"');
    expect(sql).toContain('ORDER BY "time" DESC');
    expect(sql).toContain('WHERE rn = 1');
  });

  it('never groups or filters by codeCompany - it is NULL on 98.6% of rows', () => {
    expect(latestMachineStatusSql()).not.toContain('codeCompany');
  });

  it('refuses a window past the measured 3-day cliff', () => {
    expect(() => latestMachineStatusSql(71)).not.toThrow();
    expect(() => latestMachineStatusSql(72)).toThrow(/BACKEND-HANDOVER/);
    expect(() => latestMachineStatusSql(0)).toThrow();
    expect(() => latestMachineStatusSql(2.5)).toThrow();
  });
});
