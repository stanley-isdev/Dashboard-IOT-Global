/**
 * The API contract, expressed as zod schemas.
 *
 * Why schemas rather than plain TypeScript interfaces: the backend does not
 * exist yet and will be written by someone else, and this application's core
 * promise — that it contains no business logic — holds only if the payload
 * really matches what was agreed. A schema makes section 13 of the design doc
 * executable. It derives every TypeScript type via `z.infer` so there is one
 * source of truth and no drift, it lets a unit test prove the mock fixtures are
 * legal payloads, and when the backend does drift it produces
 *
 *   contract error: totals.oa_pct — expected number|null, received string
 *
 * instead of a blank screen at 08:15 on a Monday.
 *
 * Generate docs/DATA-CONTRACT.md from these and hand it to the backend author
 * on day one, together with the fixtures in src/mocks/fixtures. That pair is
 * the highest-leverage artifact in the project: it lets the API be built and
 * tested against a fixed target while the UI is still being written.
 */
export * from './primitives';
export * from './common';
export * from './meta';
export * from './globalOverview';
export * from './companyDetail';
export * from './plantDetail';
