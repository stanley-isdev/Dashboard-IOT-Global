import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import type { OverviewQuery } from '../api/DashboardApi';

/**
 * Filters live in the URL, not in a store.
 *
 * That single decision buys three things at once: every view is bookmarkable
 * and shareable, the browser Back button behaves the way an executive expects,
 * and a wall panel can be pointed at "Thailand, Injection, last 8 hours" with a
 * shortcut and no configuration screen.
 *
 * It also closes T-09 properly. Every filter is an API query parameter, so the
 * server owns the denominator; mixing client-side and server-side filtering is
 * how a KPI ends up divided by a different set than it was summed over.
 */

const zFilters = z.object({
  range: z.enum(['8h', '24h', '7d']).catch('24h'),
  /*
   * Defaults to `all`, not `Injection`. No query filters by process - THS 6332
   * runs `Injection` and `Surface` machines and the board counts both - so the
   * old default printed "Process: Injection" on a chip above numbers that
   * covered every process. See server/src/config/policy.ts.
   */
  process: z.enum(['Injection', 'Surface', 'Assembly', 'all']).catch('all'),
  region: z.string().catch('all'),
  plant: z.string().catch('all'),
});

export type Filters = OverviewQuery;

const DEFAULTS: Filters = { range: '24h', process: 'all', region: 'all', plant: 'all' };

/**
 * The one place filters are written back into a query string.
 *
 * Defaults are deleted rather than written, so the common case stays a bare
 * `/overview` - a URL somebody can read out over the phone - and only the
 * filters that actually differ show up in it.
 */
function serialize(current: Filters, next: Partial<Filters>, params: URLSearchParams): string {
  const merged = { ...current, ...next };
  const search = new URLSearchParams(params);
  for (const [key, value] of Object.entries(merged)) {
    if (value === DEFAULTS[key as keyof Filters]) search.delete(key);
    else search.set(key, String(value));
  }
  /*
   * URLSearchParams percent-encodes the comma, and RFC 3986 does not ask it to:
   * `,` is a sub-delimiter and legal in a query. `?region=TH,JP` is a URL
   * somebody can read out; `?region=TH%2CJP` is one they have to decode first,
   * and this board's whole filter design rests on the URL being the state
   * somebody shares. Only the region list contains commas, and the two forms
   * parse identically, so nothing downstream can tell the difference.
   */
  return search.toString().replaceAll('%2C', ',');
}

export function useFilters(): [Filters, (next: Partial<Filters>) => void] {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const filters = useMemo<Filters>(() => {
    // `.catch()` on each field means a hand-typed `?range=99h` falls back to the
    // default rather than throwing a contract error at the adapter.
    return zFilters.parse({
      range: params.get('range') ?? DEFAULTS.range,
      process: params.get('process') ?? DEFAULTS.process,
      region: params.get('region') ?? DEFAULTS.region,
      plant: params.get('plant') ?? DEFAULTS.plant,
    }) as Filters;
  }, [params]);

  const setFilters = useCallback(
    (next: Partial<Filters>) => {
      // `navigate` rather than `setSearchParams`, which re-serialises whatever
      // it is handed through URLSearchParams and puts the %2C back.
      //
      // replace, not push: otherwise Back walks through every chip click
      // instead of returning to the previous page.
      navigate({ pathname, search: serialize(filters, next, params) }, { replace: true });
    },
    [filters, params, navigate, pathname],
  );

  return [filters, setFilters];
}

/**
 * The same write, as a string, for a control that has to change a filter *and*
 * navigate in one step - picking a base from a drill-down page, where setting
 * the parameter on the current route and then navigating would be two history
 * entries and a render against the wrong query.
 */
export function useFilterSearch(): (next: Partial<Filters>) => string {
  const [filters] = useFilters();
  const [params] = useSearchParams();
  return useCallback((next) => serialize(filters, next, params), [filters, params]);
}

/**
 * Builds an internal link that carries the current filters.
 *
 * Every navigation in the app goes through this, which is what makes the
 * filters survive a drill-down and a Back with no state management at all.
 */
export function useLinkWithFilters(): (pathname: string) => { pathname: string; search: string } {
  const { search } = useLocation();
  return useCallback((pathname: string) => ({ pathname, search }), [search]);
}
