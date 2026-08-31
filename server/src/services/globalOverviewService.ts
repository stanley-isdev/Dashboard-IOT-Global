import type {
  CompanySummary,
  FiltersApplied,
  GlobalOverview,
  Kpi,
  PlantSummary,
  Process,
} from '@dashboard/contract';
import { plantFilterActive, plantMatcher, regionMatcher } from '@dashboard/contract';
import {
  addCounts,
  DEFAULT_LINK_PROCESS,
  deriveTier,
  emptyCounts,
  isReporting,
  machineStatusUrl,
  representativePlant,
  resolveShift,
  stripInternals,
  toIsoOffset,
} from '@dashboard/domain-shared';
import type { Env } from '../config/env.ts';
import {
  COMPANIES,
  type CompanyMasterData,
  type PlantMasterData,
} from '../config/masterData.ts';
import { FRESHNESS, POLICY_BLOCK, TIER_POLICY } from '../config/policy.ts';
import { buildPlantCensus } from '../domain/counts.ts';
import { buildEnvelope } from '../domain/envelope.ts';
import {
  achievementFrom,
  achievementWarnings,
  averageOa,
  oaWarnings,
  orderShiftWarnings,
  splitByOrderShift,
  sumMachineField,
  type MachineOa,
} from '../domain/oa.ts';
import { latestSeen, plantStatusFrom, rollUpCompanyStatus } from '../domain/siteStatus.ts';
import { buildTrend, trendWarnings } from '../domain/trend.ts';
import { TREND_POINTS } from '../influx/queries.ts';
import { sourceHealthFrom } from '../lib/sourceHealth.ts';
import type { LiveSnapshot } from './liveSnapshot.ts';

/**
 * `GET /api/v1/global-overview`.
 *
 * Phase 1 made `status` / `last_seen` / `meta.sources` real. Phase 2 makes the
 * machine census real (Q-01/Q-02), with **TOTAL = RUNNING + STOP** as the
 * design owner set it on 2026-08-25 - see server/src/domain/counts.ts for what
 * that excludes and why `machinesExpected` (Q-08) no longer feeds it.
 *
 * Phase 3 makes **%OA** real (Q-03), reconciled against the production board -
 * see server/src/domain/oa.ts for what the number means, which machines are in
 * the average and why it is a plain mean. It also makes **%Achievement** real (Q-04) - see `planFromSlots` in
 * server/src/domain/oa.ts for why the plan is `MAX`, not `SUM`, and
 * `ACHIEVEMENT_SCOPE_WARNING` for what the ratio is measured against. What
 * stays `null` is downtime (needs `StatusStartTime`) and defect (D-18, out of
 * scope) - `null` rather than `0`, because the contract's rule R2 says absence
 * is never a fabricated zero.
 *
 * Phase 4 makes the **hourly trend** real (Q-05) - see server/src/domain/trend.ts.
 * It is filtered through exactly the gates the KPI strip is, so the chart is a
 * history of the machines the cards are measuring. It deliberately does NOT
 * print the same number as the strip: the strip is the order each machine has
 * loaded now over a rolling 24 h, the chart is every order worked in each clock
 * hour. What is left is `alerts` (Q-06, an open decision).
 *
 * Phase 5 (2026-08-27) **reconciles the census and %OA against the production
 * board**, using the panel source recovered into
 * docs/grafana/MACHINE-STATUS-V2.md. Measured at THS before and after:
 *
 * ```
 *            expected     before      after
 * TOTAL            29         19         29
 * RUNNING          19          5         19
 * STOP              9         14          9
 * Avg %OA       81.0%      75.2%      81.0%
 * ```
 *
 * Three divergences were found and closed. Each is documented where it lives:
 *
 *   1. **Status window 2 h -> 24 h** (`influx/queries.ts`). The board's window.
 *      The old 2 h rested on two measurements that no longer hold, and cost
 *      THS ten machines.
 *   2. **TOTAL = everything except `Order End`** (`domain/counts.ts`), which is
 *      the board's `EXCLUDE_FROM_TOTAL`, replacing TOTAL = RUNNING + STOP.
 *   3. **`Order End` layer 2** (`domain/orderShift.ts`) now excludes a machine
 *      whose loaded order was created in an earlier shift from %OA - the last
 *      6 points of the %OA gap.
 *
 * A fourth was tried and **reverted**: filtering to `process = 'Injection'` the
 * way the per-process board does. It undercounts - THS has 29 machines and only
 * 27 of them are injection. See `config/policy.ts` for why no process filter
 * belongs on an exec board.
 *
 * Two known, named divergences remain, both on the envelope:
 *
 *   - **Stale machines keep their last known status** rather than becoming
 *     `Offline`, because the board does the same (T-11 / F-07). A machine
 *     silent for 8 h still reads `Mass Pro`. Accepted by the design owner on
 *     2026-08-27; closing it is a staleness cutoff in `domain/counts.ts`.
 *   - **An unreadable order-creation time keeps the machine in %OA**, where the
 *     board would blank it. Zero occurrences measured - see `splitByOrderShift`.
 *
 * `machineExclusions` stays empty, and that remains a decision rather than a
 * gap: DESIGN.md §10's hardcoded list was decoded, the plant owner confirmed
 * the exclusion was retired upstream, and the board's own `AVG %OA 69.8%` only
 * reconciles if `IA1` is counted. The panel source confirms it independently -
 * the recovered query carries no machine exclusion at all (F-17).
 */

