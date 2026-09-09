import { z } from 'zod';
import { zDataReadiness, zEnvelope, zPolicyBlock, zProcess, zRange, zShiftConfig } from './common.ts';
import { zCountryCode, zIanaTz, zPlainDate } from './primitives.ts';

/**
 * `GET /api/v1/meta`
 *
 * Master data, long-cached. Not in the design doc's section 13, but the screen
 * cannot be built without it:
 *
 *  - The map has to show all nine bases even when six of them send no telemetry
 *    at all (section 11). Deriving the pin list from the data window would make
 *    unconnected sites vanish, which is the opposite of what section 11 asks for.
 *  - The Region filter needs the country -> company tree independent of whatever
 *    time range is currently selected.
 *  - Shift configuration belongs here, not on every response.
 */

export const zCompanyMeta = z.object({
  code: z.string(),
  name: z.string(),
  name_th: z.string().nullable(),
  country_code: zCountryCode,
  lat: z.number(),
  lng: z.number(),
  timezone: zIanaTz,
  /**
   * Turns the section 11 readiness matrix into something the legend can state
   * plainly - "3 live · 1 installing · 5 planned" - instead of implying nine
   * equivalent pins.
   */
  data_readiness: zDataReadiness,
  /** Free text for the ranking table's not-reporting group, e.g. "16 machines, phase 2". */
  readiness_note: z.string().nullable(),
  /** Null when no shift pattern has been agreed for this site yet. */
  shift_config: zShiftConfig.nullable(),
  plants: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      target_oa: z.number().nullable(),
      /**
       * Whether any telemetry from this plant has ever reached the backend,
       * over the full retained history.
       *
       * `/meta` stays the complete roster - it is master data, and a roster
       * that quietly drops rows lies about what exists. This flag lets each
       * reader decide instead: the board hides never-reported plants, and the
       * plant picker hides them too, because offering a filter that can only
       * ever produce an empty screen is not a choice, it is a dead end.
       *
       * `true` while the probe has not answered, deliberately. Uncertainty must
       * not make a plant disappear from the picker - only a definite "never".
       */
      ever_reported: z.boolean(),
      /**
       * The zone tags this plant is actually reporting, sorted, or empty while
       * it is silent.
       *
       * The one field here that is NOT master data. Nobody maintains a zone
       * list: `zone` is a tag on the machine rows, plant-specific and with no
       * pattern across plants - measured 2026-08-28, `6051` reports `A`-`F`,
       * `6338` reports `A`, and `6332` reports `2A-A`, `2A-B`, `2A-C`,
       * `2B-A`, `2B-B`. A hand-kept list would be wrong the first time a line
       * moved, so the server reads it off the same snapshot the census does.
       *
       * It rides on /meta rather than on /global-overview because the Zone
       * picker sits in the filter row beside Region, Lamp and Process, and all
       * four have to know their choices before any board has loaded. The cost is
       * that a newly-tagged zone appears one /meta refresh late, which for a
       * physical plant layout is not a cost at all.
       */
      zones: z.array(z.string()),
    }),
  ),
  grafana_url: z.string().nullable(),
});
export type CompanyMeta = z.infer<typeof zCompanyMeta>;

/**
 * What the time picker is allowed to ask for, published rather than hardcoded
 * at the front end.
 *
 * `ranges` above has always been served for this reason - a fourth quick window
 * appears the day the backend publishes one - and the calendar beside it needs
 * the same treatment for a stronger reason: its bounds are properties of the
 * *database*, not of the product. Retention moves, and a `min` compiled into
 * the bundle would let a reader pick a fortnight the instance threw away last
 * night and get an empty board with no explanation.
 */
export const zWindowLimits = z.object({
  /**
   * The oldest day the calendar may offer, in the reference zone.
   *
   * Measured, not configured: the poller probes how far back the table still
   * answers. On 2026-09-03 that was 28 days - a single-day query at 28 days
   * returned 1,127 rows and at 29 days returned none.
   */
  earliest_date: zPlainDate,
  /**
   * The widest window ONE InfluxDB query may scan, in hours.
   *
   * Not a limit on what the reader may pick - wider picks are split into
   * several queries (see zServedWindow.chunks) - but the size of the piece, and
   * therefore what a seven-day board costs. ~71 h on this instance: at 96 h a
   * query is rejected with `Query would scan 432 Parquet files, exceeding the
   * file limit`.
   */
  max_query_hours: z.number().int().positive(),
  /**
   * The widest window the server will assemble at all, in hours.
   *
   * A ceiling on the chunk count, so a hand-written `?from=2020-01-01` cannot
   * ask the instance for four hundred sequential queries.
   */
  max_window_hours: z.number().int().positive(),
});
export type WindowLimits = z.infer<typeof zWindowLimits>;

export const zMeta = zPolicyBlock.extend({
  meta: zEnvelope,
  /**
   * i18n key for the %OA disclaimer (D-19). Lives in the payload so the wording
   * can be corrected without a front-end release once the naming is settled.
   */
  oa_definition_key: z.string(),
  countries: z.array(
    z.object({
      code: zCountryCode,
      name: z.string(),
      name_th: z.string().nullable(),
    }),
  ),
  companies: z.array(zCompanyMeta),
  processes: z.array(zProcess),
  ranges: z.array(zRange),
  /** Bounds for the absolute half of the time picker - see zWindowLimits. */
  window_limits: zWindowLimits,
  grafana_base_url: z.string(),
});
export type Meta = z.infer<typeof zMeta>;
