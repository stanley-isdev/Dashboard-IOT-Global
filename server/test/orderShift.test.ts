import { describe, expect, it } from 'vitest';
import type { ShiftConfig } from '@dashboard/contract';
import { resolveShift } from '@dashboard/domain-shared';
import { orderShiftVerdict, parseCreateDate } from '../src/domain/orderShift.ts';
import { splitByOrderShift, type MachineOa } from '../src/domain/oa.ts';

/**
 * `Order End` layer 2 (DESIGN.md §8.4).
 *
 * **Rewritten 2026-09-08.** Every case here used to assert that a zone-less
 * `vCreateDateTxt` is UTC, on the strength of the panel's own comment. It is
 * not - it is the site's wall clock, and the 400-row measurement that settles
 * it is recorded in `parseCreateDate`. The old expectations were internally
 * consistent and uniformly seven hours wrong, which is exactly what a test
 * suite built on an unchecked assumption looks like.
 *
 * The anchor cases below are live values read out of `production_machine_io` on
 * 2026-09-08 for THS 6332, alongside each machine's status and its %OA.
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

/** Europe/Budapest, to prove the conversion is not a hardcoded +07:00. */
const SEH_SHIFT: ShiftConfig = {
  effective_from: '2026-01-01',
  timezone: 'Europe/Budapest',
  production_date_anchor: 'shift_start',
  shifts: [
    { code: 'D', label: 'Day', start: '06:00', end: '18:00' },
    { code: 'N', label: 'Night', start: '18:00', end: '06:00' },
  ],
};

const BKK = 'Asia/Bangkok';
/** 18:41 Bangkok - inside the Day shift, which runs 01:00Z to 13:00Z. */
const NOW = new Date('2026-09-08T11:41:00.000Z');

