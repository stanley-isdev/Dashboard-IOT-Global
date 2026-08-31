/**
 * Where the drill-down links point.
 *
 * There is exactly one board this app links out to: `Machine Status V2.0`
 * (docs/grafana/MACHINE-STATUS-V2.md), UID `adz5fll`. Everything built here is
 * a *plant* link, because that board is a plant board - its SQL reads
 * `WHERE "plant" = '${Lamp_var}'` (§4.2), one plant per load.
 *
 * That is also why a company row cannot link to "the company's board": no
 * company-level Grafana view exists. `adz5fli` - which the mock and this
 * service used to hand out as `/d/adz5fli?var-Company_var=THS` - is the Global
 * V1.0 board that THIS app replaces (DESIGN.md §1), not a drill-down target,
 * and `Company_var` is not one of its variables. Every such link resolved to a
 * dashboard that ignored the parameter. A company now links to one of its own
 * plants instead; see `representativePlant`.
 */
import type { Process } from '@dashboard/contract';

/**
 * The Grafana instance, as given by the design owner on 2026-08-28.
 *
 * Only `/meta` carries this - the browser prefixes relative URLs with
 * `grafanaBaseUrl` from public/config/runtime-config.json, so the two MUST
 * agree. Kept here rather than in `env.ts` because it is a fact about the site,
 * not a credential, and a wrong value is visible the moment anyone clicks.
 */
export const GRAFANA_BASE_URL = 'http://10.200.129.66:3000';

/**
 * UID plus slug. Grafana resolves on the UID alone and redirects a stale slug,
 * so the slug is only there to make a pasted link readable.
 */
const DASHBOARD_PATH = '/d/adz5fll/machine-status-v1-0-0';

/**
 * `${process_var}` for a link built while the board's own Process filter says
 * `all`.
 *
 * The exec board deliberately counts every process (config/policy.ts); the
 * drill-down has to pick one, because its SQL compares `"process"` to a single
 * value. `Injection` is what it opens on, and the only process in
 * `Meta.processes` today.
 */
export const DEFAULT_LINK_PROCESS: Process = 'Injection';

export interface MachineStatusLink {
  /** `${Lamp_var}` - the plant code, e.g. `6332`. */
  plantCode: string;
  /** `${process_var}`. One value: the board cannot show two. */
  process: Process;
  /** The dashboard's time zone, so "today" means today at the plant, not here. */
  timezone: string;
  /**
   * `${Zone_var}`, one entry per zone, or empty to leave the board on whatever
   * its own default is.
   *
   * Passed explicitly because zone values are plant-specific, so no single
   * default is right for two plants. Measured on 2026-08-28: plant `6051` uses
   * `A`-`F`, `6338` uses `A`, and `6332` uses `2A-A`, `2A-B`, `2A-C`, `2B-A`,
   * `2B-B`. The link the design owner sent carried `var-Zone_var=A` against
   * `var-Lamp_var=6332` - a combination that matches no row, so the board opens
   * empty. Sending the zones the plant actually reports is what makes a click
   * land on data.
   */
  zones?: string[];
}

/**
 * A link into the plant board, opened on today in the plant's own time zone -
 * the range the board itself defaults to, and the one its %OA cards are
 * computed over.
 */
export function machineStatusUrl(link: MachineStatusLink): string {
  const params: [string, string][] = [
    ['orgId', '1'],
    ['from', 'now/d'],
    ['to', 'now/d'],
    ['timezone', link.timezone],
    ['var-Lamp_var', link.plantCode],
    ['var-process_var', link.process],
  ];

  // Multi-value: the panel's `zone IN (${Zone_var:singlequote})` takes the whole
  // list, and Grafana reads a repeated key as a multi-select.
  for (const zone of link.zones ?? []) params.push(['var-Zone_var', zone]);

  // Last, the way Grafana writes it itself. The board refreshes on its own
  // clock once opened; ours stops mattering the moment the tab changes.
  params.push(['refresh', '10s']);

  return `${DASHBOARD_PATH}?${params.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`;
}

/*
 * Percent-encoding minus the slash, which is legal unencoded in a query string
 * (RFC 3986) and which Grafana leaves alone in its own links. Keeps
 * `from=now/d&timezone=Asia/Bangkok` readable in a status bar and identical to
 * a URL copied out of Grafana, which is what anyone will compare it against.
 *
 * Hand-rolled rather than `URLSearchParams`: this package compiles against
 * ES2023 with no DOM lib, and the mock adapter, the server and any future
 * Node script all have to agree on one implementation.
 */
const enc = (value: string) => encodeURIComponent(value).replace(/%2F/g, '/');

/**
 * Which plant a company-level link opens.
 *
 * The first plant that is actually reporting, because a link that lands on an
 * empty board reads as "the drill-down is broken" rather than "this plant is
 * quiet" - at THS that is `6332`, the only one of its four with machines on the
 * air. Falls back to the first plant in master data so a company that has gone
 * entirely silent still has somewhere to go, and to `null` for a site with no
 * plants at all (SEH, VNS, ISE and the rest of §11's rollout), where
 * `GrafanaLink` then renders nothing.
 *
 * `plants` is the caller's already-filtered list, so the link follows the Lamp
 * filter rather than pointing outside what the row is counting.
 */
export function representativePlant<T extends { code: string }>(
  plants: readonly T[],
  isReporting: (plantCode: string) => boolean,
): T | null {
  return plants.find((p) => isReporting(p.code)) ?? plants[0] ?? null;
}
