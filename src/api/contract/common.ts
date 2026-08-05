import { z } from 'zod';
import {
  zClockTime,
  zCount,
  zCountryCode,
  zIanaTz,
  zIsoOffset,
  zIsoUtc,
  zPct,
  zPlainDate,
  zQty,
} from './primitives';

/* ------------------------------------------------------------------ enums */

/**
 * Reporting state of a site (company, plant, zone or machine).
 *
 * The design doc's section 13 example only ever shows `"online"`, but section 11
 * needs three distinct non-online meanings and conflating them is the single
 * highest-severity defect this project can ship: an executive who sees "6 sites
 * stopped" will escalate to plant managers who do not have a gateway yet.
 *
 *   online         telemetry is current
 *   stale          was reporting, has gone quiet past the backend's threshold
 *   degraded       some children report, some do not (ASI today, once its
 *                  second plant is wired)
 *   no_data        connected, but nothing in the selected window — a holiday,
 *                  or a machine with no production order
 *   not_connected  no IoT gateway commissioned yet (section 11). SEH is mid
 *                  installation on 16 machines; VNS has no date. Those are
 *                  different facts and demand different executive responses.
 */
export const zSiteStatus = z.enum(['online', 'stale', 'degraded', 'no_data', 'not_connected']);
export type SiteStatus = z.infer<typeof zSiteStatus>;

/** How far along a site is in the rollout, so the map legend can say what it means. */
export const zDataReadiness = z.enum(['live', 'installing', 'planned', 'unknown']);
export type DataReadiness = z.infer<typeof zDataReadiness>;

/**
 * Machine status, verbatim from section 8.4 of the design doc.
 *
 * `Order End` is derived, not stored: the old dashboard sets it in SQL when
 * `global_machine_seq > 1` and then *again* in afterRender JavaScript when
 * `vCreateDateTxt` does not match the current shift. Both layers must be
 * reimplemented server-side or the Running/Stopped counts will not reconcile
 * with Grafana (section 16 DoD).
 *
 * `Offline` appears in the old CSS and legend but no code path ever produces
 * it. Here it is a real value the backend may send.
 */
export const zMachineStatus = z.enum([
  'Mass Pro',
  'Dandori',
  'Stop',
  '4M Change',
  'No Plan',
  'Order End',
  'Offline',
]);
export type MachineStatus = z.infer<typeof zMachineStatus>;

/**
 * Presentation bucket for a machine status. The backend decides which bucket a
 * status falls into so that D-21 (is `4M Change` running or stopped?) is a
 * server-side config change, not a front-end deploy.
 *
 * `other` exists precisely so an undecided or newly-added status has somewhere
 * truthful to go. A status the UI does not recognise lands there with its raw
 * label — the display stops being complete but never becomes wrong.
 */
export const zStatusBucket = z.enum(['running', 'stopped', 'idle', 'other', 'no_data']);
export type StatusBucket = z.infer<typeof zStatusBucket>;

export const zSeverity = z.enum(['critical', 'major', 'minor', 'info']);
export type Severity = z.infer<typeof zSeverity>;

export const zAlertCategory = z.enum([
  'hardware',
  'material',
  'quality',
  'telemetry',
  'process',
  'other',
]);

/** Section 2: Injection first; the DB already carries Surface and Assembly for phase 3. */
export const zProcess = z.enum(['Injection', 'Surface', 'Assembly']);
export type Process = z.infer<typeof zProcess>;

export const zRange = z.enum(['8h', '24h', '7d']);
export type Range = z.infer<typeof zRange>;

/**
 * How a roll-up %OA was produced (D-20). This travels with the number because
 * two people quoting different global figures from the same data, with no way
 * to tell why, destroys trust in the whole dashboard.
 */
export const zOaAggregation = z.enum(['simple_avg', 'weighted_by_qty', 'weighted_by_time']);
export type OaAggregation = z.infer<typeof zOaAggregation>;

/**
 * Section 8.5 warns that Shot and Pcs get swapped. Shot = COUNT(cavity),
 * Pcs = SUM(qty), and they are never interchangeable. The unit is explicit in
 * the payload and rendered inside the value, never inferred from context.
 */
