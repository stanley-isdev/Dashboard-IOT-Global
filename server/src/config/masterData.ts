import { z } from 'zod';
import {
  zCountryCode,
  zDataReadiness,
  zIanaTz,
  zShiftConfig,
  type DataReadiness,
  type ShiftConfig,
} from '@dashboard/contract';
import { HOT_WINDOW_HOURS, MAX_WINDOW_HOURS, OA_WINDOW_HOURS } from '../influx/queries.ts';

/**
 * Master data for the nine manufacturing companies, ported from
 * src/mocks/masterData.ts (itself transcribed from design doc section 4).
 * Coordinates and IANA zone names are verbatim.
 *
 * Extends the mock's shape with two backend-only fields no UI ever sees:
 *   machinesExpected  - Q-08's simplified form for milestone 1: a plant-level
 *                        count (not a machine roster - that's PlantDetail's
 *                        machines[], milestone 2), used to reconcile a
 *                        shortfall into Offline/no_data (design doc's own
 *                        Q-08 trap: `machines = run + stop` under-reports).
 *   machineExclusions - design doc section 10 flags a hardcoded SQL exclusion
 *                        list (`machine != 'lA1','lA2','D2','D3','D4','P1l4'`)
 *                        that must become config. The specific plant each ID
 *                        belongs to is not stated in the design doc; this is
 *                        empty until Phase 2 confirms it against real
 *                        InfluxDB tag values.
 *
 * TODO(Phase 2): confirm machineExclusions against real InfluxDB data and the
 * original Grafana JSON (docs/grafana/ is currently an empty placeholder).
 */

const zPlantMasterData = z.object({
  code: z.string(),
  label: z.string(),
  targetOa: z.number().nullable(),
  machinesExpected: z.number().int().nonnegative(),
  machineExclusions: z.array(z.string()),
});

const zCompanyMasterData = z.object({
  code: z.string(),
  name: z.string(),
  nameTh: z.string().nullable(),
  countryCode: zCountryCode,
  lat: z.number(),
  lng: z.number(),
  timezone: zIanaTz,
  readiness: zDataReadiness,
  /**
   * What a human knows about this site's silence that no query can - `null`
   * everywhere else, which includes every site that reports.
   *
   * **It does not say there is no data; the database says that.** A site with
   * no telemetry is read straight off the `everSeen` ledger and the screen
   * states what was observed. This field only adds context a query has no
   * access to: that SEH's gateways are being fitted, that VNS has no scheduled
   * date. Where nobody knows more than the query does, it stays `null`.
   *
   * Deliberately no date. Every version of this field that carried one had it
   * invented - none of these sites ever had data to stop, so there is no moment
   * for a count to run from - and the invented date reached the screen as a
   * confident figure nothing supported.
   *
   * This is also the line the STJ defect is meant to stop being crossed: config
   * may add context, but it may no longer assert that a site is connected.
   * Whether data arrives is observed (`everSeen`), never declared here.
   */
  absence: z
    .object({
      reason: z.string().min(1),
      owner: z.string().min(1),
    })
    .nullable(),
  shiftConfig: zShiftConfig.nullable(),
  /**
   * How many hours of shots this site's %OA is figured over - its own
   * production board's window, which is NOT the same everywhere.
   *
   * THS's board sums `TotalOutput_Per_PO` over `INTERVAL '1 days'`; ASI's over
   * `'3 days'`, confirmed against IOT on 2026-09-10 for ASI specifically ("a
   * machine whose order has run past 24 h is figured over 3 days"). Omitted
   * means `OA_WINDOW_HOURS`, the THS number, because that is what every site
   * reconciled so far reads and a site nobody has checked should not silently
   * inherit another site's exception.
   *
   * Capped at `MAX_WINDOW_HOURS` (71) rather than a literal 72, because that
   * is the widest a single query may scan before InfluxDB rejects it on file
   * count - see the constant. The hour given up is the oldest one.
   *
   * This being per company is the whole point: it was one global constant for
   * a few hours on 2026-09-10, set to ASI's 71, and that moved every THS
   * figure off THS's own board (`P1I8` read 294 pieces here against 43 there).
   */
  oaWindowHours: z.number().int().positive().max(MAX_WINDOW_HOURS).default(OA_WINDOW_HOURS),
  /**
   * How far back this company's census looks for a machine's latest status,
   * in hours. Default `HOT_WINDOW_HOURS` (24).
   *
   * The same shape of fact as `oaWindowHours` above, read off the same panels:
   * ASI's `RealtimeStatus_Latest` bounds on `now() - INTERVAL '3 days'` where
   * THS's bounds on `1 days`. A machine that has not reported inside the
   * window has no card on that board and is in none of its counts, so ours has
   * to use the same width or the two censuses cannot agree.
   *
   * Measured at 6051 on 2026-09-11: `M-IS-38` last reported `Dandori` two days
   * earlier. The board carried it - 43 machines, Dandori 4 - and our 24 h
   * census did not, at 42 and 3. Nothing about the machine changed; only how
   * far back each side was willing to look.
   *
   * Capped at `MAX_WINDOW_HOURS` (71) for the file-scan limit, exactly as
   * `oaWindowHours` is, so ASI reads 71 h rather than a literal 72.
   */
  statusWindowHours: z.number().int().positive().max(MAX_WINDOW_HOURS).default(HOT_WINDOW_HOURS),
  plants: z.array(zPlantMasterData),
});

