import { z } from 'zod';
import type { RuntimeConfig } from '../config/runtimeConfig';
import { ApiError } from './ApiError';
import type { DashboardApi, OverviewQuery, PlantQuery, ScopeQuery } from './DashboardApi';
import { zCompanyDetail, zGlobalOverview, zMeta, zPlantDetail } from './contract';

/**
 * The real HTTP adapter. Every response is validated against the contract
 * before it reaches a component - that validation is what makes the "front end
 * holds no business logic" promise checkable rather than aspirational.
 */

function buildUrl(base: string, path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  const sep = base.endsWith('/') ? '' : '/';
  return `${base}${sep}${path}${qs ? `?${qs}` : ''}`;
}

async function request<T extends z.ZodType>(
  url: string,
  schema: T,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      // `credentials: include` from day one so that when SSO lands (D-08) it is
      // a server-side change rather than a front-end release.
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError') {
      throw new ApiError('timeout', `No response within ${timeoutMs} ms`, { detail: url });
    }
    // A caller-driven abort (navigation, refetch) is not a failure to report.
    if (e.name === 'AbortError') throw e;
    throw new ApiError('network', e.message, { detail: url });
  }

  if (res.status === 401) {
    throw new ApiError('unauthorized', 'Not signed in', { status: 401, detail: url });
  }
  if (res.status === 404) {
    throw new ApiError('notfound', 'Not found', { status: 404, detail: url });
  }
  if (!res.ok) {
    throw new ApiError('http', `HTTP ${res.status}`, { status: res.status, detail: url });
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('contract', 'Response was not JSON', { detail: url });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('contract', 'Response did not match the agreed contract', {
      detail: z.prettifyError(parsed.error),
    });
  }
  return parsed.data;
}

export function createHttpAdapter(cfg: RuntimeConfig): DashboardApi {
  const t = cfg.requestTimeoutMs;
  return {
    getMeta: (signal) => request(buildUrl(cfg.apiBaseUrl, 'meta', {}), zMeta, t, signal),

    getGlobalOverview: (q: OverviewQuery, signal) =>
      request(buildUrl(cfg.apiBaseUrl, 'global-overview', { ...q }), zGlobalOverview, t, signal),

    getCompany: (company: string, q: ScopeQuery, signal) =>
      request(
        buildUrl(cfg.apiBaseUrl, `companies/${encodeURIComponent(company)}`, { ...q }),
        zCompanyDetail,
        t,
        signal,
      ),

    getPlant: (company: string, plant: string, q: PlantQuery, signal) =>
      request(
        buildUrl(
          cfg.apiBaseUrl,
          `companies/${encodeURIComponent(company)}/plants/${encodeURIComponent(plant)}`,
          { ...q },
        ),
        zPlantDetail,
        t,
        signal,
      ),
  };
}