export const zQtyUnit = z.enum(['pcs', 'shots']);

/** Colour tier for a %OA value. Resolved by the backend — see zTierPolicy. */
export const zTier = z.enum(['good', 'warn', 'critical', 'unknown']);
export type Tier = z.infer<typeof zTier>;

/* -------------------------------------------------------------- policies */

/**
 * The colour rule, shipped from the API instead of hardcoded in the front end.
 *
 * This is what actually closes D-16. Today the web app mockup uses
 * `TARGET_OA-5 / TARGET_OA-20` (90/75 at target 95) while the Grafana panels
 * hardcode 95/80, so the same plant can be amber on one screen and green on
 * another. Two constants in two codebases is the bug; one served value that
 * both read is the fix.
 */
export const zTierPolicy = z.object({
  id: z.string(),
  mode: z.enum(['relative_to_target', 'absolute']),
  target_oa: z.number(),
  good_at: z.number(),
  warn_at: z.number(),
});
export type TierPolicy = z.infer<typeof zTierPolicy>;

/**
 * Freshness thresholds. The front end must never decide "stale" by comparing
 * `last_seen` to `Date.now()` — that is business logic, and the acceptable
 * silence differs by site. The backend owns the decision and sets `status`;
 * these values exist so the UI can word the banner and, if the payload itself
 * stops advancing, refuse to keep calling it live.
 */
export const zFreshness = z.object({
  stale_after_sec: z.number().int().positive(),
  no_data_after_sec: z.number().int().positive(),
  trend_stale_after_sec: z.number().int().positive(),
});
export type Freshness = z.infer<typeof zFreshness>;

/* ----------------------------------------------------------------- shift */

/**
 * One shift, already resolved for the site's timezone and production date.
 *
 * `index` and `of` matter more than they look: "B Shift" is meaningless across
 * sites unless the reader knows STJ runs three shifts and THS runs two, one
 * covering 8h15m and the other 12h. Rendering `B Shift (2 of 3)` is what makes
 * a cross-site comparison honest.
 *
 * `end_local` may be earlier than `start_local` — STJ's C shift runs 22:15 to
 * 06:00. The backend has already resolved which calendar day each bound falls
 * on, so the UI never does date arithmetic.
 */
export const zShift = z.object({
  code: z.string(),
  label: z.string(),
  index: z.number().int().positive(),
  of: z.number().int().positive(),
  start_local: zIsoOffset,
  end_local: zIsoOffset,
  production_date: zPlainDate,
});
export type Shift = z.infer<typeof zShift>;

/** The n-shift configuration model from section 9.5, per company. */
export const zShiftConfig = z.object({
  effective_from: zPlainDate,
  timezone: zIanaTz,
  production_date_anchor: z.enum(['shift_start', 'shift_end']),
  shifts: z
    .array(
      z.object({
        code: z.string(),
        label: z.string(),
        start: zClockTime,
        end: zClockTime,
      }),
    )
    .min(1),
});
export type ShiftConfig = z.infer<typeof zShiftConfig>;

/* ---------------------------------------------------------------- counts */

/**
 * A machine census that adds up.
 *
 * The mockup computes `machines = run + stop`, which silently drops No Plan,
 * Order End, 4M Change and Offline. Total Machines then under-reports and
 * Running% is divided by the wrong denominator — exactly the trap section 10
 * flags as Q-08. `by_status` is the source of truth and
 * `sum(by_status) === total` is asserted at runtime.
 */
export const zCounts = z.object({
  total: zCount,
  by_status: z.record(zMachineStatus, zCount),
  /** Bucket roll-ups for the headline tiles. Derived from by_status server-side. */
  running: zCount,
  stopped: zCount,
  idle: zCount,
  other: zCount,
  no_data: zCount,
});
export type Counts = z.infer<typeof zCounts>;

/* ------------------------------------------------------------------- kpi */

/**
 * The metric block that appears at every level of the hierarchy — global,
 * company, plant, zone, machine — so one set of components renders all of them.
 */
