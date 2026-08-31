/**
 * The API contract, expressed as zod schemas.
 *
 * Why schemas rather than plain TypeScript interfaces: the backend does not
 * exist yet and will be written by someone else, and this application's core
 * promise - that it contains no business logic - holds only if the payload
 * really matches what was agreed. A schema makes section 13 of the design doc
 * executable. It derives every TypeScript type via `z.infer` so there is one
 * source of truth and no drift, it lets a unit test prove the mock fixtures are
 * legal payloads, and when the backend does drift it produces
 *
 *   contract error: totals.oa_pct - expected number|null, received string
 *
 * instead of a blank screen at 08:15 on a Monday.
 *
 * This package is shared between the frontend (via `src/api/contract`, which
 * now just re-exports it) and the backend server, so both sides validate
 * against the exact same schemas - a contract mismatch is a build-time or
 * boot-time failure, never a silent runtime drift.
 */
export * from './primitives.ts';
export * from './common.ts';
export * from './region.ts';
export * from './meta.ts';
export * from './globalOverview.ts';
export * from './companyDetail.ts';
export * from './plantDetail.ts';