const KPI_WARNING =
  'phase-4: %OA (Q-03), %Achievement (Q-04) and the hourly trend (Q-05) are real. The two %OA figures answer different questions and will not match: the KPI strip is the order each machine has loaded NOW over a rolling 24 h - the rule the production board follows - while each trend point is every order worked in that clock hour. Downtime is still null (StatusStartTime is a Float64 of unknown epoch), alerts are an open decision (Q-06) and defect is out of scope (D-18)';

/**
 * What `plan_qty` actually is, said on the payload rather than left to the
 * card's label to imply. It is the lot size of the loaded production order -
 * ASI's are all exactly 700, THS's are 400 / 309 / 220 / 816 - so the card
 * measures progress THROUGH an order, not attainment against a shift or daily
 * target. A machine that has just started a large order honestly reads a few
 * per cent, while an executive reading "%Achievement" hears "behind plan
 * today". That is the same shape of defect as D-19 is for %OA, and it needs a
 * label/tooltip decision from the design-doc owner, not a different number.
 */
const ACHIEVEMENT_SCOPE_WARNING =
  '%Achievement is output against the LOT SIZE of the order each machine has loaded now (plan_qty0..3 of the current PO group), not against a shift or daily target - a machine early in a large order reads low by construction. An order shared across machines would be counted once per machine; none were observed (26 orders, 0 shared)';

const RECONCILIATION_WARNING =
  'counts and %OA follow the `Machine Status V2.0` board: 24 h window, TOTAL excludes `Order End` only, and a machine whose loaded order was created in an earlier shift leaves the %OA average (DESIGN.md §8.4 layer 2). Counted across ALL processes, unlike that board, which shows one `process_var` at a time - THS has 29 machines and only 27 are Injection, so a plant card here can read higher than the drill-down it links to. Two deliberate differences remain: a machine that has not reported for hours keeps its last known status instead of reading `Offline` - the board does the same, and closing it would move RUNNING away from it (T-11) - and a machine whose order-creation time cannot be parsed stays in %OA rather than being blanked. machineExclusions is empty by decision: the recovered panel query carries no machine exclusion';

/**
 * The KPI block for a node, from the machines beneath it.
 *
 * `machines` is always the MACHINE list, never the level below - see
 * `averageOa`. An empty list yields nulls throughout, which is what a site with
 * no telemetry must report.
 */
function buildKpi(machines: MachineOa[]): Kpi {
  const oaPct = averageOa(machines);
  // Q-04. Both sums are over the SAME machine set and the SAME scope as
  // `oa_pct` - the order each machine has loaded now - because the card shows
  // the plan, the output and the ratio together. Summing the plans of every
  // order the machines touched in the 24 h window instead would put plan 16,881
  // beside actual 665 on plant 6332 and call it 12.3%.
  const plan = sumMachineField(machines, (m) => m.planQty);
  const actual = sumMachineField(machines, (m) => m.actualQty);
  return {
    oa_pct: oaPct,
    oa_tier: deriveTier(oaPct, TIER_POLICY),
    // The denominator of the average above, so the card can state it. Counts
    // the machines that actually contributed - not the ones excluded for having
    // no order, no standard time, or several orders in one shot.
    oa_machine_count: machines.filter((m) => m.oaPct !== null).length,
    achievement_pct: achievementFrom(plan, actual),
    plan_qty: plan,
    actual_qty: actual,
    shot_count: sumMachineField(machines, (m) => m.shotCount),
    // Not `0`. A site with no measured window has not had a downtime-free
    // window; it has had no window at all. Needs `StatusStartTime`, which is a
    // Float64 of unknown epoch in the live schema (§4.3d).
    downtime_sec: null,
  };
}

