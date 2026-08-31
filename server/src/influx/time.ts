/**
 * InfluxDB returns `Timestamp(ns)` columns as ISO strings with NO zone marker,
 * e.g. `2026-08-25T02:53:54.553`. The stored instant is UTC (DESIGN.md §9.6
 * confirms the write path), but the contract's `zIsoUtc` requires the trailing
 * `Z` - and a bare string like that is parsed as *local* time by `new Date()`,
 * which is exactly the off-by-seven-hours defect primitives.ts's rule R1 exists
 * to prevent. Every timestamp crossing out of Influx goes through here.
 */
export function influxTimeToIsoUtc(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== 'string' || value === '') return null;

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
