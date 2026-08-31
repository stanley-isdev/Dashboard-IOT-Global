import type {
  Alert,
  CompanyDetail,
  CompanySummary,
  Counts,
  GlobalOverview,
  Kpi,
  Machine,
  MachineStatus,
  Meta,
  OutputBucket,
  PlantDetail,
  PlantSummary,
  PlantWithZones,
  Process,
  Range,
  Shift,
  ShiftBreakdown,
  SiteStatus,
  StatusBucket,
  Tier,
  TierPolicy,
  TrendPoint,
  ZoneSummary,
} from '../api/contract';
import { plantFilterActive, plantMatcher, regionMatcher } from '../api/contract';
/*
 * The one thing the mock must NOT re-implement: where a drill-down link points.
 * A mock that hands out a differently shaped Grafana URL than the server does
 * is a link that works in mock mode and 404s in production, which is exactly
 * the class of bug mock mode exists to catch early.
 */
import {
  DEFAULT_LINK_PROCESS,
  GRAFANA_BASE_URL,
  machineStatusUrl,
  representativePlant,
} from '@dashboard/domain-shared';
import { COMPANIES, COUNTRIES, TARGET_OA, type CompanySeed, type PlantSeed } from './masterData';
import {
  clockToMinutes,
  minutesOfDay,
  offsetString,
  toIsoOffset,
  toPlainDate,
  zonedParts,
  zonedToUtc,
} from './tz';
import type { Scenario } from './scenarios';

/**
 * Generates contract-valid payloads from the master data.
 *
 * This is backend code living temporarily in the frontend repo. Nothing here
 * may be imported outside src/mocks - shift resolution, roll-ups and tier
 * assignment are exactly the business logic the design doc (sections 7 and 13)
 * says must sit behind the API.
 *
 * Numbers drift on a one-minute bucket so a demo looks alive, but are
 * deterministic within that bucket so a test can assert on them.
 */

/* ------------------------------------------------------------ randomness */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 - small, fast, good enough for believable-looking sample data. */
function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bucketKey = (now: Date) => String(Math.floor(now.getTime() / 60_000));

/* ------------------------------------------------------------- policies */

const TIER_POLICY: TierPolicy = {
  id: 'group_2026',
  mode: 'relative_to_target',
  target_oa: TARGET_OA,
  good_at: TARGET_OA - 5, // 90
  warn_at: TARGET_OA - 20, // 75
};

const FRESHNESS = {
  stale_after_sec: 120,
  no_data_after_sec: 900,
  trend_stale_after_sec: 600,
};

const POLICY_BLOCK = {
  target_oa: TARGET_OA,
  tier_policy: TIER_POLICY,
  // D-20. Weighted by output so a 21-machine plant does not carry the same
  // weight as a 2-machine one. Disclosed on the tile, never silently switched.
  oa_aggregation: 'weighted_by_qty' as const,
  freshness: FRESHNESS,
  qty_unit: 'pcs' as const,
};

function tierOf(oa: number | null): Tier {
  if (oa === null) return 'unknown';
  if (oa >= TIER_POLICY.good_at) return 'good';
  if (oa >= TIER_POLICY.warn_at) return 'warn';
  return 'critical';
}

/* ---------------------------------------------------------------- shift */

interface ResolvedShift extends Shift {
  startUtc: Date;
  endUtc: Date;
}

/**
 * Which shift a site is in right now, resolved in its own timezone.
 *
 * This is the logic the front end must never contain. It handles the two cases
 * the old hour-bucketed queries get wrong: a shift boundary that is not on the
 * hour (STJ B ends 22:15) and a shift that crosses midnight (STJ C).
 */
