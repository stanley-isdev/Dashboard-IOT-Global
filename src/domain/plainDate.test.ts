import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  compare,
  daysInMonth,
  isBetween,
  isInMonth,
  monthGrid,
  partsOf,
  toPlain,
  todayIn,
  weekdayOf,
} from './plainDate';

describe('plain date arithmetic', () => {
  it('pads to ten characters', () => {
    expect(toPlain(2026, 9, 2)).toBe('2026-09-02');
    expect(partsOf('2026-09-02')).toEqual({ year: 2026, month: 9, day: 2 });
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    // 2024 is a leap year; 2026 is not.
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  /*
   * The reason this module works in UTC at all. Thailand has no DST, but the
   * fleet spans Hungary, Mexico and the USA, and a local-midnight Date in a
   * zone that springs forward at 00:00 returns the *previous* day when asked
   * for the next one. These two dates straddle the EU and US transitions.
   */
  it('does not drift across a DST transition', () => {
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU spring forward
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US fall back
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24'); // EU fall back
  });

  it('clamps month steps instead of rolling over', () => {
    expect(addMonths(2026, 1, 1)).toEqual({ year: 2026, month: 2 });
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 9, -13)).toEqual({ year: 2025, month: 8 });
  });

  it('knows month lengths', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('compares as calendar order', () => {
    expect(compare('2026-09-02', '2026-09-10')).toBe(-1);
    expect(compare('2026-09-10', '2026-09-02')).toBe(1);
    expect(compare('2026-09-02', '2026-09-02')).toBe(0);
  });

  it('treats a range as inclusive and unordered', () => {
    expect(isBetween('2026-09-05', '2026-09-01', '2026-09-10')).toBe(true);
    expect(isBetween('2026-09-05', '2026-09-10', '2026-09-01')).toBe(true);
    expect(isBetween('2026-09-01', '2026-09-01', '2026-09-10')).toBe(true);
    expect(isBetween('2026-09-11', '2026-09-01', '2026-09-10')).toBe(false);
  });
});

describe('monthGrid', () => {
  it('is always six weeks, whatever the month', () => {
    for (const month of [1, 2, 9, 12]) {
      expect(monthGrid(2026, month, 1)).toHaveLength(42);
    }
  });

  it('starts on the requested weekday', () => {
    // 1 September 2026 is a Tuesday.
    expect(weekdayOf('2026-09-01')).toBe(2);
    expect(monthGrid(2026, 9, 1)[0]).toBe('2026-08-31'); // Monday before
    expect(monthGrid(2026, 9, 0)[0]).toBe('2026-08-30'); // Sunday before
  });

  it('contains every day of the month exactly once', () => {
    const grid = monthGrid(2026, 9, 1);
    const own = grid.filter((d) => isInMonth(d, 2026, 9));
    expect(own).toHaveLength(30);
    expect(new Set(own).size).toBe(30);
    expect(own[0]).toBe('2026-09-01');
    expect(own[29]).toBe('2026-09-30');
  });

  it('leads with the whole first week when the month starts on the week start', () => {
    // 1 June 2026 is a Monday, so a Monday-first grid needs no lead padding.
    expect(weekdayOf('2026-06-01')).toBe(1);
    expect(monthGrid(2026, 6, 1)[0]).toBe('2026-06-01');
  });
});

describe('todayIn', () => {
  /*
   * The zone is the point of the function: one instant is two different dates
   * depending on where it is read. 2026-09-02T18:30Z is already the 3rd in
   * Bangkok and still the 2nd in Mexico City.
   */
  it('reads one instant as the local calendar date', () => {
    const at = new Date('2026-09-02T18:30:00Z');
    expect(todayIn('Asia/Bangkok', at)).toBe('2026-09-03');
    expect(todayIn('Europe/Budapest', at)).toBe('2026-09-02');
    expect(todayIn('America/Mexico_City', at)).toBe('2026-09-02');
    expect(todayIn('UTC', at)).toBe('2026-09-02');
  });

  it('returns Gregorian years, not Buddhist ones', () => {
    // The trap i18n/format.ts exists to close: th-TH defaults to ca-buddhist,
    // which would make this 2569.
    expect(todayIn('Asia/Bangkok', new Date('2026-01-15T04:00:00Z'))).toBe('2026-01-15');
  });
});
