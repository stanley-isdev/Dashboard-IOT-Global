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

function buildUrl(
  base: string,
  path: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const qs = new URLSearchParams(
    Object.entries(params)
      /*
       * A null parameter is left OFF the query rather than sent as the string
       * "null". The absolute window's `from`/`to` are null whenever the reader
       * is on a quick range, which is most of the time, and `?from=null` would
       * reach the server's `zPlainDate` as a malformed date - a 400 on the
       * common path.
       */
      .filter((entry): entry is [string, string | number] => entry[1] != null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
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
      throw new ApiError('timeout', `No response within ${timeoutMs} ms`, {
        detail: url,
        timeoutMs,
      });
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

/**
 * Whether this request makes the server ASSEMBLE a window out of several
 * InfluxDB queries, rather than answer it from the snapshot it already holds.
 *
 * Which decides the timeout, and nothing else. `8h` and `24h` are one query on
 * the server (or none - `24h` is the poller's own window), so they belong under
 * the tight `requestTimeoutMs` where silence means a fault. `7d` is three
 * queries, and a calendar pair is up to twenty-eight days of them run one after
 * another; those genuinely take ten seconds or more and the client must not
 * call a correct answer a timeout while it is still arriving.
 *
 * Kept as a rule about the REQUEST rather than read off `/meta`'s
 * `max_query_hours`, because it has to hold for the very first request, before
 * any meta has landed - see `chunksFor` in TimeRangePicker.tsx, which duplicates
 * the server's chunk arithmetic for the same reason.
 */
function needsAssembly(q: { range?: string; from?: string | null; to?: string | null }): boolean {
  if (q.from && q.to) return true;
  return q.range === '7d';
}

export function createHttpAdapter(cfg: RuntimeConfig): DashboardApi {
  const t = cfg.requestTimeoutMs;
  /** The timeout for a window the server has to assemble - see `needsAssembly`. */
  const tw = Math.max(cfg.windowedRequestTimeoutMs, t);
  return {
    getMeta: (signal) => request(buildUrl(cfg.apiBaseUrl, 'meta', {}), zMeta, t, signal),

    getGlobalOverview: (q: OverviewQuery, signal) =>
      request(
        buildUrl(cfg.apiBaseUrl, 'global-overview', { ...q }),
        zGlobalOverview,
        needsAssembly(q) ? tw : t,
        signal,
      ),

    getCompany: (company: string, q: ScopeQuery, signal) =>
      request(
        buildUrl(cfg.apiBaseUrl, `companies/${encodeURIComponent(company)}`, { ...q }),
        zCompanyDetail,
        needsAssembly(q) ? tw : t,
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
        needsAssembly(q) ? tw : t,
        signal,
      ),
  };
}