export function resolveShift(seed: CompanySeed, now: Date): ResolvedShift | null {
  const cfg = seed.shiftConfig;
  if (!cfg) return null;

  const tz = cfg.timezone;
  const nowMin = minutesOfDay(now, tz);

  const idx = cfg.shifts.findIndex((s) => {
    const start = clockToMinutes(s.start);
    const end = clockToMinutes(s.end);
    return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
  });
  if (idx < 0) return null;

  const s = cfg.shifts[idx];
  const start = clockToMinutes(s.start);
  const end = clockToMinutes(s.end);
  const crossesMidnight = start >= end;

  // When the shift crosses midnight and we are past midnight, it began yesterday.
  const startedYesterday = crossesMidnight && nowMin < end;
  const today = zonedParts(now, tz);

  const startDay = startedYesterday
    ? zonedParts(new Date(now.getTime() - 86_400_000), tz)
    : { ...today };
  const startUtc = zonedToUtc(
    {
      ...startDay,
      hour: Math.floor(start / 60),
      minute: start % 60,
    },
    tz,
  );

  const endBase = crossesMidnight && !startedYesterday ? new Date(now.getTime() + 86_400_000) : now;
  const endDay = zonedParts(endBase, tz);
  const endUtc = zonedToUtc(
    { ...endDay, hour: Math.floor(end / 60), minute: end % 60 },
    tz,
  );

  // Section 9.5 point 4: the production date is anchored, not assumed to be
  // "today". STJ's C shift starts at 22:15 and belongs to the day it began on.
  const anchorInstant = cfg.production_date_anchor === 'shift_start' ? startUtc : endUtc;

  return {
    code: s.code,
    label: s.label,
    index: idx + 1,
    of: cfg.shifts.length,
    start_local: toIsoOffset(startUtc, tz),
    end_local: toIsoOffset(endUtc, tz),
    production_date: toPlainDate(anchorInstant, tz),
    startUtc,
    endUtc,
  };
}

/**
 * Splits a shift into hour-aligned buckets, keeping whatever partial bucket the
 * shift boundaries produce.
 *
 * STJ B (14:00-22:15) yields nine: eight full hours plus a fifteen-minute tail.
 * STJ C (22:15-06:00) yields eight: a forty-five-minute head plus seven hours.
 * THS D (08:00-20:00) yields twelve. The UI reads `buckets.length` and
 * `duration_min` and never assumes any of those numbers.
 */
export function buildBuckets(shift: ResolvedShift, tz: string, now: Date, seed: string): OutputBucket[] {
  const out: OutputBucket[] = [];
  const r = rng(`${seed}|buckets|${bucketKey(now)}`);
  let cursor = shift.startUtc;
  let index = 1;

  while (cursor < shift.endUtc) {
    const p = zonedParts(cursor, tz);
    const toNextHour = p.minute === 0 ? 60 : 60 - p.minute;
    let next = new Date(cursor.getTime() + toNextHour * 60_000);
    if (next > shift.endUtc) next = shift.endUtc;

    const durationMin = Math.round((next.getTime() - cursor.getTime()) / 60_000);
    const isPartial = durationMin !== 60;

    const state: OutputBucket['state'] =
      next <= now ? 'complete' : cursor <= now ? 'in_progress' : 'not_started';

    const started = state !== 'not_started';
    // A partial bucket produces proportionally less; the table must size the
    // column by duration or this reads as a collapse in output rather than a
    // shorter measuring window.
    const elapsedMin =
      state === 'complete'
        ? durationMin
        : state === 'in_progress'
          ? Math.max(1, Math.round((now.getTime() - cursor.getTime()) / 60_000))
          : 0;
    const perHour = 380 + Math.round(r() * 90);
    const pcs = started ? Math.round((perHour * elapsedMin) / 60) : null;

    out.push({
      index,
      label: `${fmtClock(cursor, tz)}-${fmtClock(next, tz)}`,
      start_utc: cursor.toISOString(),
      end_utc: next.toISOString(),
      duration_min: durationMin,
      is_partial: isPartial,
      state,
      qty_pcs: pcs,
      qty_shots: pcs === null ? null : Math.round(pcs / 4),
      plan_qty: Math.round((420 * durationMin) / 60),
      // The only figure comparable across unequal buckets, so it is computed
      // here rather than left for the UI to divide.
      qty_per_hour: pcs === null || elapsedMin === 0 ? null : Math.round((pcs / elapsedMin) * 60),
      oa_pct: started ? round1(72 + r() * 24) : null,
    });

    cursor = next;
    index++;
  }
  return out;
}

