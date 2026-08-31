import { z } from 'zod';
import {
  zCountryCode,
  zDataReadiness,
  zIanaTz,
  zShiftConfig,
  type DataReadiness,
  type ShiftConfig,
} from '@dashboard/contract';

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
  readinessNote: z.string().nullable(),
  shiftConfig: zShiftConfig.nullable(),
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

const RAW_COMPANIES: CompanyMasterData[] = [
  {
    code: 'THS',
    name: 'Thai Stanley Electric Public Co., Ltd.',
    nameTh: 'บริษัท ไทยสแตนเลย์การไฟฟ้า จำกัด (มหาชน)',
    countryCode: 'TH',
    lat: 14.006904532327685,
    lng: 100.56213418111764,
    timezone: 'Asia/Bangkok',
    readiness: 'live',
    readinessNote: null,
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
    readinessNote: null,
    shiftConfig: TWO_SHIFT('Asia/Bangkok'),
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
    readiness: 'live',
    readinessNote: null,
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
    readinessNote: 'Gateway installation in progress · 16 machines · phase 2',
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
    readinessNote: null,
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
    readinessNote: null,
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
    readinessNote: null,
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
    readinessNote: null,
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
    readinessNote: null,
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
