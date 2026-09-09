import type {
  CompanyDetail,
  Kpi,
  Machine,
  OutputBucket,
  PlantDetail,
  PlantWithZones,
  Process,
  Range,
  ServedWindow,
  ShiftBreakdown,
  ZoneSummary,
} from '@dashboard/contract';
import {
  BUCKET_OF,
  resolveShift,
  stripInternals,
  type ResolvedShift,
} from '@dashboard/domain-shared';
import type { Env } from '../config/env.ts';
import { COMPANIES, type CompanyMasterData, type PlantMasterData } from '../config/masterData.ts';
import { buildPlantCensus } from '../domain/counts.ts';
import { achievementFrom, round1, type MachineOa } from '../domain/oa.ts';
import { sumHours, sumPlans, type MachineHourOa } from '../domain/trend.ts';
import type { LiveSnapshot, MachineObservation } from './liveSnapshot.ts';
import { buildGlobalOverview, buildKpi } from './globalOverviewService.ts';

/**
 * The two drill-downs: one company, and one plant inside it.
 *
 * ## Built on top of the board, not beside it
 *
 * Both of these call `buildGlobalOverview` with the region - and for a plant,
 * the Lamp filter - narrowed to the scope being asked for, and then read the
 * one company or the one plant out of the result. That is the whole trick, and
 * it is deliberate rather than lazy.
 *
 * The alternative was a second set of roll-ups computing the same counts, the
 * same %OA and the same site status from the same snapshot. Two implementations
 * of one arithmetic is how a drill-down ends up disagreeing with the card that
 * was clicked to reach it, and DESIGN.md §16 asks for the opposite: the board
 * and everything under it reconcile, because T-09 puts every denominator on the
 * server exactly once. Narrowing the same function is the only shape that keeps
 * that true by construction rather than by review.
 *
 * What each one adds on top is only what the board above genuinely does not
 * have: zone-level roll-ups, the machine list, the shift breakdown, and the
 * per-hour output table.
 *
 * ## What is null, and why
 *
 * Every quantity in the shift breakdown and the hourly output table WAS null,
 * because `machineHourOaSql` selected %OA and nothing else. It now selects the
 * three output columns too (2026-09-07), so pieces, shots, plan and
 * achievement are all real. The change was additive - the GROUP BY and the
 * three columns the ratio is computed from were not touched - and that was
 * verified rather than asserted: the board's 24 trend points were captured
 * either side of it and are identical, and `test/trend.test.ts` pins the 92.9%
 * bucket that was reconciled against the live instance.
 *
 * Two figures are still null, and both are honest absences rather than gaps:
 *
 *   ShiftBreakdown.running_avg   needs each machine's status sampled ACROSS the
 *                                shift; the census carries one instant.
 *   Machine.mode, the three §8.3 timing figures, and PO part_no/part_name
 *                                not selected by `latestMachineStatusSql`.
 *
 * `zQty` and `zPct` are nullable precisely so a figure the database was not
 * asked for is reported as unknown instead of as zero (R2), and every table
 * already renders a dash for it.
 */

interface ScopeInput {
  snapshot: LiveSnapshot;
  filters: { range: Range; process: Process | 'all' };
  window: ServedWindow;
  env: Env;
  now?: Date;
}

/**
 * The alert cut these endpoints ask the board for.
 *
 * The widest the picker offers, like the frontend's own `ALERT_LIMIT_MAX`: the
 * drill-downs show every stop they are given, and asking for a narrower slice
 * here would silently cap a plant's list at the global board's default.
 */
const SCOPE_ALERT_LIMIT = 50;

/** Runs the board narrowed to one scope, so every figure is the board's own. */
function scopedOverview(opts: ScopeInput & { region: string; plant: string }) {
  return buildGlobalOverview({
    snapshot: opts.snapshot,
    filters: {
      range: opts.filters.range,
      process: opts.filters.process,
      region: opts.region,
      plant: opts.plant,
      /* Zone is never narrowed by these endpoints. It is the global board's
         control and it is not in ScopeQuery or PlantQuery - the drill-downs
         show every zone the scope holds and group by it instead. */
      zone: 'all',
      alertsLimit: SCOPE_ALERT_LIMIT,
    },
    window: opts.window,
    env: opts.env,
    now: opts.now,
  });
}