function fmtClock(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/* --------------------------------------------------------------- counts */

const BUCKET_OF: Record<MachineStatus, StatusBucket> = {
  'Mass Pro': 'running',
  Dandori: 'running',
  Stop: 'stopped',
  // D-21 is open. Until it closes, 4M Change sits in `other` with a neutral
  // tone. When it closes this single mapping changes and no UI code moves.
  '4M Change': 'other',
  'No Plan': 'idle',
  'Order End': 'idle',
  Offline: 'no_data',
  // Statuses the live InfluxDB emits that the design doc never listed. Kept in
  // step with packages/domain-shared/src/statusBucket.ts, which is the real one.
  Pending: 'other',
  Alarm: 'other',
  Warning: 'other',
};

function buildCounts(total: number, seed: string, healthy: boolean): Counts {
  const r = rng(seed);
  const stop = healthy ? Math.floor(r() * 2) : Math.max(1, Math.round(total * (0.08 + r() * 0.14)));
  const dandori = total > 6 && r() > 0.5 ? 1 : 0;
  const fourM = total > 8 && r() > 0.7 ? 1 : 0;
  const noPlan = total > 4 && r() > 0.6 ? 1 : 0;
  const orderEnd = total > 10 && r() > 0.75 ? 1 : 0;
  const offline = 0;
  const massPro = Math.max(0, total - stop - dandori - fourM - noPlan - orderEnd - offline);

  /*
   * Split the way the real backend splits it: TOTAL is RUNNING + STOP, and
   * everything else lands in `not_counted` as context rather than in the
   * headline. The mock is the reference implementation (BACKEND-HANDOVER §5),
   * so it models the same rule - a mock that still folded Order End into TOTAL
   * would disagree with the server the moment anyone flipped back to it.
   *
   * `Pending`, `Alarm` and `Warning` are real statuses the live InfluxDB
   * emits that the mock never generates; every enum key is still present,
   * because absent is not the same as zero.
   */
  const by_status: Record<MachineStatus, number> = {
    'Mass Pro': massPro,
    Dandori: dandori,
    Stop: stop,
    '4M Change': 0,
    'No Plan': 0,
    'Order End': 0,
    Offline: 0,
    Pending: 0,
    Alarm: 0,
    Warning: 0,
  };

  const not_counted: Record<MachineStatus, number> = {
    'Mass Pro': 0,
    Dandori: 0,
    Stop: 0,
    '4M Change': fourM,
    'No Plan': noPlan,
    'Order End': orderEnd,
    Offline: offline,
    Pending: 0,
    Alarm: 0,
    Warning: 0,
  };

  const sumFor = (bucket: StatusBucket) =>
    (Object.entries(by_status) as [MachineStatus, number][])
      .filter(([k]) => BUCKET_OF[k] === bucket)
      .reduce((a, [, v]) => a + v, 0);

  return {
    total: massPro + dandori + stop,
    by_status,
    not_counted,
    running: sumFor('running'),
    stopped: sumFor('stopped'),
    idle: sumFor('idle'),
    other: sumFor('other'),
    no_data: sumFor('no_data'),
  };
}

/** A census for a site that reports nothing. Every bucket is zero, not absent. */
function emptyCounts(): Counts {
  return {
    total: 0,
    by_status: {
      'Mass Pro': 0,
      Dandori: 0,
      Stop: 0,
      '4M Change': 0,
      'No Plan': 0,
      'Order End': 0,
      Offline: 0,
      Pending: 0,
      Alarm: 0,
      Warning: 0,
    },
    not_counted: {
      'Mass Pro': 0,
      Dandori: 0,
      Stop: 0,
      '4M Change': 0,
      'No Plan': 0,
      'Order End': 0,
      Offline: 0,
      Pending: 0,
      Alarm: 0,
      Warning: 0,
    },
    running: 0,
    stopped: 0,
    idle: 0,
    other: 0,
    no_data: 0,
  };
}

/* ------------------------------------------------------------------ kpi */

const round1 = (n: number) => Math.round(n * 10) / 10;

function buildKpi(plan: number, oa: number, seed: string, stopped: number): Kpi {
  const r = rng(seed);
  const actual = Math.round(plan * (0.72 + r() * 0.4));
  return {
    oa_pct: round1(oa),
    oa_tier: tierOf(oa),
    // Section 9.2: a plan of zero must not report 0% achievement - a machine
    // with no plan is not achieving zero, it is not applicable.
    achievement_pct: plan > 0 ? round1((actual / plan) * 100) : null,
    plan_qty: plan,
    actual_qty: actual,
    shot_count: Math.round(actual / 4),
    /*
     * Derived from the machines that are actually stopped, not drawn
     * independently. A row reading "0 stop" and "4h 12m down" at the same time
     * is the kind of contradiction that costs the whole board its credibility,
     * and with two independent generators it happens on about a third of rows.
     *
     * Its own rng stream (`|down`) rather than another draw from `r`, so adding
     * this field does not shift the sequence every existing figure came from.
     */
    downtime_sec: stopped === 0 ? 0 : Math.round(stopped * (18 + rng(`${seed}|down`)() * 62) * 60),
  };
}

/** An unknown KPI. Every field null so nothing can render a fabricated zero. */
function unknownKpi(): Kpi {
  return {
    oa_pct: null,
    oa_tier: 'unknown',
    achievement_pct: null,
    plan_qty: null,
    actual_qty: null,
    shot_count: null,
    // Not `0`. A site with no gateway has not had a downtime-free window; it
    // has had no window at all.
    downtime_sec: null,
  };
}

/**
 * Roll-up, weighted by actual output (D-20).
 *
 * Returns null rather than falling back to a simple average when the weighting
 * denominator is zero. The mockup switches methods silently in that case, which
 * makes the affected row incomparable to its neighbours with nothing on screen
 * to say so.
 */
function rollupOa(parts: { oa: number | null; weight: number | null }[]): number | null {
  const usable = parts.filter((p) => p.oa !== null && p.weight !== null && p.weight > 0);
  const weight = usable.reduce((a, p) => a + (p.weight as number), 0);
  if (weight === 0) return null;
  const sum = usable.reduce((a, p) => a + (p.oa as number) * (p.weight as number), 0);
  return round1(sum / weight);
}

function sumOrNull(values: (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v !== null);
  return usable.length === 0 ? null : usable.reduce((a, b) => a + b, 0);
}

function addCounts(list: Counts[]): Counts {
  const base = emptyCounts();
  for (const c of list) {
    base.total += c.total;
    base.running += c.running;
    base.stopped += c.stopped;
    base.idle += c.idle;
    base.other += c.other;
    base.no_data += c.no_data;
    for (const [k, v] of Object.entries(c.by_status) as [MachineStatus, number][]) {
      base.by_status[k] = (base.by_status[k] ?? 0) + v;
    }
  }
  return base;
}

/* ------------------------------------------------------------- assembly */

function siteStatusFor(seed: CompanySeed, scenario: Scenario): SiteStatus {
  if (seed.readiness !== 'live') return 'not_connected';
  // Proves T-11: a site that was reporting and has gone quiet must read as
  // stale, never as stopped, and its last known numbers stay on screen.
  if (scenario === 'site-offline' && seed.code === 'THS') return 'stale';
  return 'online';
}

function buildPlant(
  seed: CompanySeed,
  plant: PlantSeed,
  now: Date,
  scenario: Scenario,
  status: SiteStatus,
): PlantSummary {
  const key = `${seed.code}|${plant.code}|${bucketKey(now)}`;
  const reporting = status === 'online' || status === 'stale';
  const healthy = scenario === 'all-healthy';
  const oa = healthy ? Math.max(plant.oaCentre, 92 + rng(key)() * 6) : plant.oaCentre + (rng(key)() * 6 - 3);

  // Counts first: the KPI's downtime is a function of them, so it cannot be
  // built inline any more.
  const counts = reporting ? buildCounts(plant.machines, key, healthy) : emptyCounts();

  return {
    code: plant.code,
    label: plant.label,
    status,
    data_readiness: seed.readiness,
    last_seen: reporting ? lastSeenFor(now, status) : null,
    // No `Zone_var`: the mock has no zone data to name, so the board opens on
    // its own default. The server's links carry the zones a plant is actually
    // reporting.
    grafana_url: machineStatusUrl({
      plantCode: plant.code,
      process: DEFAULT_LINK_PROCESS,
      timezone: seed.timezone,
    }),
    target_oa: null,
    counts,
    kpi: reporting ? buildKpi(plant.planQty, oa, key, counts.stopped) : unknownKpi(),
  };
}

/** A company's drill-down: its first plant, since no company board exists. */
function companyGrafanaUrl(seed: CompanySeed): string | null {
  const plant = representativePlant(seed.plants, () => false);
  return plant
    ? machineStatusUrl({
        plantCode: plant.code,
        process: DEFAULT_LINK_PROCESS,
        timezone: seed.timezone,
      })
    : null;
}

function lastSeenFor(now: Date, status: SiteStatus): string {
  const ageSec = status === 'stale' ? 8 * 60 : 12;
  return new Date(now.getTime() - ageSec * 1000).toISOString();
}

function buildCompany(
  seed: CompanySeed,
  now: Date,
  scenario: Scenario,
  /*
   * The Lamp filter, applied where the plants are built rather than after the
   * company is finished - so counts, %OA and downtime are all summed over the
   * same plant set the reader picked. See plantMatcher in the contract.
   */
  plantInScope: (p: { code: string }) => boolean = () => true,
): CompanySummary {
  const status = siteStatusFor(seed, scenario);
  const shift = resolveShift(seed, now);
  const plants = seed.plants
    .filter(plantInScope)
    .map((p) => buildPlant(seed, p, now, scenario, status));
  const reporting = status === 'online' || status === 'stale';

  const counts = reporting ? addCounts(plants.map((p) => p.counts)) : emptyCounts();
  const oa = reporting
    ? rollupOa(plants.map((p) => ({ oa: p.kpi.oa_pct, weight: p.kpi.actual_qty })))
    : null;
  const plan = reporting ? sumOrNull(plants.map((p) => p.kpi.plan_qty)) : null;
  const actual = reporting ? sumOrNull(plants.map((p) => p.kpi.actual_qty)) : null;

  return {
    code: seed.code,
    name: seed.name,
    name_th: seed.nameTh,
    country_code: seed.countryCode,
    lat: seed.lat,
    lng: seed.lng,
    timezone: seed.timezone,
    local_time: toIsoOffset(now, seed.timezone),
    shift: shift ? stripInternals(shift) : null,
    status,
    data_readiness: seed.readiness,
    last_seen: reporting ? lastSeenFor(now, status) : null,
    // A company links to one of its plants - there is no company-level board.
    // Mock mode knows nothing about who is on the air, so it takes the first.
    grafana_url: companyGrafanaUrl(seed),
    counts,
    kpi: {
      oa_pct: oa,
      oa_tier: tierOf(oa),
      achievement_pct: plan && actual && plan > 0 ? round1((actual / plan) * 100) : null,
      plan_qty: plan,
      actual_qty: actual,
      shot_count: actual === null ? null : Math.round(actual / 4),
      // Downtime is additive across plants, unlike %OA. Machine-hours lost sum;
      // efficiency ratios do not, which is why that one goes through rollupOa.
      downtime_sec: reporting ? sumOrNull(plants.map((p) => p.kpi.downtime_sec)) : null,
    },
    plants,
  };
}

function stripInternals(s: ResolvedShift): Shift {
  const { startUtc: _s, endUtc: _e, ...rest } = s;
  void _s;
  void _e;
  return rest;
}

/**
 * The real backend's trend carries a machine count that moves hour to hour -
 * measured 1 to 18 over a live day - so the mock moves one too. A fixture whose
 * denominator never changes would let the chart's thin-hour handling look
 * correct right up until it met production.
 */
function buildTrend(
  now: Date,
  centre: number,
  siteCount: number,
  machineCount: number,
  seed: string,
): TrendPoint[] {
  const r = rng(`${seed}|trend|${bucketKey(now)}`);
  const points: TrendPoint[] = [];
  for (let i = 23; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * 3_600_000);
    ts.setUTCMinutes(0, 0, 0);
    points.push({
      ts: ts.toISOString(),
      oa_pct: round1(centre + Math.sin(i / 3) * 6 + (r() * 5 - 2.5)),
      site_count: siteCount,
      machine_count: Math.max(1, Math.round(machineCount * (0.6 + r() * 0.5))),
    });
  }
  return points;
}

