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
} from './common.ts';
import { zCount, zIsoUtc, zPlainDate } from './primitives.ts';

/**
 * `GET /api/v1/global-overview?range=24h&process=Injection&region=all`
 *
 * Section 13 of the design doc, corrected. The differences from the example
 * payload there are all cases where the example could not express something the
 * screen has to say - see the comments below and docs/DATA-CONTRACT.md.
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
  // 'all', or a comma-separated list of country and/or company codes. See
  // region.ts, which owns the encoding and the matcher both sides use.
  region: z.string(),
  /**
   * 'all', or a comma-separated list of PLANT codes - the Lamp picker.
   *
   * One level below `region`, and the two intersect. It exists so this board can
   * be put side by side with the per-plant operator boards, which are scoped by
   * `Lamp_var`: without it, "THS 30" and "Lamp 2: 29" look like a disagreement
   * when they are two different questions. See plantMatcher in region.ts.
   */
  plant: z.string(),
  /**
   * 'all', 'none', or a comma-separated list of ZONE tags - the Zone picker,
   * one level below `plant` and encoded the same way.
   *
   * A zone tag is plant-local and the tags collide across plants (`A` exists at
   * both 6051 and 6338), so this parameter means what `${Zone_var}` means on the
   * operator board: the named zones, inside whatever plant scope is in force.
   * With `plant=all` that is every plant reporting a zone of that name, which is
   * the honest reading of a flat list and the only one a URL this short can
   * carry. Narrow the Lamp filter to make it exact.
   */
  zone: z.string(),
  /**
   * The absolute window's ends, as the calendar picked them: plain calendar
   * days in the fleet's reference zone, or null for "use `range`".
   *
   * Days rather than instants because that is what the control offers - a
   * two-click month grid with no time-of-day field - and an ISO instant here
   * would imply a precision the reader was never given a way to express. The
   * server resolves them against the reference zone and reports what it
   * actually queried on `window` below.
   *
   * `range` is still required and still echoed when these are set: it is what
   * the capsule prints, and what the board falls back to if the pair is
   * rejected. When they are set they win, and `window.source` says which.
   */
  from: zPlainDate.nullable().optional(),
  to: zPlainDate.nullable().optional(),
  /**
   * How many rows `alerts` was cut to.
   *
   * The ceiling the client asked for, which is not the Top-N the reader has
   * picked: the board requests the widest cut its picker offers and does the
   * final slice itself, so that one control does not refetch the whole payload.
   * A consumer wanting the number on screen has to look at the client's own
   * state, not here; what this field is good for is knowing whether `alerts`
   * ends where the stops ended or where the cut fell.
   *
   * Optional so a `FiltersApplied` built by hand (tests, the mock's narrower
   * callers) need not invent a value; the server always sends one, defaulted in
   * the route's query schema.
   */
  alertsLimit: z.number().int().positive().optional(),
});
export type FiltersApplied = z.infer<typeof zFiltersApplied>;

/**
 * The window the numbers in this payload were actually measured over.
 *
 * Separate from `filters_applied` on purpose: that block echoes what was
 * *asked* for, this one states what was *served*, and the two can legitimately
 * differ. A pick reaching past retention is clamped rather than refused, and a
 * board that narrowed the reader's window without saying so is the failure
 * this whole contract is written against.
 *
 * Every field is required. An optional window would let a payload omit the one
 * fact that makes its own numbers interpretable.
 */
export const zServedWindow = z.object({
  /** Inclusive start of the measured window, UTC. */
  from: zIsoUtc,
  /** Exclusive end, UTC. `now` for a range-anchored window. */
  to: zIsoUtc,
  /** `to - from` in hours. What the trend's bucket count is drawn from. */
  hours: z.number().positive(),
  /**
   * Which control produced it - the quick-range list, or the calendar.
   *
   * Read by the UI rather than inferred from `filters_applied.from`: a
   * rejected absolute pair falls back to `range`, and the picker has to show
   * the quick range as the live one when that happens.
   */
  source: z.enum(['range', 'absolute']),
  /**
   * How many InfluxDB queries the window was split into - see
   * MAX_WINDOW_HOURS in server/src/influx/queries.ts: one query cannot scan
   * more than ~71 h of this table before the file-scan cap rejects it.
   *
   * On the payload rather than in a log because it is the cost of the reader's
   * own pick. Nine queries for a seven-day window is why that window is slower
   * than the default one, and a support question about it should be answerable
   * from the response.
   */
  chunks: z.number().int().positive(),
  /**
   * True when the served window is narrower than the one asked for - the pick
   * reached past what the database still holds. The UI says so beside the
   * capsule; it never silently redraws.
   */
  clamped: z.boolean(),
});
export type ServedWindow = z.infer<typeof zServedWindow>;

export const zGlobalOverview = zPolicyBlock.extend({
  meta: zEnvelope,
  filters_applied: zFiltersApplied,
  /** What the numbers below were measured over - see zServedWindow. */
  window: zServedWindow,
  totals: zGlobalTotals,
  companies: z.array(zCompanySummary),
  trend: z.array(zTrendPoint),
  alerts: z.array(zAlert),
});
export type GlobalOverview = z.infer<typeof zGlobalOverview>;
