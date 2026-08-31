/**
 * Framework-agnostic business logic shared between the mock adapter's
 * reference implementation and the real backend server: timezone/shift
 * resolution, tier thresholds, weighted rollups, machine-status bucketing,
 * and the counts/partition invariants. Ported from src/mocks/tz.ts,
 * src/mocks/generate.ts, and src/domain/{tier,invariants,status}.ts - see the
 * backend implementation plan, Phase 0.5.
 *
 * Nothing here does randomness, I/O, or synthetic-data generation - that
 * stays mock-only (src/mocks/generate.ts) or becomes real-query logic
 * (server/src/influx/queries/*), never both from the same source.
 */
export * from './tz.ts';
export * from './shift.ts';
export * from './tier.ts';
export * from './statusBucket.ts';
export * from './rollup.ts';
export * from './invariants.ts';
export * from './grafana.ts';