function buildCompany(
  company: CompanyMasterData,
  snapshot: LiveSnapshot,
  oaByPlant: Map<string, MachineOa[]>,
  now: Date,
  warnings: string[],
  plantInScope: (p: { code: string }) => boolean,
  processInScope: (m: { process: string | null }) => boolean,
  /**
   * The one process the Grafana drill-down opens on. Not `all`: the board's
   * SQL compares `"process"` to a single value, so a link has to choose even
   * where this board does not (config/policy.ts).
   */
  linkProcess: Process,
): { company: CompanySummary; oaMachines: MachineOa[]; oaPlants: PlantMasterData[] } {
  const nowMs = now.getTime();

  /**
   * The zones this plant is reporting on the process the link opens on, so the
   * board lands on rows instead of on its own default zone. Empty when the
   * plant is silent - the shared grafana.ts then leaves `Zone_var` alone rather
   * than inventing one.
   */
  const zonesOf = (plantCode: string): string[] => {
    const zones = new Set<string>();
    for (const m of snapshot.machines[plantCode] ?? []) {
      if (m.zone && (m.process === null || m.process === linkProcess)) zones.add(m.zone);
    }
    return [...zones].sort();
  };

  const grafanaUrlFor = (plant: PlantMasterData): string =>
    machineStatusUrl({
      plantCode: plant.code,
      process: linkProcess,
      timezone: company.timezone,
      zones: zonesOf(plant.code),
    });

  /*
   * The Lamp filter is applied HERE, before liveness, so every figure above it
   * is built from the same plant set: status roll-up, counts, %OA and the trend
   * all narrow together. Filtering later - say, only the counts - is how a
   * company ends up reading `online` off plants whose machines are not in its
   * own total.
   */
  const scopedPlants = company.plants.filter(plantInScope);

  // Pass 1: liveness only. The company's status is a roll-up of its plants',
  // and whether the company reports decides whether anything may be counted.
  const base = scopedPlants.map((master) => {
    // Keyed on plant code, because `codeCompany` is NULL on almost every row
    // (BACKEND-HANDOVER §4.3a). Master data owns plant -> company.
    const lastSeen =
      company.readiness === 'live' ? (snapshot.plants[master.code]?.lastSeen ?? null) : null;
    return {
      master,
      lastSeen,
      status: plantStatusFrom({
        readiness: company.readiness,
        lastSeen,
        nowMs,
        freshness: FRESHNESS,
      }),
    };
  });

  const status = rollUpCompanyStatus(
    company.readiness,
    base.map((b) => b.status),
  );
  // A site that is not reporting contributes nothing to any census, at any
  // level - the `unconnected-site-contributes-nothing` invariant. Its plants
  // are zeroed too, so a company never disagrees with the sum of its plants.
  const reporting = isReporting(status);

  // Resolved before the plants are built, not after: `Order End` layer 2 judges
  // each machine's loaded order against THIS company's current shift, so the
  // shift has to exist before any plant's %OA set is decided.
  const shift = resolveShift(company.shiftConfig, now);

  const built = base.map((b) => {
    const census = reporting
      ? buildPlantCensus({
          /*
           * Gated on the COMPANY reporting, not on this plant's freshness label.
           *
           * It used to be gated on both, so a plant that had aged past
           * `no_data_after_sec` (15 min) contributed nothing even while its
           * machine rows sat inside the query window. With the window now 24 h
           * that gap is hours wide, and it cost real machines: THS 6338's
           * freshest row was 310 min old on 2026-08-27, so the board showed its
           * one machine and we showed none.
           *
           * The board has no freshness concept at all - it counts whatever is in
           * its 24 h window - so matching it means the census follows the window
           * and the freshness LABEL travels beside it instead of erasing it.
           * `last_seen` and the plant's `status` still say the site is quiet, so
           * the row reads "no data · 1 running", which is strictly more than the
           * board says rather than less.
           *
           * The company-level gate stays, and it is what keeps the
           * `unconnected-site-contributes-nothing` invariant true: a company
           * whose plants have ALL gone silent rolls up to `no_data` and zeroes
           * here.
           */
          observations: (snapshot.machines[b.master.code] ?? []).filter(processInScope),
          machineExclusions: b.master.machineExclusions,
        })
      : null;

    // `Order End` is the board's only exclusion from TOTAL, and it exists there
    // to avoid double-counting a machine that also has a live card. Said on the
    // payload anyway - a number dropped from a display is a presentation
    // choice; a number dropped without a trace is a lie.
    if (census && census.notCounted > 0) {
      warnings.push(
        `${company.code}/${b.master.code}: ${census.notCounted} of ${census.observed} reporting machines are in \`Order End\` and are excluded from TOTAL, as they are on the production board`,
      );
    }

    /*
     * %OA comes from a different table than the census - `production_machine_io`
     * rather than `production_machine_status` - so the two machine sets are not
     * guaranteed to agree, and this deliberately does not force them to. The old
     * board's %OA cards are driven by the IO rows too, so reconciling means
     * following the same source. Where they disagree the payload shows both
     * honestly: a machine can be counted as Stop and still carry a %OA for the
     * order it has loaded, which is exactly what I5 did on the board (STOP, with
     * order 110000962985 at 47.5%).
     *
     * Gated on the company reporting, the same gate the census now uses - a
     * plant's own freshness label no longer suppresses its figures, because the
     * board it is reconciled against has no such concept. See the census gate
     * above for what that changed and why.
     */
    const publishes = reporting;
    const observedOa = publishes
      ? (oaByPlant.get(b.master.code) ?? [])
          .filter((m) => !b.master.machineExclusions.includes(m.machine))
          // Same process gate as the census above it. A %OA averaged over a
          // different machine set than the one TOTAL counts is the defect the
          // whole filter row exists to prevent.
          .filter(processInScope)
      : [];

    /*
     * `Order End` layer 2 (DESIGN.md §8.4): a machine whose loaded order was
     * created in an earlier shift has its figures blanked on the board and so
     * drops out of its %OA average. Judged against THIS company's shift, not a
     * hardcoded 08:00/20:00 - the panel hardcodes that split and §9.5 records
     * that it is wrong for STJ's three shifts.
     *
     * This is what closes the last %OA gap against the board: 75.2% -> 81.0% at
     * THS on 2026-08-27. See domain/orderShift.ts for why BACKEND-HANDOVER
     * §4.5(c) concluded it could not be done, and what the panel source shows.
     */
    const oaSplit = splitByOrderShift(observedOa, shift);
    const oaMachines = oaSplit.current;

    const node = `${company.code}/${b.master.code}`;
    for (const w of orderShiftWarnings(node, oaSplit)) warnings.push(w);
    for (const w of oaWarnings(node, oaMachines)) warnings.push(w);
    for (const w of achievementWarnings(node, oaMachines)) warnings.push(w);

    const plant: PlantSummary = {
      code: b.master.code,
      label: b.master.label,
      status: b.status,
      data_readiness: company.readiness,
      // Kept even when the plant has aged into `no_data`: "last seen 40 minutes
      // ago" is the fact that separates a quiet site from a dead one (T-11).
      last_seen: b.lastSeen,
      grafana_url: grafanaUrlFor(b.master),
      target_oa: b.master.targetOa,
      counts: census ? census.counts : emptyCounts(),
      kpi: buildKpi(oaMachines),
    };
    return { plant, oaMachines, publishes, master: b.master };
  });

  const plants: PlantSummary[] = built.map((b) => b.plant);
  // Flat, not a mean of the plant means: one definition of "average %OA" for
  // every level of the board. See averageOa.
  const oaMachines = built.flatMap((b) => b.oaMachines);
  /*
   * Which plants passed the liveness gate, for the trend (Q-05) to filter by.
   *
   * The trend cannot reuse `oaMachines`: those are the machines with an order
   * loaded NOW, and an hour on the chart is measured over whatever was running
   * THEN - a machine that finished its order twenty minutes ago belongs on the
   * 06:00 point and is absent from this list. Gating by plant is the same gate
   * one level up, so a site that has aged into `no_data` still stops publishing
   * a chart, without also erasing the hours it produced before it went quiet.
   */
  const oaPlants = built.filter((b) => b.publishes).map((b) => b.master);

  /*
   * A company row links to a PLANT board, because there is no company one -
   * see @dashboard/domain-shared. Chosen from the scoped plants, so the link follows
   * the Lamp filter, and preferring one that is actually on the air: at THS
   * that is 6332, the only one of its four reporting.
   */
  const companyLink = representativePlant(scopedPlants, (code) =>
    Boolean(snapshot.plants[code]?.lastSeen),
  );

  return {
    company: {
      code: company.code,
      name: company.name,
      name_th: company.nameTh,
      country_code: company.countryCode,
      lat: company.lat,
      lng: company.lng,
      timezone: company.timezone,
      local_time: toIsoOffset(now, company.timezone),
      shift: shift ? stripInternals(shift) : null,
      status,
      data_readiness: company.readiness,
      last_seen:
        company.readiness === 'live' ? latestSeen(plants.map((p) => p.last_seen)) : null,
      grafana_url: companyLink ? grafanaUrlFor(companyLink) : null,
      counts: reporting ? addCounts(plants.map((p) => p.counts)) : emptyCounts(),
      kpi: buildKpi(oaMachines),
      plants,
    },
    oaMachines,
    oaPlants,
  };
}