export type PlantMasterData = z.infer<typeof zPlantMasterData>;
export type CompanyMasterData = z.infer<typeof zCompanyMasterData>;

/** THS and ASI both run two twelve-hour shifts (design doc section 9.5). */
const TWO_SHIFT = (timezone: string): ShiftConfig => ({
  effective_from: '2026-01-01',
  timezone,
  production_date_anchor: 'shift_start',
  shifts: [
    { code: 'D', label: 'Day', start: '08:00', end: '20:00' },
    { code: 'N', label: 'Night', start: '20:00', end: '08:00' },
  ],
});

/**
 * STJ runs three shifts and B ends at 22:15, not on the hour - the case that
 * breaks every hour-bucketed query in the old dashboards. A is 8h, B is
 * 8h15m, C is 7h45m and crosses midnight.
 */
const STJ_SHIFT: ShiftConfig = {
  effective_from: '2026-01-01',
  timezone: 'Asia/Tokyo',
  production_date_anchor: 'shift_start',
  shifts: [
    { code: 'A', label: 'A Shift', start: '06:00', end: '14:00' },
    { code: 'B', label: 'B Shift', start: '14:00', end: '22:15' },
    { code: 'C', label: 'C Shift', start: '22:15', end: '06:00' },
  ],
};

/* The INPUT type, so a site that reads %OA over the ordinary window can leave
   `oaWindowHours` out and take the schema's default rather than restating it
   nine times. `COMPANIES` below is the parsed OUTPUT type, where it is set. */
