import type { RuntimeConfig } from '../config/runtimeConfig';
import type { DashboardApi } from './DashboardApi';

/**
 * Builds the data adapter.
 *
 * There is one adapter now. This used to choose between a generated dataset and
 * the real API on `cfg.dataSource`, and the generator went when the backend
 * grew the two endpoints it was standing in for - see server/src/routes/scope.ts.
 *
 * Keeping it was worse than deleting it. The generator answered
 * `/companies/{code}` and `/companies/{code}/plants/{code}` while the real
 * server did not, so a demo build could show two pages that a production build
 * could not - and it echoed `filters_applied.process` back without ever
 * filtering by it, which is a payload claiming a scope it had not applied. That
 * is the one thing every other line of this codebase is written to prevent, and
 * a second implementation of the contract is where it will always creep back
 * in.
 *
 * Still an async factory, and still dynamically imported. The adapter pulls in
 * the whole zod contract, and keeping it off the entry chunk is what lets the
 * shell paint before the first payload is parsed.
 */
export async function createApi(cfg: RuntimeConfig): Promise<DashboardApi> {
  const { createHttpAdapter } = await import('./httpAdapter');
  return createHttpAdapter(cfg);
}
