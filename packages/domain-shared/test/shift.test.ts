import { describe, expect, it } from 'vitest';
import type { ShiftConfig } from '@dashboard/contract';
import { resolveShift } from '../src/shift.ts';

/**
 * Ported unchanged from src/mocks/contract.test.ts's "shift resolution
 * handles all three patterns" describe block (design doc section 16 DoD) -
 * same instants, same expected shift codes/production dates. This proves
 * zero behavior drift between the mock's reference implementation and the
 * real backend's port before any InfluxDB work starts.
 *
 * Shift configs below mirror src/mocks/masterData.ts's TWO_SHIFT/STJ_SHIFT
 * verbatim (that file is mock-only synthetic seed data and out of scope for
 * this package, but the shift shapes themselves are real master data from
 * design doc section 9.5, not mock inventions).
 */

const AT = (iso: string) => new Date(iso);

const THS_SHIFT_CONFIG: ShiftConfig = {
  effective_from: '2026-01-01',
  timezone: 'Asia/Bangkok',
  production_date_anchor: 'shift_start',
  shifts: [
    { code: 'D', label: 'Day', start: '08:00', end: '20:00' },
    { code: 'N', label: 'Night', start: '20:00', end: '08:00' },
  ],
};

const STJ_SHIFT_CONFIG: ShiftConfig = {
  effective_from: '2026-01-01',
  timezone: 'Asia/Tokyo',
  production_date_anchor: 'shift_start',
  shifts: [
    { code: 'A', label: 'A Shift', start: '06:00', end: '14:00' },
    { code: 'B', label: 'B Shift', start: '14:00', end: '22:15' },
    { code: 'C', label: 'C Shift', start: '22:15', end: '06:00' },
  ],
};

describe('shift resolution handles all three patterns (section 16 DoD)', () => {
  it('two twelve-hour shifts - THS day', () => {
    // 08:15 UTC is 15:15 in Bangkok, inside the 08:00-20:00 day shift.
    const shift = resolveShift(THS_SHIFT_CONFIG, AT('2026-08-04T08:15:00Z'))!;
    expect(shift.code).toBe('D');
    expect(shift.index).toBe(1);
    expect(shift.of).toBe(2);
    expect(shift.start_local).toBe('2026-08-04T08:00:00+07:00');
    expect(shift.end_local).toBe('2026-08-04T20:00:00+07:00');
    expect(shift.production_date).toBe('2026-08-04');
  });

  it('three shifts with an off-the-hour boundary - STJ B ends 22:15', () => {
    // 12:00 UTC is 21:00 in Tokyo, inside B (14:00-22:15).
    const shift = resolveShift(STJ_SHIFT_CONFIG, AT('2026-08-04T12:00:00Z'))!;
    expect(shift.code).toBe('B');
    expect(shift.index).toBe(2);
    expect(shift.of).toBe(3);
    expect(shift.end_local).toBe('2026-08-04T22:15:00+09:00');
  });

  it('the 22:15 boundary is respected, not rounded to 22:00', () => {
    // 13:10 UTC is 22:10 JST - still B, by ten minutes.
    expect(resolveShift(STJ_SHIFT_CONFIG, AT('2026-08-04T13:10:00Z'))!.code).toBe('B');
    // 13:20 UTC is 22:20 JST - now C.
    expect(resolveShift(STJ_SHIFT_CONFIG, AT('2026-08-04T13:20:00Z'))!.code).toBe('C');
  });

  it('a shift that crosses midnight keeps the production date it started on', () => {
    // 18:00 UTC on the 4th is 03:00 JST on the 5th, inside C (22:15-06:00),
    // which began at 22:15 on the 4th. The anchor is shift_start, so the
    // production date must be the 4th even though the local calendar says the 5th.
    const shift = resolveShift(STJ_SHIFT_CONFIG, AT('2026-08-04T18:00:00Z'))!;
    expect(shift.code).toBe('C');
    expect(shift.start_local).toBe('2026-08-04T22:15:00+09:00');
    expect(shift.end_local).toBe('2026-08-05T06:00:00+09:00');
    expect(shift.production_date).toBe('2026-08-04');
  });

  it('a company with no shift config resolves to null, never a default', () => {
    expect(resolveShift(null, AT('2026-08-04T08:15:00Z'))).toBeNull();
  });

  it('a new shift pattern needs config only, not code (section 16 DoD)', () => {
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
    const now = AT('2026-08-04T18:00:00Z'); // 20:00 CEST - inside S3
    const shift = resolveShift(fourShift, now)!;
    expect(shift.code).toBe('S3');
    expect(shift.of).toBe(4);
  });
});