export const zKpi = z.object({
  oa_pct: zPct,
  oa_tier: zTier,
  achievement_pct: zPct,
  plan_qty: zQty,
  actual_qty: zQty,
  shot_count: zQty,
  /**
   * D-18: defect comes from MSSQL on a different cadence to Influx and is not
   * on the exec view yet. Optional so it can appear later with no UI change.
   */
  defect_qty: zQty.optional(),
  defect_pct: zPct.optional(),
  wfa_kg: zQty.optional(),
});
export type Kpi = z.infer<typeof zKpi>;

/* ----------------------------------------------------------------- trend */

export const zTrendPoint = z.object({
  ts: zIsoUtc,
  oa_pct: zPct,
  /**
   * How many sites fed this point. When SEH comes online the line will jump
   * because the *denominator* changed, not because performance did. Without
   * this the chart cannot tell the reader that.
   */
  site_count: zCount,
});
export type TrendPoint = z.infer<typeof zTrendPoint>;

/* ---------------------------------------------------------------- alerts */

export const zAlert = z.object({
  /** Absent from section 13. Needed for a stable React key and future acknowledgement. */
  id: z.string(),
  company: z.string(),
  plant: z.string().nullable(),
  zone: z.string().nullable(),
  machine: z.string().nullable(),
  /** Stable key for translation, e.g. `stop.heater_failure`. */
  reason_code: z.string(),
  /** Human fallback when the UI has no translation for reason_code. */
  reason: z.string(),
  severity: zSeverity,
  category: zAlertCategory,
  started_at: zIsoUtc,
  duration_sec: z.number().int().nonnegative(),
  production_order: z.string().nullable(),
  part_name: z.string().nullable(),
  /**
   * Role and team only — never a person's name. The mockup hardcodes
   * "Contact: Pi Surapoj" (T-08), and this dashboard is destined for a screen
   * in a factory corridor.
   */
  owner: z
    .object({
      role: z.string(),
      team: z.string().nullable(),
    })
    .nullable(),
  grafana_url: z.string().nullable(),
});
export type Alert = z.infer<typeof zAlert>;

/* -------------------------------------------------------------- envelope */

export const zSourceHealth = z.object({
  name: z.enum(['influxdb', 'mssql']),
  status: z.enum(['ok', 'degraded', 'down']),
  last_success: zIsoUtc.nullable(),
  message: z.string().nullable().optional(),
});

/**
 * Present on every response. Health rides along with the data rather than
 * living on a separate /health endpoint: one fewer round trip, and it can never
 * describe a different payload than the one on screen.
 */
export const zEnvelope = z.object({
  api_version: z.literal('v1'),
  generated_at: zIsoUtc,
  /** Section 7: the backend caches 30-60 s. The UI shows the true age, not the fetch time. */
  cache_age_sec: z.number().int().nonnegative().optional(),
  /** True when a source failed and the numbers are incomplete. Drives the amber banner. */
  partial: z.boolean(),
  warnings: z.array(z.string()),
  sources: z.array(zSourceHealth),
  build_id: z.string().optional(),
});
export type Envelope = z.infer<typeof zEnvelope>;

/**
 * Fields every endpoint repeats so a page can render standalone without also
 * having fetched /meta.
 */
export const zPolicyBlock = z.object({
  target_oa: z.number(),
  tier_policy: zTierPolicy,
  oa_aggregation: zOaAggregation,
  freshness: zFreshness,
  qty_unit: zQtyUnit,
});

/* ----------------------------------------------------------- site basics */

/** Identity and reporting state shared by company / plant / zone rows. */
export const zSiteCore = z.object({
  status: zSiteStatus,
  data_readiness: zDataReadiness,
  last_seen: zIsoUtc.nullable(),
  grafana_url: z.string().nullable(),
});

export const zCompanyIdentity = z.object({
  code: z.string(),
  name: z.string(),
  name_th: z.string().nullable(),
  country_code: zCountryCode,
  lat: z.number(),
  lng: z.number(),
  timezone: zIanaTz,
  /** Current instant rendered in the site's own zone, for the header clock. */
  local_time: zIsoOffset,
  /** Null when no shift pattern has been configured. Never defaulted to two shifts. */
  shift: zShift.nullable(),
});