/**
 * Alerts, restricted to sites that actually report.
 *
 * The mockup lists a heater failure at VNS and a material jam at ISE, both of
 * which are declared as having no telemetry at all. A site with no data cannot
 * report a fault; that is now structurally impossible because the alert list is
 * built from the reporting set.
 */
function buildAlerts(companies: CompanySummary[], now: Date): Alert[] {
  const reporting = companies.filter((c) => c.status === 'online' || c.status === 'stale');
  // No reporting site means no alerts, by definition. This is the guard that
  // makes "VNS reports a heater failure" unrepresentable rather than merely
  // unlikely - it is the company detail page for an unconnected site that
  // exercises it.
  if (reporting.length === 0) return [];

  const specs = [
    { reason_code: 'stop.heater_failure', reason: 'Heater failure', severity: 'critical' as const, category: 'hardware' as const, mins: 426, machine: 'P2I1' },
    { reason_code: 'stop.material_jam', reason: 'Material jam', severity: 'major' as const, category: 'material' as const, mins: 384, machine: 'IC9' },
    { reason_code: 'telemetry.sync_timeout', reason: 'Node-RED / InfluxDB sync timeout', severity: 'minor' as const, category: 'telemetry' as const, mins: 126, machine: null },
    { reason_code: 'stop.quality_hold', reason: 'Quality hold', severity: 'major' as const, category: 'quality' as const, mins: 54, machine: 'I2' },
    { reason_code: 'stop.mold_change', reason: 'Mold change overrun', severity: 'minor' as const, category: 'process' as const, mins: 41, machine: 'I1' },
  ];

  return specs.slice(0, Math.max(1, reporting.length + 2)).map((spec, i) => {
    const company = reporting[i % reporting.length];
    const plant = company.plants[0];
    return {
      id: `alert-${i + 1}`,
      company: company.code,
      plant: plant?.code ?? null,
      zone: plant ? 'Z1' : null,
      machine: spec.machine,
      reason_code: spec.reason_code,
      reason: spec.reason,
      severity: spec.severity,
      category: spec.category,
      started_at: new Date(now.getTime() - spec.mins * 60_000).toISOString(),
      duration_sec: spec.mins * 60,
      production_order: '110000770055',
      part_name: '640A HMSL HSG',
      // Role, never a name (T-08). This can end up on a corridor screen.
      owner: { role: 'Maintenance Lead', team: plant?.label ?? company.code },
      grafana_url: null,
    };
  });
}