/**
 * Plant code to the company that owns it. Master data is the only place this
 * mapping exists - InfluxDB leaves `codeCompany` NULL on 98.6% of rows
 * (BACKEND-HANDOVER §4.3a), so a plant with no entry here belongs to nobody on
 * this board and is reported as an orphan rather than guessed into a company.
 */
const companyOfPlant = new Map<string, string>(
  COMPANIES.flatMap((c) => c.plants.map((p) => [p.code, c.code] as const)),
);

/**
 * Groups the flat %OA rows by plant once per request. Built here rather than in
 * the poller because the poller's job is to fetch, and a plant code that master
 * data has never heard of has to survive the trip to be reported - dropping it
 * at fold time would hide a real gap between InfluxDB and the config.
 */
function indexOaByPlant(rows: MachineOa[]): Map<string, MachineOa[]> {
  const out = new Map<string, MachineOa[]>();
  for (const row of rows) {
    const list = out.get(row.plant);
    if (list) list.push(row);
    else out.set(row.plant, [row]);
  }
  return out;
}

/** True age of the underlying data, so the UI shows when it was read, not when it was sent. */
function cacheAgeSec(snapshot: LiveSnapshot, nowMs: number): number | undefined {
  if (!snapshot.lastSuccessAt) return undefined;
  const ms = nowMs - new Date(snapshot.lastSuccessAt).getTime();
  return Number.isNaN(ms) ? undefined : Math.max(0, Math.round(ms / 1000));
}

