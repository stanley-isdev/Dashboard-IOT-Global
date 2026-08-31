/**
 * The API contract now lives in the `@dashboard/contract` workspace package so
 * the backend server can depend on the exact same zod schemas instead of
 * re-deriving them. This file is a facade so the ~25 existing imports of
 * `from '../api/contract'` / `from './contract'` across the frontend keep
 * compiling unchanged.
 */
export * from '@dashboard/contract';
