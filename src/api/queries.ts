import { useMemo } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi, useConfig } from '../config/AppContext';
import { usePrefs, type RefreshMs } from '../state/prefsStore';
import { ALERT_LIMIT_MAX } from '../state/useFilters';
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

/**
 * How many automatic attempts a failing query makes before it gives up and
 * waits for the next poll.
 *
 * Named rather than inlined because the state page prints it - "attempt 2 of 3"
 * - and a UI that reads that number from a different constant than the query
 * uses is a UI that lies about what the board is doing.
 */
export const RETRY_LIMIT = 3;

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
    retry: RETRY_LIMIT,
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
    retry: RETRY_LIMIT,
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

  /*
   * The Top-N picker is deliberately not part of what is asked for or cached.
   *
   * The board always requests the widest cut the picker offers and the alerts
   * panel shows the first N of what comes back. That keeps `alertsLimit` out of
   * the query key, which is the point: it is the only filter that changes
   * nothing about the payload except the length of one list, and while it was
   * in the key, picking Top 20 discarded the cached board and refetched the KPI
   * strip, the map, the ranking and the trend along with it. `keepPreviousData`
   * meant the reader did not see a blank screen, but they did watch every panel
   * re-render - and wait on the network - to lengthen a list that was already
   * on their machine.
   *
   * The rows are still the server's. It ranks the open stops by duration and
   * this end only stops reading; nothing here re-sorts, re-scopes or recomputes
   * anything, so the T-09 rule that the server owns every denominator is intact.
   * The cost is a payload carrying up to 50 alert rows instead of 10, which is
   * a few kilobytes off a snapshot the server already holds in memory.
   */
  const served = { ...filters, alertsLimit: ALERT_LIMIT_MAX };

  const query = useQuery({
    queryKey: ['overview', served],
    queryFn: ({ signal }) => api.getGlobalOverview(served, signal),
    ...baseOptions(refreshMs),
  });

  /*
   * Memoised on the payload rather than recomputed per render.
   *
   * The board carries a one-second clock - the ranking's local times are its
   * proof of life - so this page re-renders about sixty times a minute between
   * polls. Unmemoised, every one of those walked the whole payload: nine
   * companies, their machine census and every alert row, re-checked against
   * arithmetic that cannot have moved, because it is the same object being
   * checked. The reference only changes when a fetch resolves, which is exactly
   * how often these have anything new to say.
   */
  const violations = useMemo(
    () => (query.data ? assertOrCollect(checkGlobalOverview(query.data), 'global-overview') : []),
    [query.data],
  );

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

/**
 * What the board is doing about a failure, for the error page to say out loud.
 *
 * Without this the state page could only report that something had failed, and
 * "failed" and "failed, and we are on attempt three of three" are different
 * facts to somebody deciding whether to go and restart a service.
 *
 * What is deliberately NOT here is a countdown to the next attempt. TanStack
 * Query does not publish when it has scheduled one, so any number this end put
 * on screen would be reconstructed from `retryDelay` and hope - and a
 * fabricated figure is the one thing this board does not ship, whether it is a
 * machine count or a timer.
 */
export interface RetryState {
  /** Consecutive failures so far. 0 while the first attempt is still in flight. */
  attempt: number;
  /** How many attempts are made before automatic retrying stops. */
  limit: number;
  /** True while an attempt is in flight right now. */
  inFlight: boolean;
  /** Epoch ms of the most recent failure, or 0 when there has not been one. */
  failedAt: number;
  /**
   * The poll interval that will eventually retry this on its own, or null when
   * the viewer has turned refresh off - in which case nothing will, and the
   * page has to say so rather than promising a recovery that never comes.
   */
  autoMs: number | null;
}

export function useRetryState(
  query: Pick<UseQueryResult, 'failureCount' | 'isFetching' | 'errorUpdatedAt'>,
): RetryState {
  const refreshMs = useRefreshMs();
  return {
    attempt: query.failureCount,
    limit: RETRY_LIMIT,
    inFlight: query.isFetching,
    failedAt: query.errorUpdatedAt,
    autoMs: refreshMs,
  };
}
