import type { Counts, MachineStatus } from '@dashboard/contract';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A census for a site that reports nothing. Every bucket is zero, not absent. */
export function emptyCounts(): Counts {
  return {
    total: 0,
    by_status: {
      'Mass Pro': 0,
      Dandori: 0,
      Stop: 0,
      '4M Change': 0,
      'No Plan': 0,
      'Order End': 0,
      Offline: 0,
      Pending: 0,
      Alarm: 0,
      Warning: 0,
    },
    not_counted: {
      'Mass Pro': 0,
      Dandori: 0,
      Stop: 0,
      '4M Change': 0,
      'No Plan': 0,
      'Order End': 0,
      Offline: 0,
      Pending: 0,
      Alarm: 0,
      Warning: 0,
    },
    running: 0,
    stopped: 0,
    idle: 0,
    other: 0,
    no_data: 0,
  };
}

export function addCounts(list: Counts[]): Counts {
  const base = emptyCounts();
  for (const c of list) {
    base.total += c.total;
    base.running += c.running;
    base.stopped += c.stopped;
    base.idle += c.idle;
    base.other += c.other;
    base.no_data += c.no_data;
    for (const [k, v] of Object.entries(c.by_status) as [MachineStatus, number][]) {
      base.by_status[k] = (base.by_status[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(c.not_counted) as [MachineStatus, number][]) {
      base.not_counted[k] = (base.not_counted[k] ?? 0) + v;
    }
  }
  return base;
}

/**
 * Roll-up, weighted by actual output (D-20). Ported verbatim from
 * src/mocks/generate.ts - this is the single function called at every level
 * (PO→machine→plant→company→global) so a 21-machine plant never carries the
 * same weight as a 2-machine one.
 *
 * Returns null rather than falling back to a simple average when the
 * weighting denominator is zero, so the affected row reads as "not
 * applicable" rather than silently switching aggregation methods.
 */
export function rollupOa(parts: { oa: number | null; weight: number | null }[]): number | null {
  const usable = parts.filter((p) => p.oa !== null && p.weight !== null && p.weight > 0);
  const weight = usable.reduce((a, p) => a + (p.weight as number), 0);
  if (weight === 0) return null;
  const sum = usable.reduce((a, p) => a + (p.oa as number) * (p.weight as number), 0);
  return round1(sum / weight);
}

export function sumOrNull(values: (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v !== null);
  return usable.length === 0 ? null : usable.reduce((a, b) => a + b, 0);
}
