import type { RuntimeConfig } from '../config/runtimeConfig';
import { ApiError } from '../api/ApiError';
import type { DashboardApi, OverviewQuery, PlantQuery, ScopeQuery } from '../api/DashboardApi';
import { buildCompanyDetail, buildGlobalOverview, buildMeta, buildPlantDetail } from './generate';
import { parseScenario, type Scenario } from './scenarios';

/**
 * The mock adapter.
 *
 * Deliberately an adapter rather than a service worker (MSW): this way the
 * switch survives a production build, so IS can ship a demo or UAT build with
 * `npm run build:mock` that needs no backend at all. A service worker cannot do
 * that.
 *
 * Latency is simulated so loading states actually get exercised during
 * development, and `generated_at` advances on every call so the live badge
 * visibly ticks in a demo.
 */

const LATENCY_MIN = 250;
const LATENCY_MAX = 800;

function currentScenario(): Scenario {
  if (typeof window === 'undefined') return 'default';
  return parseScenario(new URLSearchParams(window.location.search).get('scenario'));
}

function delay(signal?: AbortSignal): Promise<void> {
  const ms = LATENCY_MIN + Math.random() * (LATENCY_MAX - LATENCY_MIN);
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function gate(signal?: AbortSignal): Promise<Scenario> {
  await delay(signal);
  const scenario = currentScenario();
  if (scenario === 'backend-down') {
    throw new ApiError('network', 'Mock backend is unreachable (scenario=backend-down)');
  }
  return scenario;
}

export function createMockAdapter(_cfg: RuntimeConfig): DashboardApi {
  void _cfg;
  return {
    async getMeta(signal) {
      await gate(signal);
      return buildMeta(new Date());
    },

    async getGlobalOverview(q: OverviewQuery, signal) {
      const scenario = await gate(signal);
      return buildGlobalOverview(new Date(), scenario, q);
    },

    async getCompany(company: string, q: ScopeQuery, signal) {
      const scenario = await gate(signal);
      const payload = buildCompanyDetail(company, new Date(), scenario, q);
      if (!payload) {
        throw new ApiError('notfound', `No such company: ${company}`);
      }
      return payload;
    },

    async getPlant(company: string, plant: string, q: PlantQuery, signal) {
      const scenario = await gate(signal);
      const payload = buildPlantDetail(company, plant, new Date(), scenario, q);
      if (!payload) {
        throw new ApiError('notfound', `No such plant: ${company}/${plant}`);
      }
      return payload;
    },
  };
}
