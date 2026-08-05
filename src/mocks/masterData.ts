import type { DataReadiness, ShiftConfig } from '../api/contract';

/**
 * Master data for the nine manufacturing companies, transcribed from section 4
 * of the design doc. Coordinates and IANA zone names are verbatim.
 *
 * This stands in for what /api/v1/meta will serve. Note what it encodes that
 * the current Grafana dashboards cannot: only TH and JP have country codes in
 * the system at all today, so six of these nine sites exist here purely as
 * `not_connected` pins. Section 11 is explicit that they must appear on the map
 * and must never be counted as stopped.
 */

export interface PlantSeed {
  code: string;
  label: string;
  /** Machines the site is expected to have. Used to build a believable census. */
  machines: number;
  /** Rough %OA the generator centres this plant on. */
  oaCentre: number;
  /** Plan pieces for the current window. */
  planQty: number;
}

export interface CompanySeed {
  code: string;
  name: string;
  nameTh: string | null;
  countryCode: string;
  lat: number;
  lng: number;
  timezone: string;
  readiness: DataReadiness;
  readinessNote: string | null;
  shiftConfig: ShiftConfig | null;
  plants: PlantSeed[];
}

/** THS and ASI both run two twelve-hour shifts (section 9.5). */
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
 * STJ runs three shifts and — this is the case that breaks every hour-bucketed
 * query in the old dashboards — B ends at 22:15, not on the hour. A shift is
 * 8h, B is 8h15m, C is 7h45m and crosses midnight.
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

export const COMPANIES: CompanySeed[] = [
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
      { code: '6332', label: 'LAMP 2', machines: 10, oaCentre: 78.4, planQty: 5200 },
      { code: '6337', label: 'LAMP 7', machines: 8, oaCentre: 81.0, planQty: 3100 },
      { code: '6338', label: 'LAMP 8', machines: 6, oaCentre: 90.2, planQty: 2600 },
      { code: '6321', label: 'Auto Bulb', machines: 2, oaCentre: 95.8, planQty: 900 },
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
    plants: [{ code: '6051', label: 'ASI Plant', machines: 21, oaCentre: 74.5, planQty: 6400 }],
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
    plants: [{ code: 'STJ-1', label: 'Plant 1', machines: 18, oaCentre: 91.5, planQty: 5000 }],
  },
  {
    code: 'SEH',
    name: 'Stanley Electric Hungary Kft.',
    nameTh: null,
    countryCode: 'HU',
    lat: 47.75733069569861,
    lng: 19.953289541127084,
    timezone: 'Europe/Budapest',
    // Section 11: gateways are being installed on 16 machines. This is a
    // materially different fact from "we have no plan for this site", and the
    // ranking table says so instead of lumping both into one grey row.
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

export const COUNTRIES = [
  { code: 'TH', name: 'Thailand', name_th: 'ไทย' },
  { code: 'JP', name: 'Japan', name_th: 'ญี่ปุ่น' },
  { code: 'HU', name: 'Hungary', name_th: 'ฮังการี' },
  { code: 'VN', name: 'Vietnam', name_th: 'เวียดนาม' },
  { code: 'ID', name: 'Indonesia', name_th: 'อินโดนีเซีย' },
  { code: 'US', name: 'United States', name_th: 'สหรัฐอเมริกา' },
  { code: 'MX', name: 'Mexico', name_th: 'เม็กซิโก' },
];

/** Section 5 of the design doc: the group target, overridable per plant (D-07). */
export const TARGET_OA = 95;