function envelope(now: Date, scenario: Scenario) {
  const mssqlDown = scenario === 'partial';
  return {
    api_version: 'v1' as const,
    generated_at: now.toISOString(),
    cache_age_sec: 12,
    partial: mssqlDown,
    warnings: mssqlDown ? ['mssql.unreachable'] : [],
    sources: [
      {
        name: 'influxdb' as const,
        status: 'ok' as const,
        last_success: now.toISOString(),
      },
      {
        name: 'mssql' as const,
        status: mssqlDown ? ('down' as const) : ('ok' as const),
        last_success: mssqlDown ? new Date(now.getTime() - 22 * 60_000).toISOString() : now.toISOString(),
        message: mssqlDown ? 'BackflushHana_PRD unreachable - defect figures unavailable' : null,
      },
    ],
    build_id: 'mock',
  };
}

/* ------------------------------------------------------------- builders */

export function buildMeta(now: Date): Meta {
  return {
    ...POLICY_BLOCK,
    meta: envelope(now, 'default'),
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
      plants: c.plants.map((p) => ({ code: p.code, label: p.label, target_oa: null })),
      grafana_url: companyGrafanaUrl(c),
    })),
    processes: ['Injection'],
    ranges: ['8h', '24h', '7d'],
    grafana_base_url: GRAFANA_BASE_URL,
  };
}

