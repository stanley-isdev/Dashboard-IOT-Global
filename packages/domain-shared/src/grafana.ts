/**
 * Where the drill-down links point.
 *
 * Every URL here was sent by the design owner and is stored verbatim. Nothing
 * in this file builds one, and that absence is the whole design: this module
 * used to hold a `machineStatusUrl` that assembled a board URL out of a plant
 * code, a process and a zone list, and for eight of the nine sites the result
 * was a link to a dashboard that does not exist - STJ's arrow pointed at
 * `var-Lamp_var=STJ-1` on an instance that has never heard of that plant. A
 * constructed URL looks correct in a status bar and turns out wrong only after
 * the click, which is the worst way for a link to be wrong. A site gets an arrow
 * that opens something once somebody has sent a URL they have opened themselves.
 *
 * Keyed by PLANT, because every board on the other end is a plant board: its SQL
 * reads `WHERE "plant" = '${Lamp_var}'`, one plant per load. A company row
 * borrows the link of its first plant that has one, so THS's row opens 6332 -
 * the plant that is actually on the air. A plant nobody has sent a URL for
 * resolves to `null`, which the ranking draws as a dimmed arrow rather than as
 * an empty cell.
 *
 * There is no company-level board to link to, which is why this is not keyed by
 * company. `adz5fli` - which this service once handed out as
 * `/d/adz5fli?var-Company_var=THS` - is the Global V1.0 board that THIS app
 * replaces (DESIGN.md §1), and `Company_var` is not one of its variables.
 */

/**
 * The Grafana instance, as given by the design owner on 2026-08-28.
 *
 * Only `/meta` carries this - the browser prefixes relative URLs with
 * `grafanaBaseUrl` from public/config/runtime-config.json, so the two MUST
 * agree. Kept here rather than in `env.ts` because it is a fact about the site,
 * not a credential, and a wrong value is visible the moment anyone clicks.
 *
 * Every link below is absolute and so passes through untouched. The constant
 * stays because `/meta` publishes it and because the next supplied link may
 * well arrive relative.
 */
export const GRAFANA_BASE_URL = 'http://10.200.129.66:3000';

/**
 * The links, exactly as supplied. Do not tidy them.
 *
 * Their query strings differ - THS opens on `now/d` at 10s, ASI on `now-6h` at
 * 5s - and the differences are not accidents to be normalised away: each string
 * is the one that was checked against its own board. Both carry
 * `var-Zone_var=$__all`, so the board opens on the whole plant no matter which
 * zone this app's own filter row is narrowed to. That is a real loss - the
 * generated links used to carry the zones in scope - and it is the price of
 * linking only to URLs somebody has actually opened.
 *
 * ASI runs on its own instance (`10.201.128.87`) and its own board
 * (`machine-status-v1-0-asi`), which is why nothing can be shared between these
 * two entries but the shape of the object.
 */
const SUPPLIED_PLANT_LINKS: Readonly<Record<string, string>> = {
  /** THS LAMP 2, on Machine Status V2.0. */
  '6332':
    'http://10.200.129.66:3000/d/adz5fll/machine-status-v2-0?orgId=1&from=now%2Fd&to=now%2Fd&timezone=Asia%2FBangkok&var-Lamp_var=6332&var-process_var=Injection&var-Zone_var=$__all&refresh=10s',
  /** ASI's single plant, on ASI's own instance. */
  '6051':
    'http://10.201.128.87:3000/d/adz5fll/machine-status-v1-0-asi?orgId=1&from=now-6h&to=now&timezone=Asia%2FBangkok&var-Lamp_var=6051&var-process_var=Injection&var-Zone_var=$__all&refresh=5s',
};

/**
 * The board for one plant, or `null` where nobody has supplied one.
 *
 * `null` is an answer, not a failure: it means "no board yet", and the arrow
 * that draws for it is dimmed and inert rather than absent.
 */
export function plantDrilldownUrl(plantCode: string): string | null {
  return SUPPLIED_PLANT_LINKS[plantCode] ?? null;
}

/**
 * The board a company row opens: the first of its plants that has one.
 *
 * `plants` is the caller's already-filtered list, so the link follows the Lamp
 * filter rather than pointing outside what the row is counting. Order is master
 * data's, which puts THS's reporting plant (6332) first - the site's other three
 * have no link of their own, and a company row that opened one of those would
 * land on a board with nothing on it.
 */
export function companyDrilldownUrl(plants: readonly { code: string }[]): string | null {
  for (const plant of plants) {
    const url = plantDrilldownUrl(plant.code);
    if (url) return url;
  }
  return null;
}