/** The census observations for one plant, narrowed the way the board narrows them. */
function observationsFor(
  snapshot: LiveSnapshot,
  plant: PlantMasterData,
  process: Process | 'all',
): MachineObservation[] {
  const excluded = new Set(plant.machineExclusions);
  return (snapshot.machines[plant.code] ?? []).filter(
    (m) =>
      !excluded.has(m.machine) &&
      /* An untagged machine is kept by `all` and dropped by any narrower
         scope, exactly as globalOverviewService treats it: "we do not know
         which process this is" cannot satisfy "Injection only" without
         inventing the answer. */
      (process === 'all' || m.process === process),
  );
}

/** The %OA rows for one plant, narrowed to the same process as the census. */
function oaFor(snapshot: LiveSnapshot, plant: string, process: Process | 'all'): MachineOa[] {
  return snapshot.oa.filter(
    (m) => m.plant === plant && (process === 'all' || m.process === process),
  );
}

/**
 * Zone roll-ups for one plant.
 *
 * Zone is a tag on the machine and nothing above it carries one, so this groups
 * the census rather than asking the database a second question - the same
 * reasoning `MachineScope.zoneOf` records on the board. A machine with no zone
 * tag is left out of every zone rather than collected into a synthetic one:
 * inventing a bucket called "no zone" would put a number on a screen that no
 * zone on the shop floor answers for.
 */
function buildZones(
  observations: MachineObservation[],
  oa: MachineOa[],
  plant: PlantMasterData,
  asOf: Date,
): ZoneSummary[] {
  const byZone = new Map<string, MachineObservation[]>();
  for (const m of observations) {
    if (!m.zone) continue;
    const list = byZone.get(m.zone) ?? [];
    list.push(m);
    byZone.set(m.zone, list);
  }

  return [...byZone.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, members]) => {
      const ids = new Set(members.map((m) => m.machine));
      const census = buildPlantCensus({
        observations: members,
        machineExclusions: plant.machineExclusions,
      });
      const lastSeen = latestSeen(members);
      return {
        code,
        /* No label. Zone tags are the label - `2A-A` is what the sign on the
           floor says and what `Zone_var` holds - and there is no second name
           for them in master data to print instead. */
        label: null,
        status: siteStatusOf(census.counts.total, lastSeen, asOf),
        data_readiness: 'live' as const,
        last_seen: lastSeen,
        /* No per-zone Grafana board exists; the plant's link already lands on
           the zones in scope. A URL invented here would 404. */
        grafana_url: null,
        /* A zone is only reachable at all because its plant's telemetry is
           arriving - these rows are built FROM those rows - so a zone can never
           be the site nobody can reach, and has no absence to explain. */
        absence: null,
        counts: census.counts,
        kpi: buildKpi(oa.filter((m) => ids.has(m.machine))),
      };
    });
}

/** The newest `last_seen` in a set of observations, or null when none reported. */
function latestSeen(observations: MachineObservation[]): string | null {
  let newest: string | null = null;
  for (const m of observations) {
    if (m.lastSeen && (newest === null || m.lastSeen > newest)) newest = m.lastSeen;
  }
  return newest;
}

/**
 * Whether a zone is reporting, on the same rule the sites above it use: it has
 * machines and something in it has been heard from inside the freshness window.
 * Anything else is `no_data` rather than a guess.
 */
function siteStatusOf(total: number, lastSeen: string | null, asOf: Date) {
  if (total === 0 || lastSeen === null) return 'no_data' as const;
  const ageSec = (asOf.getTime() - Date.parse(lastSeen)) / 1000;
  return ageSec <= 900 ? ('online' as const) : ('no_data' as const);
}