export function buildGlobalOverview(
  now: Date,
  scenario: Scenario,
  filters: { range: Range; process: Process | 'all'; region: string; plant: string },
): GlobalOverview {
  const inPlantScope = plantMatcher(filters.plant);
  const all = COMPANIES.map((c) => buildCompany(c, now, scenario, inPlantScope));
  // One matcher for the whole payload, and the same one the server uses: the
  // parameter is `all` or a comma-separated list of country and company codes
  // (see the contract's region.ts), so a reader can scope the board to Thailand
  // plus Japan and get one denominator over both.
  const inScope = regionMatcher(filters.region);
  // A company with no lamp left in scope is not a row of zeroes - it is a
  // company the reader did not ask about.
  const narrowed = plantFilterActive(filters.plant);
  const companies = all.filter((c) => inScope(c) && (!narrowed || c.plants.length > 0));

  const reporting = companies.filter((c) => c.status === 'online' || c.status === 'stale');
  const counts = addCounts(reporting.map((c) => c.counts));
  const oa = rollupOa(reporting.map((c) => ({ oa: c.kpi.oa_pct, weight: c.kpi.actual_qty })));
  const plan = sumOrNull(reporting.map((c) => c.kpi.plan_qty));
  const actual = sumOrNull(reporting.map((c) => c.kpi.actual_qty));

  return {
    ...POLICY_BLOCK,
    meta: envelope(now, scenario),
    filters_applied: filters,
    totals: {
      counts,
      oa_pct: oa,
      oa_tier: tierOf(oa),
      achievement_pct: plan && actual && plan > 0 ? round1((actual / plan) * 100) : null,
      plan_qty: plan,
      actual_qty: actual,
      shot_count: actual === null ? null : Math.round(actual / 4),
      downtime_sec: sumOrNull(reporting.map((c) => c.kpi.downtime_sec)),
      companies_needing_attention: reporting.filter((c) => c.kpi.oa_tier === 'critical').length,
      plants_needing_attention: reporting
        .flatMap((c) => c.plants)
        .filter((p) => p.kpi.oa_tier === 'critical').length,
      companies_reporting: reporting.length,
      companies_total: companies.length,
      countries_total: new Set(companies.map((c) => c.country_code)).size,
    },
    companies,
    trend: buildTrend(
      now,
      oa ?? 80,
      reporting.length,
      reporting.reduce((n, c) => n + c.counts.total, 0),
      'global',
    ),
    alerts: buildAlerts(companies, now),
  };
}

