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
  zShiftConfig,
  zSiteCore,
  zTrendPoint,
} from './common';
import { zIsoOffset, zPct, zQty } from './primitives';
import { zPlantSummary } from './globalOverview';

/**
 * `GET /api/v1/companies/{company}?range=24h&process=Injection`
 *
 * The drill-down between the global map and a single plant. Its reason to exist
 * is `shift_breakdown`: it is the only place the n-shift model from section 9.5
 * becomes visible, and the only place an executive can see that STJ's B shift
 * covers 8h15m while THS's day shift covers 12h.
 */

export const zZoneSummary = zSiteCore.extend({
  code: z.string(),
  label: z.string().nullable(),
  counts: zCounts,
  kpi: zKpi,
});
export type ZoneSummary = z.infer<typeof zZoneSummary>;

export const zPlantWithZones = zPlantSummary.extend({
  /** Section 3: ASI is organised into seven zones. */
  zones: z.array(zZoneSummary),
});
export type PlantWithZones = z.infer<typeof zPlantWithZones>;

/**
 * One row of the shift breakdown table.
 *
 * `state` is what stops a half-finished shift being read as a failure: a shift
 * showing 45.9% achievement at 15:42 is on track, and one that has not started
 * shows an em-dash rather than a zero.
 */
export const zShiftBreakdown = z.object({
  shift_code: z.string(),
  shift_label: z.string(),
  index: z.number().int().positive(),
  of: z.number().int().positive(),
  state: z.enum(['complete', 'in_progress', 'not_started']),
  start_local: zIsoOffset,
  end_local: zIsoOffset,
  duration_min: z.number().positive(),
  qty_pcs: zQty,
  shot_count: zQty,
  plan_qty: zQty,
  achievement_pct: zPct,
  oa_pct: zPct,
  /** Mean machines running across the shift. Null before the shift starts. */
  running_avg: zPct,
});
export type ShiftBreakdown = z.infer<typeof zShiftBreakdown>;

export const zCompanyDetail = zPolicyBlock.extend({
  meta: zEnvelope,
  filters_applied: z.object({
    range: zRange,
    process: z.union([zProcess, z.literal('all')]),
  }),
  company: zCompanyIdentity.merge(zSiteCore).extend({
    counts: zCounts,
    kpi: zKpi,
  }),
  /** Null when this company has no agreed shift pattern. */
  shift_config: zShiftConfig.nullable(),
  shift_breakdown: z.array(zShiftBreakdown),
  plants: z.array(zPlantWithZones),
  trend: z.array(zTrendPoint),
  alerts: z.array(zAlert),
});
export type CompanyDetail = z.infer<typeof zCompanyDetail>;
