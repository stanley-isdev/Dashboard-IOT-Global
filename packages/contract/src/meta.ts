import { z } from 'zod';
import { zDataReadiness, zEnvelope, zPolicyBlock, zProcess, zRange, zShiftConfig } from './common.ts';
import { zCountryCode, zIanaTz } from './primitives.ts';

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
    }),
  ),
  grafana_url: z.string().nullable(),
});
export type CompanyMeta = z.infer<typeof zCompanyMeta>;

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
  grafana_base_url: z.string(),
});
export type Meta = z.infer<typeof zMeta>;