export function buildCompanyDetail(
  code: string,
  now: Date,
  scenario: Scenario,
  filters: { range: Range; process: Process | 'all' },
): CompanyDetail | null {
  const seed = COMPANIES.find((c) => c.code === code);
  if (!seed) return null;

  const summary = buildCompany(seed, now, scenario);
  const shift = resolveShift(seed, now);

  const plants: PlantWithZones[] = summary.plants.map((p) => ({
    ...p,
    zones: buildZones(seed, p, now),
  }));

  return {
    ...POLICY_BLOCK,
    meta: envelope(now, scenario),
    filters_applied: filters,
    company: {
      code: summary.code,
      name: summary.name,
      name_th: summary.name_th,
      country_code: summary.country_code,
      lat: summary.lat,
      lng: summary.lng,
      timezone: summary.timezone,
      local_time: summary.local_time,
      shift: summary.shift,
      status: summary.status,
      data_readiness: summary.data_readiness,
      last_seen: summary.last_seen,
      grafana_url: summary.grafana_url,
      counts: summary.counts,
      kpi: summary.kpi,
    },
    shift_config: seed.shiftConfig,
    shift_breakdown: shift ? buildShiftBreakdown(seed, now) : [],
    plants,
    trend: buildTrend(now, summary.kpi.oa_pct ?? 80, 1, summary.counts.total, seed.code),
    alerts: buildAlerts([summary], now),
  };
}

function buildZones(seed: CompanySeed, plant: PlantSummary, now: Date): ZoneSummary[] {
  if (plant.counts.total === 0) return [];
  // Section 3: ASI is organised into seven zones; the others are smaller.
  const zoneCount = seed.code === 'ASI' ? 7 : Math.max(1, Math.ceil(plant.counts.total / 6));
  const per = Math.floor(plant.counts.total / zoneCount);
  const zones: ZoneSummary[] = [];
  for (let i = 0; i < zoneCount; i++) {
    const total = i === zoneCount - 1 ? plant.counts.total - per * (zoneCount - 1) : per;
    const key = `${seed.code}|${plant.code}|Z${i + 1}|${bucketKey(now)}`;
    const oa = (plant.kpi.oa_pct ?? 80) + (rng(key)() * 10 - 5);
    const counts = buildCounts(total, key, false);
    zones.push({
      code: `Z${i + 1}`,
      label: `Zone ${i + 1}`,
      status: plant.status,
      data_readiness: plant.data_readiness,
      last_seen: plant.last_seen,
      grafana_url: null,
      counts,
      kpi: buildKpi(Math.round((plant.kpi.plan_qty ?? 0) / zoneCount), oa, key, counts.stopped),
    });
  }
  return zones;
}

function buildShiftBreakdown(seed: CompanySeed, now: Date): ShiftBreakdown[] {
  const cfg = seed.shiftConfig;
  if (!cfg) return [];
  const active = resolveShift(seed, now);
  const tz = cfg.timezone;

  return cfg.shifts.map((s, i) => {
    const key = `${seed.code}|shift-${s.code}|${bucketKey(now)}`;
    const r = rng(key);
    const start = clockToMinutes(s.start);
    const end = clockToMinutes(s.end);
    const durationMin = start < end ? end - start : 1440 - start + end;

    const activeIdx = active ? active.index - 1 : -1;
    const state: ShiftBreakdown['state'] =
      i < activeIdx ? 'complete' : i === activeIdx ? 'in_progress' : 'not_started';

    const nowMin = minutesOfDay(now, tz);
    const elapsed =
      state === 'complete'
        ? durationMin
        : state === 'in_progress'
          ? start < end
            ? nowMin - start
            : nowMin >= start
              ? nowMin - start
              : 1440 - start + nowMin
          : 0;

    const plan = Math.round((4000 * durationMin) / 480);
    const rate = 8.4 + r() * 1.6;
    const qty = state === 'not_started' ? null : Math.round(elapsed * rate);

    const day = zonedParts(now, tz);
    const startUtc = zonedToUtc({ ...day, hour: Math.floor(start / 60), minute: start % 60 }, tz);
    const endUtc = zonedToUtc({ ...day, hour: Math.floor(end / 60), minute: end % 60 }, tz);

    return {
      shift_code: s.code,
      shift_label: s.label,
      index: i + 1,
      of: cfg.shifts.length,
      state,
      start_local: toIsoOffset(startUtc, tz),
      end_local: toIsoOffset(endUtc, tz),
      duration_min: durationMin,
      qty_pcs: qty,
      shot_count: qty === null ? null : Math.round(qty / 4),
      plan_qty: plan,
      achievement_pct: qty === null ? null : round1((qty / plan) * 100),
      oa_pct: qty === null ? null : round1(86 + r() * 9),
      running_avg: qty === null ? null : round1(14 + r() * 4),
    };
  });
}