export function buildCompanyDetail(opts: ScopeInput & { company: string }): CompanyDetail | null {
  const master = COMPANIES.find((c) => c.code === opts.company);
  if (!master) return null;

  const overview = scopedOverview({ ...opts, region: master.code, plant: 'all' });
  const summary = overview.companies[0];
  if (!summary) return null;

  const asOf = new Date(Date.parse(overview.window.to) || Date.now());

  /* `plants` comes off because CompanyDetail carries a richer plant - the same
     PlantSummary with its zones attached - and the rest of the summary IS the
     company block, field for field. */
  const { plants, ...company } = summary;

  const withZones: PlantWithZones[] = plants.map((p) => {
    const seed = master.plants.find((mp) => mp.code === p.code);
    const observations = seed ? observationsFor(opts.snapshot, seed, opts.filters.process) : [];
    const oa = oaFor(opts.snapshot, p.code, opts.filters.process);
    return { ...p, zones: seed ? buildZones(observations, oa, seed, asOf) : [] };
  });

  return {
    ...policyOf(overview),
    meta: overview.meta,
    filters_applied: { range: opts.filters.range, process: opts.filters.process },
    company,
    shift_config: master.shiftConfig,
    shift_breakdown: buildShiftBreakdown(master, opts.snapshot.trend, plantCodes(master), asOf),
    plants: withZones,
    trend: overview.trend,
    alerts: overview.alerts,
  };
}

export function buildPlantDetail(
  opts: ScopeInput & { company: string; plant: string; shift: string },
): PlantDetail | null {
  const master = COMPANIES.find((c) => c.code === opts.company);
  const seed = master?.plants.find((p) => p.code === opts.plant);
  if (!master || !seed) return null;

  const overview = scopedOverview({ ...opts, region: master.code, plant: seed.code });
  const summary = overview.companies[0];
  const plant = summary?.plants.find((p) => p.code === seed.code);
  if (!summary || !plant) return null;

  const asOf = new Date(Date.parse(overview.window.to) || Date.now());
  const observations = observationsFor(opts.snapshot, seed, opts.filters.process);
  const oa = oaFor(opts.snapshot, seed.code, opts.filters.process);
  const shift = resolveShift(master.shiftConfig, asOf);

  return {
    ...policyOf(overview),
    meta: overview.meta,
    filters_applied: {
      range: opts.filters.range,
      process: opts.filters.process,
      shift: opts.shift,
    },
    company: {
      code: master.code,
      name: master.name,
      name_th: master.nameTh,
      country_code: master.countryCode,
      timezone: master.timezone,
    },
    plant,
    shift: shift ? stripInternals(shift) : null,
    zones: buildZones(observations, oa, seed, asOf),
    machines: buildMachines(observations, oa, plant.grafana_url),
    output: buildOutput(shift, opts.snapshot.trend, [seed.code], asOf),
    trend: overview.trend,
    alerts: overview.alerts,
  };
}

/** The policy block, echoed from the board so both answer with one policy. */
function policyOf(overview: ReturnType<typeof buildGlobalOverview>) {
  return {
    target_oa: overview.target_oa,
    tier_policy: overview.tier_policy,
    oa_aggregation: overview.oa_aggregation,
    freshness: overview.freshness,
    qty_unit: overview.qty_unit,
  };
}

function plantCodes(master: CompanyMasterData): string[] {
  return master.plants.map((p) => p.code);
}

/**
 * One card per machine.
 *
 * The census answers what it is doing; the %OA rows answer how well the order
 * it has loaded is going. Joined on the machine id, and a machine present in
 * one and not the other keeps whichever half exists rather than being dropped -
 * a machine reporting status but no shots is a real and common state, and it is
 * the state the card most needs to show.
 *
 * Six fields are `null` for every machine, and they are the six the poller does
 * not select: `mode`, the three §8.3 timing figures, and the part number and
 * name on each PO slot. They are nullable in the contract for exactly this
 * reason. Adding them is a column change in `latestMachineStatusSql`, not a
 * default that can be guessed here.
 */