export function buildGlobalOverview(opts: {
  snapshot: LiveSnapshot;
  filters: FiltersApplied;
  env: Env;
  now?: Date;
}): GlobalOverview {
  const now = opts.now ?? new Date();
  const { snapshot, filters, env } = opts;

  const warnings = [KPI_WARNING, ACHIEVEMENT_SCOPE_WARNING, RECONCILIATION_WARNING];

  /*
   * The Process filter - the plant board's `${process_var}`, and now really
   * applied rather than echoed.
   *
   * A machine with no `process` tag is kept under `all` and dropped by any
   * narrower scope: "we do not know which process this is" cannot satisfy
   * "Injection only" without inventing the answer.
   */
  const wantProcess = filters.process;
  const processInScope = (m: { process: string | null }) =>
    wantProcess === 'all' || m.process === wantProcess;
  if (snapshot.unknownStatuses.length > 0) {
    warnings.push(
      `unrecognised machine status from InfluxDB, excluded from the census: ${snapshot.unknownStatuses.slice(0, 5).join('; ')}`,
    );
  }

  if (!snapshot.oaOk && snapshot.oaError) {
    warnings.push(
      snapshot.oaLastSuccessAt
        ? `%OA is stale: the production query last succeeded at ${snapshot.oaLastSuccessAt} and is now failing (${snapshot.oaError})`
        : `%OA unavailable: the production query has never succeeded (${snapshot.oaError})`,
    );
  }

  // Said separately from the %OA warning above even though the two queries run
  // on one clock: they fail independently, and "the chart is an hour old" is a
  // different statement to the reader than "the KPI strip is".
  if (!snapshot.trendOk && snapshot.trendError) {
    warnings.push(
      snapshot.trendLastSuccessAt
        ? `trend is stale: the hourly query last succeeded at ${snapshot.trendLastSuccessAt} and is now failing (${snapshot.trendError})`
        : `trend unavailable: the hourly query has never succeeded (${snapshot.trendError})`,
    );
  }

  const oaByPlant = indexOaByPlant(snapshot.oa);

  // A plant producing shots that master data has never heard of is output nobody
  // on this board can see. Silence here would read as "no such plant".
  const orphans = [...oaByPlant.keys()].filter((p) => !companyOfPlant.has(p)).sort();
  if (orphans.length > 0) {
    warnings.push(
      `InfluxDB reports production for plant(s) absent from master data, excluded from every KPI: ${orphans.join(', ')}`,
    );
  }

  const inPlantScope = plantMatcher(filters.plant);
  const plantsNarrowed = plantFilterActive(filters.plant);

  const built = COMPANIES.map((c) =>
    buildCompany(
      c,
      snapshot,
      oaByPlant,
      now,
      warnings,
      inPlantScope,
      processInScope,
      // `all` is this board's scope, never a link's: the drill-down has to name
      // one process, and Injection is the one it opens on.
      wantProcess === 'all' ? DEFAULT_LINK_PROCESS : wantProcess,
    ),
  );
  // Filtered as pairs, so the machines behind the totals can never drift out of
  // step with the companies on screen.
  const inScope = regionMatcher(filters.region);
  const shown = built.filter(
    (b) =>
      inScope(b.company) &&
      // A company with no plant left in scope is not a row with zeroes in it -
      // it is a company the reader did not ask about. Only when the Lamp filter
      // is narrowing: with `all`, every company keeps its plants and this is a
      // no-op.
      (!plantsNarrowed || b.company.plants.length > 0),
  );
  const companies = shown.map((b) => b.company);

  // Coverage: the denominator is the reporting set only, never the full nine.
  // A site with no gateway must not drag the group average toward zero.
  const reporting = shown.filter((b) => isReporting(b.company.status));
  const reportingCompanies = reporting.map((b) => b.company);
  // Every machine under a reporting site, flattened - the group figure is a mean
  // of machines, not of companies, so a two-machine company cannot swing it as
  // hard as a twenty-machine one.
  const reportingMachines = reporting.flatMap((b) => b.oaMachines);

  /*
   * Q-05. Filtered through exactly the gates the KPI strip is filtered through -
   * the region filter, the company liveness roll-up, the per-plant liveness
   * check and `machineExclusions` - so the chart is a history of the same set of
   * machines the cards above it are measuring, not of everything in the table.
   */
  const trendPlants = new Map(
    reporting.flatMap((b) => b.oaPlants.map((p) => [p.code, p.machineExclusions] as const)),
  );
  const trendBuild = buildTrend({
    hours: snapshot.trend.filter((h) => {
      const exclusions = trendPlants.get(h.plant);
      return exclusions !== undefined && !exclusions.includes(h.machine);
    }),
    now,
    points: TREND_POINTS,
    siteOf: (plant) => companyOfPlant.get(plant) ?? null,
  });
  for (const w of trendWarnings(trendBuild)) warnings.push(w);

  return {
    ...POLICY_BLOCK,
    meta: buildEnvelope({
      sources: sourceHealthFrom(snapshot, env, now.getTime()),
      warnings,
      cacheAgeSec: cacheAgeSec(snapshot, now.getTime()),
    }),
    filters_applied: filters,
    totals: {
      counts: addCounts(reportingCompanies.map((c) => c.counts)),
      ...buildKpi(reportingMachines),
      // Counted off the tier the backend already resolved, so the headline and
      // the ranking table cannot disagree about who is in trouble. A site whose
      // %OA is unknown is not "needing attention" - it is unmeasured, and the
      // no-data chip says so.
      companies_needing_attention: reportingCompanies.filter(
        (c) => c.kpi.oa_tier === 'critical',
      ).length,
      plants_needing_attention: reportingCompanies
        .flatMap((c) => c.plants)
        .filter((p) => p.kpi.oa_tier === 'critical').length,
      companies_reporting: reportingCompanies.length,
      companies_total: companies.length,
      countries_total: new Set(companies.map((c) => c.country_code)).size,
    },
    companies,
    trend: trendBuild.points,
    // Q-06 is an open decision (BACKEND-HANDOVER §7): production_alarm_logs
    // has severity and class but nothing to satisfy `zAlert.owner`.
    alerts: [],
  };
}
