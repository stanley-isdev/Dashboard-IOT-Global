import { z } from 'zod';
import {
  zAlert,
  zCompanyIdentity,
  zCounts,
  zEnvelope,
  zKpi,
  zPolicyBlock,
  zProcess,
  zRange,
  zSiteCore,
  zTrendPoint,
} from './common';
import { zCount } from './primitives';

/**
 * `GET /api/v1/global-overview?range=24h&process=Injection&region=all`
 *
 * Section 13 of the design doc, corrected. The differences from the example
 * payload there are all cases where the example could not express something the
 * screen has to say — see the comments below and docs/DATA-CONTRACT.md.
 */

export const zPlantSummary = zSiteCore.extend({
  code: z.string(), // '6332'
  label: z.string(), // 'LAMP 2'
  /** D-07: a plant may carry its own target. Null means inherit the group value. */
  target_oa: z.number().nullable(),
  counts: zCounts,
  kpi: zKpi,
});
export type PlantSummary = z.infer<typeof zPlantSummary>;

export const zCompanySummary = zCompanyIdentity.merge(zSiteCore).extend({
  counts: zCounts,
  kpi: zKpi,
  plants: z.array(zPlantSummary),
});
export type CompanySummary = z.infer<typeof zCompanySummary>;

export const zGlobalTotals = zKpi.extend({
  counts: zCounts,
  /**
   * Both counts are sent because the mockup's KPI card is labelled "Plants
   * Needing Attention" while its code counts companies. Ship both and let the
   * exec pick which one they actually want on the strip (D-F13).
   */
  companies_needing_attention: zCount,
  plants_needing_attention: zCount,
  /**
   * Coverage. Every KPI on screen is divided by `companies_reporting`, never by
   * `companies_total`, and the tile says so. A site with no gateway must not
   * drag the group average toward zero.
   */
  companies_reporting: zCount,
  companies_total: zCount,
  countries_total: zCount,
});
export type GlobalTotals = z.infer<typeof zGlobalTotals>;

export const zFiltersApplied = z.object({
  range: zRange,
  process: z.union([zProcess, z.literal('all')]),
  region: z.string(), // 'all' | country_code | company_code
});
export type FiltersApplied = z.infer<typeof zFiltersApplied>;

export const zGlobalOverview = zPolicyBlock.extend({
  meta: zEnvelope,
  filters_applied: zFiltersApplied,
  totals: zGlobalTotals,
  companies: z.array(zCompanySummary),
  trend: z.array(zTrendPoint),
  alerts: z.array(zAlert),
});
export type GlobalOverview = z.infer<typeof zGlobalOverview>;
