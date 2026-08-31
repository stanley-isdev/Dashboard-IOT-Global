import { describe, expect, it } from 'vitest';
import type { ShiftConfig } from '@dashboard/contract';
import { resolveShift } from '@dashboard/domain-shared';
import { orderShiftVerdict, parseCreateDate } from '../src/domain/orderShift.ts';
import { splitByOrderShift, type MachineOa } from '../src/domain/oa.ts';

/**
 * `Order End` layer 2 (DESIGN.md §8.4), reconciled against the production
 * `Machine Status V2.0` board on 2026-08-27.
 *
 * Every timestamp here was read out of the live `production_machine_io` in the
 * same minutes as the board's own AVG %OA, which is what makes this a
 * reconciliation rather than a restatement of the code.
 */

const THS_SHIFT: ShiftConfig = {
  effective_from: '2026-01-01',
  timezone: 'Asia/Bangkok',
  production_date_anchor: 'shift_start',
  shifts: [
    { code: 'D', label: 'Day', start: '08:00', end: '20:00' },
    { code: 'N', label: 'Night', start: '20:00', end: '08:00' },
  ],
};

/** STJ's three shifts, including the 22:15 boundary the panel's rule cannot express. */
const STJ_SHIFT: ShiftConfig = {
  effective_from: '2026-01-01',
  timezone: 'Asia/Tokyo',
  production_date_anchor: 'shift_start',
  shifts: [
    { code: 'A', label: 'A Shift', start: '06:00', end: '14:00' },
    { code: 'B', label: 'B Shift', start: '14:00', end: '22:15' },
    { code: 'C', label: 'C Shift', start: '22:15', end: '06:00' },
  ],
};

/** 09:50 Bangkok - inside the Day shift, which runs 01:00Z to 13:00Z. */
const NOW = new Date('2026-08-27T02:50:00.000Z');

describe('parseCreateDate - the two shapes the column actually holds', () => {
  // Measured over 24 h at THS: `YYYY-MM-DD HH:MM:SS` x58, `-` x226,
  // `YYYY/MM/DD HH:MM:SS` x4. Both real shapes are UTC.
  it('reads the dash-separated shape as UTC', () => {
    expect(parseCreateDate('2026-08-27 01:02:56')?.toISOString()).toBe('2026-08-27T01:02:56.000Z');
  });

  it('reads the slash-separated shape as UTC', () => {
    // THS 6338's gateway emits this one. `Date.parse` of it is
    // implementation-defined, which is why it is hand-parsed.
    expect(parseCreateDate('2026/08/26 20:00:00')?.toISOString()).toBe('2026-08-26T20:00:00.000Z');
  });

  it('treats the empty-slot markers as no date, not as a parse failure', () => {
    // 226 of 288 slot values measured. BACKEND-HANDOVER §4.5(c) read these as
    // an unparseable column; they are slots with no order in them.
    for (const empty of ['-', '', '   ', 'No Data', 'no data', null, undefined]) {
      expect(parseCreateDate(empty)).toBeNull();
    }
  });

  it('honours an explicit zone marker rather than assuming UTC', () => {
    expect(parseCreateDate('2026-08-27T08:02:56+07:00')?.toISOString()).toBe(
      '2026-08-27T01:02:56.000Z',
    );
    expect(parseCreateDate('2026-08-27 01:02:56Z')?.toISOString()).toBe('2026-08-27T01:02:56.000Z');
  });

  it('survives the panel SQL\'s space-to-%20 round trip', () => {
    // The board's SELECT does REPLACE(vCreateDateTxt, ' ', '%20') for the
    // drill-down href. We read the column raw, but a value that has been
    // through that still has to parse.
    expect(parseCreateDate('2026-08-27%2001:02:56')?.toISOString()).toBe(
      '2026-08-27T01:02:56.000Z',
    );
  });

  it('returns null for anything that is not a timestamp at all', () => {
    expect(parseCreateDate('110000965401')).toBeNull();
    expect(parseCreateDate('yesterday')).toBeNull();
  });
});