function buildMachines(
  observations: MachineObservation[],
  oa: MachineOa[],
  plantGrafanaUrl: string | null,
): Machine[] {
  const oaById = new Map(oa.map((m) => [m.machine, m]));

  return observations
    .slice()
    .sort((a, b) => a.machine.localeCompare(b.machine))
    .map((m): Machine => {
      const o = oaById.get(m.machine);
      const kpi: Kpi | null = o ? buildKpi([o]) : null;
      return {
        id: m.machine,
        zone: m.zone,
        process: (m.process as Process | null) ?? null,
        status: m.status,
        bucket: BUCKET_OF[m.status],
        status_since: m.statusStartTime === null ? null : new Date(m.statusStartTime).toISOString(),
        /* Not selected by the poller - see the note above. */
        mode: null,
        oa_pct: o?.oaPct ?? null,
        oa_tier: kpi?.oa_tier ?? 'unknown',
        achievement_pct: achievementFrom(o?.planQty ?? null, o?.actualQty ?? null),
        plan_qty: o?.planQty ?? null,
        actual_qty: o?.actualQty ?? null,
        shot_count: o?.shotCount ?? null,
        /*
         * `_`, not `|` - and that one character is why this array never held
         * more than one order.
         *
         * `groupPo` is assembled in domain/oa.ts as `slots.join('_')`, because
         * DESIGN.md's `Group_PO` is `PO0_PO1_PO2_PO3` by definition. Split on a
         * pipe, the join never came apart: a machine running two orders arrived
         * as ONE slot whose `production_order` was the literal
         * `110000992269_110000992268`, and the card captioned it "1 of 4 PO".
         *
         * That is wrong exactly where it is load-bearing. D-27 records that %OA
         * scales with the number of loaded slots - THS 6332 I4 reads 57% on one
         * order and 114% on the same order paired with a second - so the slot
         * count is the fact a reader needs in order to interpret the figure
         * beside it, and the card was reporting one slot for every machine on
         * the floor.
         *
         * The split is the inverse of the join and rests on the same assumption
         * the join already makes: a production order carries no underscore of
         * its own. They are 12-digit numbers in every sample in this repo and on
         * the operator board, which writes the same group as
         * `110000961179 (+1)`.
         */
        po_slots: (o?.groupPo ?? '')
          .split('_')
          .filter((po) => po.length > 0)
          .map((po, i) => ({
            slot: i,
            production_order: po,
            part_no: null,
            part_name: null,
            plan_qty: o?.planQty ?? null,
            created_at: null,
          })),
        std_time_sec: null,
        cycle_time_sec: null,
        avg_cycle_time_sec: null,
        time_mold_opening_sec: null,
        time_mold_end_sec: null,
        time_injection_sec: null,
        last_seen: m.lastSeen,
        /* The plant's board, which is where a machine's row lives. There is no
           per-machine Grafana view to link to. */
        grafana_url: plantGrafanaUrl,
      };
    });
}

/**
 * The %OA of one set of hourly rows.
 *
 * A simple mean over the machines that reported a figure, which is the same
 * aggregation `oa_aggregation` names for every other %OA on this board. Null -
 * never 0 - when no machine reported one: an hour nobody produced in has no
 * efficiency, and printing 0% would read as a catastrophe rather than as
 * silence.
 */
