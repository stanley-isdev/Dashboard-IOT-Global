import type { RuntimeConfig } from '../config/runtimeConfig';
import type { DashboardApi } from './DashboardApi';

/**
 * Chooses the adapter at runtime.
 *
 * The dynamic import is deliberate: Vite code-splits the mock adapter and the
 * whole master-data generator into a chunk that a production build never
 * fetches. We get a switch that works after deploy, at no production cost.
 */
export async function createApi(cfg: RuntimeConfig): Promise<DashboardApi> {
  if (cfg.dataSource === 'mock') {
    const { createMockAdapter } = await import('../mocks/mockAdapter');
    return createMockAdapter(cfg);
  }
  const { createHttpAdapter } = await import('./httpAdapter');
  return createHttpAdapter(cfg);
}