const RAW_COMPANIES: z.input<typeof zCompanyMasterData>[] = [
  {
    code: 'THS',
    name: 'Thai Stanley Electric Public Co., Ltd.',
    nameTh: 'บริษัท ไทยสแตนเลย์การไฟฟ้า จำกัด (มหาชน)',
    countryCode: 'TH',
    lat: 14.006904532327685,
    lng: 100.56213418111764,
    timezone: 'Asia/Bangkok',
    readiness: 'live',
    absence: null,
    shiftConfig: TWO_SHIFT('Asia/Bangkok'),
    plants: [
      /*
       * Deliberately empty, and no longer an open question - **closed
       * 2026-08-26**, which retires the TODO above for this plant.
       *
       * DESIGN.md §10 records six machine IDs hardcoded into the old Grafana
       * SQL (`machine != 'lA1','lA2','D2','D3','D4','P1l4'`). Decoded, the `l`
       * is a capital `I`: `IA1`, `IA2`, `P1I4` all exist at 6332, and
       * `D2`/`D3`/`D4` match nothing at any plant. But §10 lists that filter
       * under *caveats found in the old code*, not as a rule for this app, and
       * the plant owner confirmed the underlying bug is fixed and the exclusion
       * is gone.
       *
       * The live data settles it independently: the board's header read
       * `AVG %OA 69.8%`, which is the mean of IC4 48.9, I5 47.5, **IA1 89.9**
       * and P1I1 93.0. Without IA1 that mean is 63.1. The board counts IA1, so
       * this list stays empty - and all three machines are producing anyway
       * (791, 704 and 817 pieces over 24 h, all tagged `Injection`).
       */
      { code: '6332', label: 'LAMP 2', targetOa: null, machinesExpected: 10, machineExclusions: [] },
      { code: '6337', label: 'LAMP 7', targetOa: null, machinesExpected: 8, machineExclusions: [] },
      { code: '6338', label: 'LAMP 8', targetOa: null, machinesExpected: 6, machineExclusions: [] },
      { code: '6321', label: 'Auto Bulb', targetOa: null, machinesExpected: 2, machineExclusions: [] },
    ],
  },
  {
    code: 'ASI',
    name: 'Asian Stanley International Co., Ltd.',
    nameTh: 'บริษัท เอเซียนสแตนเลย์ อินเตอร์เนชั่นแนล จำกัด',
    countryCode: 'TH',
    lat: 14.045689204453973,
    lng: 100.43391089831499,
    timezone: 'Asia/Bangkok',
    readiness: 'live',
    absence: null,
    shiftConfig: TWO_SHIFT('Asia/Bangkok'),
    /*
     * ASI's board reads %OA over 3 days where every other site reads a day -
     * its panel's `TotalOutput_Per_PO` says `INTERVAL '3 days'`, and IOT
     * confirmed the rule on 2026-09-10: here, an order that has run past 24 h
     * is figured over 3 days rather than clipped to the last one. ASI runs a
     * single order across days (see `domain/orderShift.ts`), so the clipped
     * figure is the wrong one far more often here than anywhere else.
     *
     * Measured at 6051 the same day, both machines on orders ~26.8 h old:
     * `M-ID-02` read 49.1% over 24 h against 46.4% over 3 days, and the board
     * showed 46.3-46.4%. `M-ID-06` read 112% and 111% - the same clipping,
     * a much smaller effect, because what the extra hours change is not the
     * order's age but whether the hours a day-wide window cuts off the front
     * of it ran at a different efficiency than the rest.
     *
     * 71 and not 72: `MAX_WINDOW_HOURS`, the InfluxDB file-scan cap.
     */
    oaWindowHours: MAX_WINDOW_HOURS,
    statusWindowHours: MAX_WINDOW_HOURS,
    plants: [
      { code: '6051', label: 'ASI Plant', targetOa: null, machinesExpected: 21, machineExclusions: [] },
    ],
  },
  {
    code: 'STJ',
    name: 'Stanley Electric Co., Ltd.',
    nameTh: 'สแตนเลย์ อิเล็คทริค (ญี่ปุ่น)',
    countryCode: 'JP',
    lat: 35.38815535277727,
    lng: 139.2082217038006,
    timezone: 'Asia/Tokyo',
    /*
     * Still `live`, and deliberately so. Master data's job is to record what
     * the rollout believes - a gateway IS commissioned here as far as anyone
     * has said - and quietly demoting it to `planned` to make the tile look
     * right would be the same lie as before, told in the other direction and
     * with the evidence thrown away.
     *
     * What changed is that this claim no longer decides the tile on its own.
     * `everSeen` observes that nothing has arrived, the status resolves to
     * `not_connected`, and the absence below says why - so config and
     * observation now disagree in the open instead of one silently winning.
     */
    readiness: 'live',
    /*
     * **`null`, on the design owner's instruction of 2026-09-08: go by the
     * database.** And it is the right answer, not a gap.
     *
     * Everything this field could have held about STJ turned out to be a guess
     * that had to be withdrawn. The 2026-08-25 spike read the absence as
     * evidence of a separate InfluxDB (D-17) - an inference from three
     * datasource UIDs, never confirmed. A start date was invented for the day
     * count and had no source. An attribution to the IoT team was invented too.
     * Each one reached the screen looking like a finding.
     *
     * What the database says is enough, and it is not in doubt: zero rows for
     * STJ-1 across the full retention, measured twice a fortnight apart, while
     * THS and ASI were current to the minute. The screen says exactly that, and
     * `contradicts_config` flags that master data still claims otherwise.
     *
     * Open, and not for this field to answer: §4.8b establishes - confirmed by
     * the plant IT owner 2026-08-27, `P1TC1` absent from all ten tables - that
     * this backend does not read the instance the wall board reads. Whether
     * that is where STJ writes is still nobody's confirmed answer.
     */
    absence: null,
    shiftConfig: STJ_SHIFT,
    plants: [
      { code: 'STJ-1', label: 'Plant 1', targetOa: null, machinesExpected: 18, machineExclusions: [] },
    ],
  },
  {
    code: 'SEH',
    name: 'Stanley Electric Hungary Kft.',
    nameTh: null,
    countryCode: 'HU',
    lat: 47.75733069569861,
    lng: 19.953289541127084,
    timezone: 'Europe/Budapest',
    // Section 11: gateways are being installed on 16 machines - a materially
    // different fact from "no plan for this site".
    readiness: 'installing',
    absence: {
      reason: 'Gateway installation in progress - 16 machines, phase 2',
      owner: 'IoT team',
    },
    shiftConfig: null,
    plants: [],
  },
  {
    code: 'VNS',
    name: 'Vietnam Stanley Electric Co., Ltd.',
    nameTh: null,
    countryCode: 'VN',
    lat: 21.0078991790763,
    lng: 105.96337126776004,
    timezone: 'Asia/Ho_Chi_Minh',
    readiness: 'planned',
    absence: {
      reason: 'No IoT installation scheduled yet (DESIGN.md 11)',
      owner: 'IoT team',
    },
    shiftConfig: null,
    plants: [],
  },
  {
    code: 'ISE',
    name: 'PT. Indonesia Stanley Electric',
    nameTh: null,
    countryCode: 'ID',
    lat: -6.2555455142982845,
    lng: 106.49968179637503,
    timezone: 'Asia/Jakarta',
    readiness: 'planned',
    absence: {
      reason: 'No IoT installation scheduled yet (DESIGN.md 11)',
      owner: 'IoT team',
    },
    shiftConfig: null,
    plants: [],
  },
  {
    code: 'SUS',
    name: 'Stanley Electric U.S. Co., Ltd.',
    nameTh: null,
    countryCode: 'US',
    lat: 39.92641143817483,
    lng: -83.41551660704249,
    timezone: 'America/New_York',
    readiness: 'planned',
    absence: {
      reason: 'No IoT installation scheduled yet (DESIGN.md 11)',
      owner: 'IoT team',
    },
    shiftConfig: null,
    plants: [],
  },
  {
    code: 'IIS',
    name: 'I I Stanley Co., Inc.',
    nameTh: null,
    countryCode: 'US',
    lat: 42.3364642871659,
    lng: -85.2757240901681,
    timezone: 'America/Detroit',
    readiness: 'planned',
    absence: {
      reason: 'No IoT installation scheduled yet (DESIGN.md 11)',
      owner: 'IoT team',
    },
    shiftConfig: null,
    plants: [],
  },
  {
    code: 'SMX',
    name: 'Stanley Electric Manufacturing Mexico',
    nameTh: null,
    countryCode: 'MX',
    lat: 21.39244045633582,
    lng: -101.87831543037854,
    timezone: 'America/Mexico_City',
    readiness: 'planned',
    absence: {
      reason: 'No IoT installation scheduled yet (DESIGN.md 11)',
      owner: 'IoT team',
    },
    shiftConfig: null,
    plants: [],
  },
];

/** Validated at module load so a typo in the port is a boot-time failure, not a silent bug. */
export const COMPANIES: CompanyMasterData[] = RAW_COMPANIES.map((c) => zCompanyMasterData.parse(c));

export const COUNTRIES: { code: string; name: string; name_th: string | null }[] = [
  { code: 'TH', name: 'Thailand', name_th: 'ไทย' },
  { code: 'JP', name: 'Japan', name_th: 'ญี่ปุ่น' },
  { code: 'HU', name: 'Hungary', name_th: 'ฮังการี' },
  { code: 'VN', name: 'Vietnam', name_th: 'เวียดนาม' },
  { code: 'ID', name: 'Indonesia', name_th: 'อินโดนีเซีย' },
  { code: 'US', name: 'United States', name_th: 'สหรัฐอเมริกา' },
  { code: 'MX', name: 'Mexico', name_th: 'เม็กซิโก' },
];

/** Companies with real InfluxDB telemetry today - milestone 1's scope (design doc section 11). */
export const LIVE_COMPANY_CODES: readonly string[] = COMPANIES.filter(
  (c) => c.readiness === 'live',
).map((c) => c.code);

export type { DataReadiness };