function meanOa(rows: MachineHourOa[]): number | null {
  const values = rows.map((r) => r.oaPct).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  /* `round1`, like every other %OA the server emits. Left unrounded this
     shipped `76.26440677966104` into a shift row sitting under a company card
     reading `78.1`, which reads as two different kinds of number rather than
     the same measure at two scopes - and the extra digits are noise on an
     average of hourly figures that were themselves rounded to one place. */
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * The shift table on the company page - the only place section 9.5's n-shift
 * model becomes visible.
 *
 * Built from the shift configuration and the hourly rows: the config says where
 * each shift starts and ends, and the rows inside those bounds give its %OA.
 * The quantities are null for the reason at the top of this file.
 *
 * `state` is what stops a half-finished shift being read as a failure. It is
 * derived from the clock against the shift's own bounds, so a shift that has
 * not started shows as `not_started` and the table prints a dash rather than a
 * zero for every figure in the row.
 */
function buildShiftBreakdown(
  master: CompanyMasterData,
  trend: MachineHourOa[],
  plants: string[],
  asOf: Date,
): ShiftBreakdown[] {
  const config = master.shiftConfig;
  if (!config) return [];

  const current = resolveShift(config, asOf);
  if (!current) return [];

  const inScope = new Set(plants);
  const rows: ShiftBreakdown[] = [];

  for (let i = 0; i < config.shifts.length; i += 1) {
    const spec = config.shifts[i];
    /* Every shift of the production day the CURRENT one belongs to, so the
       table describes one day rather than a rolling window. resolveShift gives
       the bounds of the shift in force; the others are offset from its own
       production date by the config's clock times. */
    const bounds = shiftBoundsFor(current, config, i);
    if (!bounds) continue;

    const rowsIn = trend.filter(
      (r) => inScope.has(r.plant) && r.ts >= bounds.startUtc && r.ts < bounds.endUtc,
    );

    rows.push({
      shift_code: spec.code,
      shift_label: spec.label,
      index: i + 1,
      of: config.shifts.length,
      state: stateOf(bounds, asOf),
      start_local: bounds.startLocal,
      end_local: bounds.endLocal,
      duration_min: bounds.durationMin,
      qty_pcs: sumHours(rowsIn, (h) => h.qtyPcs),
      shot_count: sumHours(rowsIn, (h) => h.shotCount),
      /* `sumPlans`, not a sum of the hourly totals. A twelve-hour shift running
         one order sees that order's plan in twelve buckets, and adding them
         would report a 400-piece order as 4,800 - see the note on `plans` in
         domain/trend.ts. */
      plan_qty: sumPlans(rowsIn),
      achievement_pct: achievementFrom(sumPlans(rowsIn), sumHours(rowsIn, (h) => h.qtyPcs)),
      oa_pct: meanOa(rowsIn),
      /* Still null, and the only figure in this row that is. It needs each
         machine's status sampled across the shift, and the census carries one
         instant - the status a machine holds NOW - not a history of them. */
      running_avg: null,
    });
  }

  return rows;
}

interface Bounds {
  startUtc: string;
  endUtc: string;
  startLocal: string;
  endLocal: string;
  durationMin: number;
}

/**
 * The bounds of shift `index` on the production day the resolved shift belongs
 * to.
 *
 * Only the shift actually in force is resolved from the clock; the others are
 * placed relative to it, which is what keeps a two-shift day from reporting one
 * shift on Tuesday and the other on Wednesday. A shift whose clock times cross
 * midnight is carried by the same rule `resolveShift` already applies.
 */
function shiftBoundsFor(
  current: ResolvedShift,
  config: CompanyMasterData['shiftConfig'],
  index: number,
): Bounds | null {
  if (!config) return null;
  const spec = config.shifts[index];
  if (!spec) return null;

  /* The current shift's own bounds are authoritative; every other shift is the
     same length placed by its offset in the rotation, which is exact for the
     equal-length patterns master data holds today (THS and ASI both run two
     twelve-hour shifts) and is why `duration_min` is computed rather than
     assumed to be 60 anywhere downstream. */
  const currentIndex = config.shifts.findIndex((s) => s.code === current.code);
  if (currentIndex < 0) return null;

  /* `startUtc` and `endUtc` are Dates on ResolvedShift, not strings. */
  const startMs = current.startUtc.getTime();
  const endMs = current.endUtc.getTime();
  const lengthMs = endMs - startMs;
  const offset = (index - currentIndex) * lengthMs;

  const start = new Date(startMs + offset);
  const end = new Date(endMs + offset);

  return {
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    startLocal: toLocal(start, config.timezone),
    endLocal: toLocal(end, config.timezone),
    durationMin: lengthMs / 60_000,
  };
}

function stateOf(bounds: Bounds, asOf: Date): ShiftBreakdown['state'] {
  const now = asOf.getTime();
  if (now < Date.parse(bounds.startUtc)) return 'not_started';
  if (now >= Date.parse(bounds.endUtc)) return 'complete';
  return 'in_progress';
}

/**
 * The hourly output table on the plant page.
 *
 * One bucket per hour of the shift in force. `duration_min` is carried on every
 * bucket and is never assumed to be 60 - section 9.5's 22:15 problem is exactly
 * a shift whose last bucket is fifteen minutes, and a table that assumes an
 * hour draws that as a collapse in output.
 */
function buildOutput(
  shift: ResolvedShift | null,
  trend: MachineHourOa[],
  plants: string[],
  asOf: Date,
): PlantDetail['output'] {
  if (!shift) return null;

  const inScope = new Set(plants);
  const startMs = shift.startUtc.getTime();
  const endMs = shift.endUtc.getTime();
  const buckets: OutputBucket[] = [];

  for (let t = startMs, index = 1; t < endMs; t += 3_600_000, index += 1) {
    const bucketEnd = Math.min(t + 3_600_000, endMs);
    const durationMin = (bucketEnd - t) / 60_000;
    const from = new Date(t).toISOString();
    const to = new Date(bucketEnd).toISOString();
    const rowsIn = trend.filter((r) => inScope.has(r.plant) && r.ts >= from && r.ts < to);
    const qty = sumHours(rowsIn, (h) => h.qtyPcs);

    buckets.push({
      index,
      /*
       * No `label` here any more. This built one - `${clock(t, tz)}-...` in the
       * site's own zone - and it was the only pre-formatted timestamp the API
       * emitted. That made the hourly table the one clock on the board the
       * display-zone picker could not move, because formatting had already
       * discarded the offset the client needed to re-zone it. The bounds below
       * are the instants; the UI formats them per reader. See zOutputBucket.
       */
      start_utc: from,
      end_utc: to,
      duration_min: durationMin,
      is_partial: durationMin < 60,
      state:
        asOf.getTime() < t
          ? 'not_started'
          : asOf.getTime() >= bucketEnd
            ? 'complete'
            : 'in_progress',
      qty_pcs: qty,
      qty_shots: sumHours(rowsIn, (h) => h.shotCount),
      /*
       * Null, deliberately, and this is the one figure here that was harder to
       * leave out than to fill in.
       *
       * `sumPlans` over an hour returns a real number - the lot sizes of the
       * orders that ran in it - and it was briefly shipped. Measured on the
       * live instance it read `plan=1263` beside `pcs=28` in the 08:00 bucket,
       * because a lot size is what the ORDER is for, not what the hour is for:
       * a 400-piece order running across twelve hours is not a 400-piece plan
       * in each of them. A reader dividing the two columns the table puts side
       * by side would have read 2% and gone looking for a stopped plant.
       *
       * There is no hourly target anywhere in the source data, so the honest
       * answer is that this is unknown (R2). The shift row above is different
       * and does carry it: a shift is the window an order is actually planned
       * against, which is the same window Q-04 divides over.
       */
      plan_qty: null,
      /*
       * The only figure comparable across unequal buckets, which is what makes
       * it the row a reader scans: section 9.5's 22:00-22:15 bucket produces a
       * quarter of an hour's pieces, and beside a full hour that reads as a
       * collapse until it is divided by its own length.
       */
      qty_per_hour: qty === null ? null : Math.round(qty / (durationMin / 60)),
      oa_pct: meanOa(rowsIn),
    });
  }

  return { shift_code: shift.code, shift_label: shift.label, buckets };
}

/** An ISO instant with the site's own offset, which is what zIsoOffset wants. */
function toLocal(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const local = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
  const offsetMin = Math.round((local - at.getTime()) / 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${sign}${hh}:${mm}`;
}

/** Re-exported so the routes can 404 on a code master data has never heard of. */
export function knownCompany(code: string): boolean {
  return COMPANIES.some((c) => c.code === code);
}