describe('orderShiftVerdict - against the site\'s own shift', () => {
  const shift = resolveShift(THS_SHIFT, NOW);

  it('resolves the shift this test rests on', () => {
    expect(shift?.startUtc.toISOString()).toBe('2026-08-27T01:00:00.000Z');
    expect(shift?.endUtc.toISOString()).toBe('2026-08-27T13:00:00.000Z');
  });

  it('calls an order created inside the current shift `current`', () => {
    // THS 6332 machine IC7, order 110000965401, on the board at 96.7%.
    expect(orderShiftVerdict(['2026-08-27 01:02:56', '-', '-', '-'], shift)).toBe('current');
  });

  it("calls the previous shift's order `ended` - the board's I5 and IC5", () => {
    // Both carry orders created 2026-08-26 13:06 UTC = 20:06 Bangkok, six
    // minutes into the night shift that has since ended. These are the two
    // machines whose exclusion moves Avg %OA from 75.2% to the board's 81.0%.
    expect(orderShiftVerdict(['2026-08-26 13:06:23', '-', '-', '-'], shift)).toBe('ended');
    expect(orderShiftVerdict(['2026-08-26 13:06:55', '-', '-', '-'], shift)).toBe('ended');
  });

  it('takes ANY slot landing in the shift as current, like the panel does', () => {
    // The panel loops cd0..cd3 and breaks on the first match. A machine that
    // loaded a second order this shift is working now, whatever slot 0 says.
    expect(orderShiftVerdict(['2026-08-26 13:06:23', '2026-08-27 01:02:56'], shift)).toBe(
      'current',
    );
  });

  it('puts a boundary order in the shift that started then, not both', () => {
    expect(orderShiftVerdict(['2026-08-27 01:00:00'], shift)).toBe('current');
    expect(orderShiftVerdict(['2026-08-27 13:00:00'], shift)).toBe('ended');
    expect(orderShiftVerdict(['2026-08-27 00:59:59'], shift)).toBe('ended');
  });

  it('says `unknown` rather than guessing when nothing can be read', () => {
    expect(orderShiftVerdict(['-', '-', '-', '-'], shift)).toBe('unknown');
    expect(orderShiftVerdict([], shift)).toBe('unknown');
  });

  it('says `unknown` when the site has no shift config', () => {
    // A company with no configured shifts cannot have its orders judged against
    // one. Dropping its machines from %OA on that basis would be a fabrication.
    expect(orderShiftVerdict(['2026-08-27 01:02:56'], null)).toBe('unknown');
  });

  it("uses the SITE's shifts, not the panel's hardcoded 08:00/20:00", () => {
    // 22:00 Tokyo on the 27th: B shift under STJ's config (14:00-22:15), which
    // the panel's two-shift split would call `Night` and date to the 27th
    // either way - but an order created at 22:20, fifteen minutes later, is C
    // shift and a different production day. DESIGN.md §9.5.
    const stj = resolveShift(STJ_SHIFT, new Date('2026-08-27T13:30:00.000Z')); // 22:30 JST -> C
    expect(stj?.code).toBe('C');
    // 22:00 JST = 13:00Z, still B - so it belongs to the shift before this one.
    expect(orderShiftVerdict(['2026-08-27 13:00:00'], stj)).toBe('ended');
    // 22:20 JST = 13:20Z, five minutes into C.
    expect(orderShiftVerdict(['2026-08-27 13:20:00'], stj)).toBe('current');
  });
});

describe('splitByOrderShift - what leaves the %OA average', () => {
  const shift = resolveShift(THS_SHIFT, NOW);

  const machine = (over: Partial<MachineOa>): MachineOa => ({
    plant: '6332',
    machine: 'I1',
    process: 'Injection',
    groupPo: 'PO',
    oaPct: 96.7,
    actualQty: 100,
    planQty: 400,
    shotCount: 100,
    poSlots: 1,
    createdRaw: ['2026-08-27 01:02:56'],
    gap: null,
    ...over,
  });

  it('separates the current shift from the ended one', () => {
    const split = splitByOrderShift(
      [
        machine({ machine: 'I1' }),
        machine({ machine: 'I5', oaPct: 40, createdRaw: ['2026-08-26 13:06:23'] }),
      ],
      shift,
    );
    expect(split.current.map((m) => m.machine)).toEqual(['I1']);
    expect(split.ended.map((m) => m.machine)).toEqual(['I5']);
    expect(split.unknown).toEqual([]);
  });

  it('keeps a machine with no order loaded in the set it was handed', () => {
    // It carries no %OA either way, so it cannot move the average - but the
    // caller's machine list must not silently shrink underneath it. This is
    // also the panel's early return: no ProductionOrder0, no shift check.
    const idle = machine({ machine: 'IA1', oaPct: null, poSlots: 0, createdRaw: [] });
    const split = splitByOrderShift([idle], shift);
    expect(split.current).toEqual([idle]);
    expect(split.ended).toEqual([]);
  });

  it('KEEPS an unreadable creation time - a named divergence from the board', () => {
    // The board blanks anything it cannot match to the current shift, so it
    // would drop this machine. Dropping data because it could not be read is
    // the fabrication rule R2 exists to forbid, so it stays and is warned about.
    // Zero occurrences on the live data.
    const split = splitByOrderShift([machine({ machine: 'I9', createdRaw: ['-'] })], shift);
    expect(split.unknown.map((m) => m.machine)).toEqual(['I9']);
    expect(split.current).toEqual([]);
  });
});
