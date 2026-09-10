import type { Meta, Process, SourceHealth } from '@dashboard/contract';
import { zProcess } from '@dashboard/contract';
import { companyDrilldownUrl, GRAFANA_BASE_URL } from '@dashboard/domain-shared';
import { toPlainDate } from '@dashboard/domain-shared';
import { MAX_ASSEMBLED_HOURS, MAX_WINDOW_HOURS, RETENTION_DAYS } from '../influx/queries.ts';
import type { CompanyMasterData } from '../config/masterData.ts';
import type { LiveSnapshot } from './liveSnapshot.ts';
import { COMPANIES, COUNTRIES } from '../config/masterData.ts';
import { POLICY_BLOCK } from '../config/policy.ts';
import { buildEnvelope } from '../domain/envelope.ts';

/**
 * Master data + envelope + one thing read off the snapshot: the zone tags each
 * plant is reporting.
 *
 * It was pure master data until the Zone filter needed choices. Nobody keeps a
 * zone list anywhere - `zone` is a tag on the machine rows and its values are
 * plant-local (`6051`: `A`-`F`; `6332`: `2A-A` and friends) - so the only
 * honest source is the same poll the census reads. This does not make the route
 * expensive: the poller already holds the snapshot in memory and nothing here
 * queries Influx.
 *
 * The `/d/adz5fli?var-Company_var=...` links this used to hand out are gone,
 * **settled 2026-08-28**: `adz5fli` is the Global V1.0 board this app replaces
 * (DESIGN.md §1), it has no `Company_var`, and every one of those links opened
 * a dashboard that ignored the parameter. Companies now link into the plant
 * board like everything else - see @dashboard/domain-shared’s grafana.ts.
 *
 * Unlike /global-overview this has no snapshot to read, so the link is built
 * from master data alone: the first plant, and no `Zone_var`. /global-overview
 * knows which plant is on the air and which zones it reports, and its links are
 * the ones the board actually renders.
 */
export function buildMeta(
  sources: SourceHealth[],
  snapshot: LiveSnapshot,
  /** The zone the picker's calendar draws in - env.REFERENCE_TIMEZONE. */
  referenceTimezone = 'Asia/Bangkok',
  now: Date = new Date(),
): Meta {
  /**
   * The zone tags a plant has rows for, sorted and de-duplicated, over every
   * process. Not narrowed to `DEFAULT_LINK_PROCESS` the way the drill-down
   * link's zone list is: this one is the Zone picker's menu, and a menu that
   * hid the zones of a plant's `Surface` machines would be the disabled-chip
   * defect one level down.
   *
   * Empty for a plant that is silent, which is what makes the picker fall back
   * to being disabled rather than offering a scope with nothing behind it.
   */
  const zonesOf = (plantCode: string): string[] => {
    const zones = new Set<string>();
    for (const m of snapshot.machines[plantCode] ?? []) if (m.zone) zones.add(m.zone);
    return [...zones].sort();
  };

  /**
   * Every process tag in play right now, across all plants, in contract order.
   *
   * Was the constant `['Injection']`, which made the Process picker a relabelled
   * disabled chip - THS 6332 runs 26 `Injection` machines and 3 `Surface`
   * (`AF2`, `BP6`, `HC2`, measured 2026-08-27) and the menu never offered the
   * second scope. `process` is a machine-row tag exactly like `zone`, so the
   * honest source is the same snapshot the census reads, not a hand-kept list.
   *
   * Intersected with `zProcess` rather than passed through raw: a value outside
   * the enum would fail `respondValidated(zMeta, ...)` and take the whole route
   * down - the same guard `unknownStatuses` gives machine status one level over.
   * Iterating the enum keeps the order fixed (`Injection`, `Surface`,
   * `Assembly`) regardless of which plant reported first.
   *
   * Falls back to `['Injection']` while the poller is cold or Influx is down, so
   * an outage narrows the menu to the default scope instead of disabling it.
   */
  const processesInPlay = (): Process[] => {
    const seen = new Set<string>();
    for (const list of Object.values(snapshot.machines)) {
      for (const m of list) if (m.process) seen.add(m.process);
    }
    const known = zProcess.options.filter((p) => seen.has(p));
    return known.length > 0 ? known : ['Injection'];
  };

  return {
    ...POLICY_BLOCK,
    meta: buildEnvelope({ sources }),
    oa_definition_key: 'kpi.oa.definition',
    countries: COUNTRIES,
    companies: COMPANIES.map((c) => ({
      code: c.code,
      name: c.name,
      name_th: c.nameTh,
      country_code: c.countryCode,
      lat: c.lat,
      lng: c.lng,
      timezone: c.timezone,
      data_readiness: c.readiness,
      readiness_note: c.absence?.reason ?? null,
      shift_config: c.shiftConfig,
      plants: c.plants.map((p) => ({
        code: p.code,
        label: p.label,
        target_oa: p.targetOa,
        // Only a definite `'no'` counts as never-reported. `'unknown'` - the
        // probe has not landed, or has been failing - must read as `true`, or a
        // brief Influx outage would empty the plant picker.
        ever_reported: (snapshot.everSeen[p.code] ?? 'unknown') !== 'no',
        zones: zonesOf(p.code),
      })),
      grafana_url: companyGrafanaUrl(c),
    })),
    processes: processesInPlay(),
    ranges: ['8h', '24h', '7d'],
    /*
     * The calendar's bounds, served rather than compiled into the bundle.
     *
     * `earliest_date` is a rolling floor: retention on this instance is ~28
     * days (measured 2026-09-03 - a single-day query 28 days back returned
     * 1,127 rows and 29 days back returned none), so the oldest selectable day
     * moves every midnight. A `min` baked into the front end would go on
     * offering a fortnight the instance quietly dropped last night, and the
     * reader would get an empty board with nothing to explain it.
     */
    window_limits: {
      earliest_date: toPlainDate(
        new Date(now.getTime() - RETENTION_DAYS * 86_400_000),
        referenceTimezone,
      ),
      max_query_hours: MAX_WINDOW_HOURS,
      max_window_hours: MAX_ASSEMBLED_HOURS,
    },
    grafana_base_url: GRAFANA_BASE_URL,
  };
}

/**
 * A company's link, from master data only. `null` for a site with no plants
 * yet - the rollout sites of §11 - and for every site whose link nobody has
 * supplied, which `companyDrilldownUrl` decides. `GrafanaLink` draws a dimmed
 * arrow for a `null`, so the column reads "no board yet" rather than skipping
 * the row.
 */
function companyGrafanaUrl(company: CompanyMasterData): string | null {
  return companyDrilldownUrl(company.plants);
}