describe('parseCreateDate - a bare timestamp is the site clock, not UTC', () => {
  it('reads the dash-separated shape in the site zone', () => {
    // 01:02:56 Bangkok is 18:02:56Z the day before.
    expect(parseCreateDate('2026-09-08 01:02:56', BKK)?.toISOString()).toBe(
      '2026-09-07T18:02:56.000Z',
    );
  });

  it('reads the slash-separated shape in the site zone', () => {
    // THS 6338's gateway emits this one. `Date.parse` of it is
    // implementation-defined, which is why it is hand-parsed.
    expect(parseCreateDate('2026/09/08 13:56:00', BKK)?.toISOString()).toBe(
      '2026-09-08T06:56:00.000Z',
    );
  });

  it('keeps the seconds, which the minute-resolution converter drops', () => {
    // A boundary comparison rounded down by up to 59 s would move a machine
    // between shifts for no reason a reader could see.
    expect(parseCreateDate('2026/09/08 15:03:19', BKK)?.toISOString()).toBe(
      '2026-09-08T08:03:19.000Z',
    );
  });

  it('uses each site\'s own zone, not a constant', () => {
    // The same digits, three sites, three instants. A hardcoded +07:00 would
    // give one answer for all three and be wrong twice.
    const digits = '2026-09-08 12:00:00';
    expect(parseCreateDate(digits, BKK)?.toISOString()).toBe('2026-09-08T05:00:00.000Z');
    expect(parseCreateDate(digits, 'Asia/Tokyo')?.toISOString()).toBe('2026-09-08T03:00:00.000Z');
    // Budapest is CEST (+02:00) in September, not CET - so this also proves the
    // offset is resolved at the instant rather than taken from the zone's name.
    expect(parseCreateDate(digits, 'Europe/Budapest')?.toISOString()).toBe(
      '2026-09-08T10:00:00.000Z',
    );
  });

  it('resolves a winter date in the same zone to the other offset', () => {
    // CET (+01:00) in January. The conversion has to be date-dependent or every
    // European site is an hour out for half the year.
    expect(parseCreateDate('2026-01-15 12:00:00', 'Europe/Budapest')?.toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
  });

  it('treats the empty-slot markers as no date, not as a parse failure', () => {
    // 226 of 288 slot values measured. BACKEND-HANDOVER §4.5(c) read these as
    // an unparseable column; they are slots with no order in them.
    for (const empty of ['-', '', '   ', 'No Data', 'no data', null, undefined]) {
      expect(parseCreateDate(empty, BKK)).toBeNull();
    }
  });

  it('honours an explicit zone marker rather than applying the site zone', () => {
    // A value that says what it means is believed, and must NOT be shifted
    // again by the site's offset.
    expect(parseCreateDate('2026-09-08T08:02:56+07:00', BKK)?.toISOString()).toBe(
      '2026-09-08T01:02:56.000Z',
    );
    expect(parseCreateDate('2026-09-08 01:02:56Z', BKK)?.toISOString()).toBe(
      '2026-09-08T01:02:56.000Z',
    );
  });

  it("survives the panel SQL's space-to-%20 round trip", () => {
    // The board's SELECT does REPLACE(vCreateDateTxt, ' ', '%20') for the
    // drill-down href. We read the column raw, but a value that has been
    // through that still has to parse.
    expect(parseCreateDate('2026-09-08%2001:02:56', BKK)?.toISOString()).toBe(
      '2026-09-07T18:02:56.000Z',
    );
  });

  it('returns null for anything that is not a timestamp at all', () => {
    expect(parseCreateDate('110000965401', BKK)).toBeNull();
    expect(parseCreateDate('yesterday', BKK)).toBeNull();
  });
});

describe("orderShiftVerdict - against the site's own shift", () => {
  const shift = resolveShift(THS_SHIFT, NOW);

  it('resolves the shift this test rests on', () => {
    expect(shift?.startUtc.toISOString()).toBe('2026-09-08T01:00:00.000Z');
    expect(shift?.endUtc.toISOString()).toBe('2026-09-08T13:00:00.000Z');
    expect(shift?.timeZone).toBe(BKK);
  });

  /*
   * The regression that motivated the fix. Under the UTC reading these two came
   * out `ended` - 13:56 and 15:03 parsed as 13:56Z and 15:03Z, both past the
   * 13:00Z close - so the rule meant to catch the OLDEST orders was catching the
   * newest ones. Both machines were `Mass Pro` and mid-cycle at the time, and
   * their exclusion is what lifted THS's %OA to the panel's 88.9% over a true
   * 83.3%.
   */
  it('calls this afternoon\'s order `current` - IA1 and P1I8', () => {
    expect(orderShiftVerdict(['2026/09/08 13:56:00', '-', '-', '-'], shift)).toBe('current');
    expect(orderShiftVerdict(['2026/09/08 15:03:19', '-', '-', '-'], shift)).toBe('current');
  });

  it("calls an order from before this shift `ended`", () => {
    // IA1's fourth PO group of the day, created 05:09 Bangkok - three hours
    // before the day shift opened, and finished by 00:59Z. Genuinely over.
    expect(orderShiftVerdict(['2026/09/08 05:09:41', '-', '-', '-'], shift)).toBe('ended');
    // And the night before.
    expect(orderShiftVerdict(['2026/09/07 22:25:59', '-', '-', '-'], shift)).toBe('ended');
  });

  it('takes ANY slot landing in the shift as current, like the panel does', () => {
    // The panel loops cd0..cd3 and breaks on the first match. A machine that
    // loaded a second order this shift is working now, whatever slot 0 says.
    expect(orderShiftVerdict(['2026/09/08 05:09:41', '2026/09/08 13:56:00'], shift)).toBe(
      'current',
    );
  });

  it('puts a boundary order in the shift that started then, not both', () => {
    // Half-open [08:00, 20:00) in Bangkok terms.
    expect(orderShiftVerdict(['2026-09-08 08:00:00'], shift)).toBe('current');
    expect(orderShiftVerdict(['2026-09-08 20:00:00'], shift)).toBe('ended');
    expect(orderShiftVerdict(['2026-09-08 07:59:59'], shift)).toBe('ended');
  });

  it('says `unknown` rather than guessing when nothing can be read', () => {
    expect(orderShiftVerdict(['-', '-', '-', '-'], shift)).toBe('unknown');
    expect(orderShiftVerdict([], shift)).toBe('unknown');
  });

  it('says `unknown` when the site has no shift config', () => {
    // A company with no configured shifts cannot have its orders judged against
    // one. Dropping its machines from %OA on that basis would be a fabrication.
    expect(orderShiftVerdict(['2026-09-08 09:02:56'], null)).toBe('unknown');
  });

  it("uses the SITE's shifts and the SITE's clock, not a hardcoded pair", () => {
    // 22:30 Tokyo is C shift under STJ's config (22:15-06:00); the panel's
    // two-shift split cannot express that boundary at all. DESIGN.md §9.5.
    const stj = resolveShift(STJ_SHIFT, new Date('2026-09-08T13:30:00.000Z'));
    expect(stj?.code).toBe('C');
    expect(stj?.timeZone).toBe('Asia/Tokyo');
    // 22:00 JST - fifteen minutes short of C, so it belongs to B, which is over.
    expect(orderShiftVerdict(['2026-09-08 22:00:00'], stj)).toBe('ended');
    // 22:20 JST - five minutes into C.
    expect(orderShiftVerdict(['2026-09-08 22:20:00'], stj)).toBe('current');
  });

  it('judges a DST site correctly, which a fixed offset could not', () => {
    // 10:00 Budapest on a September morning = 08:00Z, inside a 06:00-18:00 local
    // day shift (04:00Z-16:00Z). Read as UTC it would be 10:00Z - still inside,
    // and so a case the old code passed by luck. 05:00 local is the one that
    // separates them: 03:00Z, an hour before the shift opens.
    const seh = resolveShift(SEH_SHIFT, new Date('2026-09-08T08:00:00.000Z'));
    expect(seh?.code).toBe('D');
    expect(orderShiftVerdict(['2026-09-08 10:00:00'], seh)).toBe('current');
    expect(orderShiftVerdict(['2026-09-08 05:00:00'], seh)).toBe('ended');
  });
});

/*
 * Nothing leaves the %OA average on this verdict any more (design owner,
 * 2026-09-08) - `globalOverviewService` feeds every group to `averageOa` and
 * uses the split only to name the carried-over machines. These tests still own
 * the classification itself, which has to stay correct for that sentence to be
 * worth printing; whether it removes anything is asserted end to end in
 * globalOverview.test.ts.
 */
describe('splitByOrderShift - the verdict, which is now reported and not applied', () => {
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
    createdRaw: ['2026/09/08 13:56:00'],
    gap: null,
    ...over,
  });

  it('separates the current shift from the ended one', () => {
    const split = splitByOrderShift(
      [
        machine({ machine: 'IA1' }),
        machine({ machine: 'I5', oaPct: 40, createdRaw: ['2026/09/07 22:25:59'] }),
      ],
      shift,
    );
    expect(split.current.map((m) => m.machine)).toEqual(['IA1']);
    expect(split.ended.map((m) => m.machine)).toEqual(['I5']);
    expect(split.unknown).toEqual([]);
  });

  it('keeps a machine with no order loaded in the set it was handed', () => {
    // It carries no %OA either way, so it cannot move the average - but the
    // caller's machine list must not silently shrink underneath it. This is
    // also the panel's early return: no ProductionOrder0, no shift check.
    const idle = machine({ machine: 'I2', oaPct: null, poSlots: 0, createdRaw: [] });
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
