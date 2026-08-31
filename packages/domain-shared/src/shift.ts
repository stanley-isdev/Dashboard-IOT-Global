import type { Shift, ShiftConfig } from '@dashboard/contract';
import { clockToMinutes, minutesOfDay, toIsoOffset, toPlainDate, zonedParts, zonedToUtc } from './tz.ts';

/**
 * Ported from src/mocks/generate.ts's `resolveShift`, parameterized on a
 * `ShiftConfig` directly instead of the mock's `CompanySeed` - this is the
 * logic the frontend must never contain (design doc section 7), and now the
 * real backend's single implementation of it. Handles the two cases the old
 * hour-bucketed queries get wrong: a shift boundary that is not on the hour
 * (STJ B ends 22:15) and a shift that crosses midnight (STJ C).
 */
export interface ResolvedShift extends Shift {
  startUtc: Date;
  endUtc: Date;
}

export function resolveShift(shiftConfig: ShiftConfig | null, now: Date): ResolvedShift | null {
  const cfg = shiftConfig;
  if (!cfg) return null;

  const tz = cfg.timezone;
  const nowMin = minutesOfDay(now, tz);

  const idx = cfg.shifts.findIndex((s) => {
    const start = clockToMinutes(s.start);
    const end = clockToMinutes(s.end);
    return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
  });
  if (idx < 0) return null;

  const s = cfg.shifts[idx];
  const start = clockToMinutes(s.start);
  const end = clockToMinutes(s.end);
  const crossesMidnight = start >= end;

  // When the shift crosses midnight and we are past midnight, it began yesterday.
  const startedYesterday = crossesMidnight && nowMin < end;
  const today = zonedParts(now, tz);

  const startDay = startedYesterday
    ? zonedParts(new Date(now.getTime() - 86_400_000), tz)
    : { ...today };
  const startUtc = zonedToUtc(
    {
      ...startDay,
      hour: Math.floor(start / 60),
      minute: start % 60,
    },
    tz,
  );

  const endBase = crossesMidnight && !startedYesterday ? new Date(now.getTime() + 86_400_000) : now;
  const endDay = zonedParts(endBase, tz);
  const endUtc = zonedToUtc({ ...endDay, hour: Math.floor(end / 60), minute: end % 60 }, tz);

  // Section 9.5 point 4: the production date is anchored, not assumed to be
  // "today". STJ's C shift starts at 22:15 and belongs to the day it began on.
  const anchorInstant = cfg.production_date_anchor === 'shift_start' ? startUtc : endUtc;

  return {
    code: s.code,
    label: s.label,
    index: idx + 1,
    of: cfg.shifts.length,
    start_local: toIsoOffset(startUtc, tz),
    end_local: toIsoOffset(endUtc, tz),
    production_date: toPlainDate(anchorInstant, tz),
    startUtc,
    endUtc,
  };
}

/** Strips the internal UTC instants before a `ResolvedShift` goes on the wire as a `Shift`. */
export function stripInternals(s: ResolvedShift): Shift {
  const { startUtc: _s, endUtc: _e, ...rest } = s;
  void _s;
  void _e;
  return rest;
}
