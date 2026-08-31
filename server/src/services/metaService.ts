import type { Meta, SourceHealth } from '@dashboard/contract';
import {
  DEFAULT_LINK_PROCESS,
  GRAFANA_BASE_URL,
  machineStatusUrl,
  representativePlant,
} from '@dashboard/domain-shared';
import type { CompanyMasterData } from '../config/masterData.ts';
import { COMPANIES, COUNTRIES } from '../config/masterData.ts';
import { POLICY_BLOCK } from '../config/policy.ts';
import { buildEnvelope } from '../domain/envelope.ts';

/**
 * Pure master-data + envelope - needs no Influx/MSSQL call, matching the
 * mock's `buildMeta`.
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
export function buildMeta(sources: SourceHealth[]): Meta {
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
      readiness_note: c.readinessNote,
      shift_config: c.shiftConfig,
      plants: c.plants.map((p) => ({ code: p.code, label: p.label, target_oa: p.targetOa })),
      grafana_url: companyGrafanaUrl(c),
    })),
    processes: ['Injection'],
    ranges: ['8h', '24h', '7d'],
    grafana_base_url: GRAFANA_BASE_URL,
  };
}

/**
 * A company's link, from master data only. `null` for a site with no plants
 * yet - the rollout sites of §11 - where a link would land on an empty board
 * and `GrafanaLink` renders nothing instead.
 */
function companyGrafanaUrl(company: CompanyMasterData): string | null {
  // Nothing here knows what is reporting, so the first plant it is.
  const plant = representativePlant(company.plants, () => false);
  if (!plant) return null;
  return machineStatusUrl({
    plantCode: plant.code,
    process: DEFAULT_LINK_PROCESS,
    timezone: company.timezone,
  });
}
