import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi, useConfig } from '../config/AppContext';
import { usePrefs, type RefreshMs } from '../state/prefsStore';
import { assertOrCollect, checkGlobalOverview, type Violation } from '../domain/invariants';
import type { CompanyDetail, GlobalOverview, Meta, PlantDetail } from './contract';
import type { OverviewQuery, PlantQuery, ScopeQuery } from './DashboardApi';

/**
 * Polling and caching.
 *
 * TanStack Query is not here as a convenience. Two of its behaviours are the
 * literal implementation of non-functional requirements from section 14:
 *
 *   refetchInterval          -> D-14's 30-60 s refresh.
 *   data survives isError    -> "backend down: banner plus last timestamp,
 *                               NEVER show 0 or blank".
 *
 * That second one is the whole game. On failure the last successful payload
 * stays in `data` while `isError` flips, so the screen keeps showing the real
 * numbers with a banner over them instead of a wall of zeros. Writing that by
 * hand - with in-flight cancellation, retry backoff and dedup across three
 * pages - is exactly where teams ship the "shows 0" bug.
 *
 * Note what is deliberately absent: no `initialData`, and no `select` that
 * defaults anything to 0.
 */

/**
 * The interval actually in force: the viewer's pick from the refresh control,
 * falling back to the deployment's `runtime-config.json` when they have not
 * made one.
 *
 * Exported because the control itself has to show which value is in force, and
 * a control that computes that differently from the queries it drives is a
 * control that lies.
 */
export function useRefreshMs(): RefreshMs {
  const cfg = useConfig();
  const chosen = usePrefs((s) => s.refreshMs);
  return chosen === undefined ? cfg.refreshMs : chosen;
}

function baseOptions(refreshMs: RefreshMs) {
  return {
    // `false`, not 0: TanStack Query treats 0 as "as fast as possible" and
    // would hammer the API when the viewer asked for the opposite.
    refetchInterval: refreshMs ?? false,
    // A wall-mounted TV sits on an unfocused tab for weeks. Without this it
    // would quietly stop refreshing and nobody would notice until a decision
    // was made on yesterday's numbers.
    refetchIntervalInBackground: true,
    // Half the interval, so a remount inside one cycle reuses the payload
    // instead of firing an extra request. With refresh off there is no cycle to
    // halve, and the data stays fresh until something explicitly refetches.
    staleTime: refreshMs === null ? Infinity : Math.floor(refreshMs / 2),
    // Never discard the last good payload. It is what the banner is protecting.
    gcTime: Infinity,
    retry: 3,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 15_000),
    // Changing a filter must not blank the screen while the new data loads.
    placeholderData: keepPreviousData,
  } as const;
}

export function useMeta(): UseQueryResult<Meta> {
  const api = useApi();
  return useQuery({
    queryKey: ['meta'],
    queryFn: ({ signal }) => api.getMeta(signal),
    // Master data changes when a site is commissioned, not every thirty seconds.
    staleTime: 60 * 60_000,
    refetchInterval: false,
    gcTime: Infinity,
    retry: 3,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 15_000),
  });
}

export interface OverviewResult {
  query: UseQueryResult<GlobalOverview>;
  /** Integrity problems found in the payload on screen. Empty when clean. */
  violations: Violation[];
}

export function useOverview(filters: OverviewQuery): OverviewResult {
  const api = useApi();
  const refreshMs = useRefreshMs();

  const query = useQuery({
    queryKey: ['overview', filters],
    queryFn: ({ signal }) => api.getGlobalOverview(filters, signal),
    ...baseOptions(refreshMs),
  });

  const violations = query.data
    ? assertOrCollect(checkGlobalOverview(query.data), 'global-overview')
    : [];

  return { query, violations };
}

export function useCompany(company: string, filters: ScopeQuery): UseQueryResult<CompanyDetail> {
  const api = useApi();
  const refreshMs = useRefreshMs();
  return useQuery({
    queryKey: ['company', company, filters],
    queryFn: ({ signal }) => api.getCompany(company, filters, signal),
    ...baseOptions(refreshMs),
    enabled: company.length > 0,
  });
}

export function usePlant(
  company: string,
  plant: string,
  filters: PlantQuery,
): UseQueryResult<PlantDetail> {
  const api = useApi();
  const refreshMs = useRefreshMs();
  return useQuery({
    queryKey: ['plant', company, plant, filters],
    queryFn: ({ signal }) => api.getPlant(company, plant, filters, signal),
    ...baseOptions(refreshMs),
    enabled: company.length > 0 && plant.length > 0,
  });
}