export function buildPlantDetail(
  companyCode: string,
  plantCode: string,
  now: Date,
  scenario: Scenario,
  filters: { range: Range; process: Process | 'all'; shift: string },
): PlantDetail | null {
  const seed = COMPANIES.find((c) => c.code === companyCode);
  const plantSeed = seed?.plants.find((p) => p.code === plantCode);
  if (!seed || !plantSeed) return null;

  const status = siteStatusFor(seed, scenario);
  const plant = buildPlant(seed, plantSeed, now, scenario, status);
  const shift = resolveShift(seed, now);
  const machines = buildMachines(seed, plantSeed, plant, now);

  return {
    ...POLICY_BLOCK,
    meta: envelope(now, scenario),
    filters_applied: filters,
    company: {
      code: seed.code,
      name: seed.name,
      name_th: seed.nameTh,
      country_code: seed.countryCode,
      timezone: seed.timezone,
    },
    plant,
    shift: shift ? stripInternals(shift) : null,
    zones: buildZones(seed, plant, now),
    machines,
    output: shift
      ? {
          shift_code: shift.code,
          shift_label: shift.label,
          buckets: buildBuckets(shift, seed.timezone, now, `${seed.code}|${plantCode}`),
        }
      : null,
    trend: buildTrend(now, plant.kpi.oa_pct ?? 80, 1, plant.counts.total, `${seed.code}|${plantCode}`),
    alerts: [],
  };
}

function buildMachines(
  seed: CompanySeed,
  plantSeed: PlantSeed,
  plant: PlantSummary,
  now: Date,
): Machine[] {
  if (plant.counts.total === 0) return [];

  // Expand the census into individual machines so the grid and the counts can
  // never disagree - the same by_status map drives both.
  const queue: MachineStatus[] = [];
  for (const [status, n] of Object.entries(plant.counts.by_status) as [MachineStatus, number][]) {
    for (let i = 0; i < n; i++) queue.push(status);
  }

  const zoneCount = seed.code === 'ASI' ? 7 : Math.max(1, Math.ceil(plant.counts.total / 6));

  return queue.map((status, i) => {
    const id = `I${i + 1}`;
    const key = `${seed.code}|${plantSeed.code}|${id}|${bucketKey(now)}`;
    const r = rng(key);
    const running = BUCKET_OF[status] === 'running';
    const oa = running ? round1(plantSeed.oaCentre + (r() * 12 - 6)) : null;
    const plan = running ? Math.round(plantSeed.planQty / plant.counts.total) : 0;
    const actual = running ? Math.round(plan * (0.7 + r() * 0.45)) : null;
    const std = round1(14 + r() * 6);

    return {
      id,
      zone: `Z${(i % zoneCount) + 1}`,
      process: 'Injection',
      status,
      bucket: BUCKET_OF[status],
      status_since: new Date(now.getTime() - Math.round(r() * 240) * 60_000).toISOString(),
      mode: status === 'Mass Pro' ? 'Auto' : 'Manual',
      oa_pct: oa,
      oa_tier: tierOf(oa),
      achievement_pct: plan > 0 && actual !== null ? round1((actual / plan) * 100) : null,
      plan_qty: plan > 0 ? plan : null,
      actual_qty: actual,
      shot_count: actual === null ? null : Math.round(actual / 4),
      po_slots: running
        ? [
            {
              slot: 0,
              production_order: `1100007700${55 + (i % 40)}`,
              part_no: `640A-${100 + i}`,
              part_name: '640A HMSL HSG',
              plan_qty: plan,
              created_at: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
            },
          ]
        : [],
      std_time_sec: std,
      cycle_time_sec: running ? round1(std * (1 + r() * 0.25)) : null,
      avg_cycle_time_sec: running ? round1(std * (1 + r() * 0.18)) : null,
      time_mold_opening_sec: running ? round1(1.2 + r()) : null,
      time_mold_end_sec: running ? round1(0.8 + r()) : null,
      time_injection_sec: running ? round1(3.4 + r() * 2) : null,
      last_seen: plant.last_seen,
      grafana_url: null,
    };
  });
}

/** Exposed for the contract test so it can assert on the same instant. */
export { offsetString };
