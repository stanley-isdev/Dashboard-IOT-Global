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

/** The choices the Top-N picker offers, and the only values `alertsLimit` accepts. */
export const ALERT_LIMIT_CHOICES = [5, 10, 20, 50] as const;

/**
 * The widest of those, and the number the board actually asks the server for.
 *
 * `alertsLimit` is the one filter that is not sent as picked. Every other one
 * changes what the payload is *about* - a different region is a different
 * denominator, and T-09 is the note above about why that has to be the
 * server's arithmetic and not ours. Top-N changes nothing about the payload:
 * the server ranks the open stops by duration and cuts the tail off, so Top 10
 * is the first ten rows of Top 50 and there is no figure anywhere on the board
 * that moves when the cut moves.
 *
 * Sending it as picked made the whole board pay for that. `alertsLimit` sat in
 * the overview query key, so choosing Top 20 was a fresh `/global-overview`
 * that re-fetched the KPI strip, the map, the ranking and the trend to change
 * the length of one list. See useOverview, which pins this value, and
 * OverviewPage, which does the cut.
 */
export const ALERT_LIMIT_MAX = Math.max(...ALERT_LIMIT_CHOICES);

const zFilters = z.object({
  range: z.enum(['8h', '24h', '7d']).catch('24h'),
  /*
   * The calendar's two ends, in the URL like every other filter - so a window
   * an executive picked is a link they can send, which is the whole reason the
   * filters live here rather than in a store.
   *
   * `.catch(null)` on a shape check rather than a real date parse: a malformed
   * `?from=yesterday` falls back to the quick range instead of throwing at the
   * adapter, and the server re-validates and re-clamps whatever does get sent.
   * Nothing here tries to decide whether the day exists in the data - that is
   * a fact about the database, and it is answered by `/meta`'s window_limits.
   */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  /*
   * Defaults to `all`, not `Injection`. No query filters by process - THS 6332
   * runs `Injection` and `Surface` machines and the board counts both - so the
   * old default printed "Process: Injection" on a chip above numbers that
   * covered every process. See server/src/config/policy.ts.
   */
  process: z.enum(['Injection', 'Surface', 'Assembly', 'all']).catch('all'),
  region: z.string().catch('all'),
  plant: z.string().catch('all'),
  /*
   * The Top-N picker beside the longest-active-stops panel title. A closed
   * set rather than a free number, so a hand-typed `?alertsLimit=99999` falls
   * back to the default instead of asking the server to sort and slice an
   * unbounded list.
   */
  alertsLimit: z.coerce
    .number()
    .catch(10)
    .transform((n) => (ALERT_LIMIT_CHOICES.includes(n as (typeof ALERT_LIMIT_CHOICES)[number]) ? n : 10)),
});

export type Filters = OverviewQuery;

const DEFAULTS: Filters = {
  range: '24h',
  from: null,
  to: null,
  process: 'all',
  region: 'all',
  plant: 'all',
  alertsLimit: 10,
};

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
    /* `null` is how the absolute window says "not picked", and it has to be
       DELETED rather than written: `String(null)` is the literal "null", which
       would ride in the URL and reach the server as a malformed date. It is
       also already the default, but checking it explicitly keeps that true if
       a future default is ever something other than null. */
    if (value === null || value === undefined || value === DEFAULTS[key as keyof Filters]) {
      search.delete(key);
    } else search.set(key, String(value));
  }
  /*
   * URLSearchParams percent-encodes the comma, and RFC 3986 does not ask it to:
   * `,` is a sub-delimiter and legal in a query. `?region=TH,JP` is a URL
   * somebody can read out; `?region=TH%2CJP` is one they have to decode first,
   * and this board's whole filter design rests on the URL being the state
   * somebody shares. The region and plant lists are the ones that carry
   * commas, and the two forms parse identically, so nothing downstream can
   * tell the difference.
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
      from: params.get('from'),
      to: params.get('to'),
      process: params.get('process') ?? DEFAULTS.process,
      region: params.get('region') ?? DEFAULTS.region,
      plant: params.get('plant') ?? DEFAULTS.plant,
      alertsLimit: params.get('alertsLimit') ?? String(DEFAULTS.alertsLimit),
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
