import type { ResolvedShift } from '@dashboard/domain-shared';
import type { MachineOaRow } from '../influx/queries.ts';
import { influxTimeToIsoUtc } from '../influx/time.ts';
import { orderShiftVerdict } from './orderShift.ts';

/**
 * Q-03 - %OA per machine, and the average the KPI strip's "Avg %OA" card shows.
 *
 * ## What the number is
 *
 * %OA is standard time over actual time: `MIN(std_time) * SUM(qty)` divided by
 * the clamped cycle sum, per DESIGN.md §9.1. It is a cycle-efficiency ratio, not
 * OEE availability - a cycle longer than `std_time + 100` is counted as if it
 * had taken standard, so a four-hour dead line costs the figure nothing (D-19).
 *
 * ## Why the average is a plain mean of machines
 *
 * Reconciled against the production `Machine Status V2.0` board for plant 6332
 * on 2026-08-25. Its header read `AVG %OA 69.8%` over 29 machines, and the
 * only aggregation that reproduces that is the **plain mean of the machines
 * that had an order loaded** - four of them, at 48.9 / 47.5 / 89.9 / 93.0.
 * Measured alternatives on the same snapshot: counting the order-less machines
 * as 0% gives 12.1%, restricting to `Mass Pro` gives 25.8%, and weighting by
 * output qty - what this project's contract asked for under D-20 - gives 56.8%.
 *
 * D-20 is therefore closed in favour of `simple_avg`: a group figure 13 points
 * below the board hanging on the shop floor is not a defensible thing to put in
 * front of an executive, whatever its statistical merit. `oa_aggregation` still
 * travels in the payload so the methodology panel states which rule produced
 * the number rather than leaving the reader to assume.
 *
 * A machine with no order loaded is left out of the mean entirely rather than
 * entering it as a zero. The old board prints `0.0%` on those cards, which is
 * the fabricated-zero the contract's rule R2 exists to forbid: "no order" is
 * not "zero efficiency". Both treatments produce the same average - the machine
 * is out of the denominator either way - so this costs nothing and keeps the
 * per-machine number honest.
 */

/** One decimal, the precision every %OA on the board is quoted to. Shared with the trend. */
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** What the PO slots hold when no order is loaded: `-` on every row seen so far. */
const EMPTY_PO = new Set(['', '-']);

/** Why a machine that reported has no computable %OA. Each one becomes a warning. */
export type OaGap =
  | 'no_std_time'
  /** The order produced nothing in the window, so there is no time to divide by. */
  | 'no_output';

/** One machine's %OA against the order it is running now. */
export interface MachineOa {
  plant: string;
  machine: string;
  /** Narrowed per request alongside the census, so both measure one process. */
  process: string | null;
  /** The order group of its most recent shot, `null` when no order is loaded. */
  groupPo: string | null;
  oaPct: number | null;
  /** Pieces on the current order inside the window. `SUM(qty)`, DESIGN.md §8.5. */
  actualQty: number | null;
  /**
   * Q-04's TotalPlan for the current order: the lot sizes of its active slots.
   * `null` when no order is loaded or the order carries no plan - never 0.
   */
  planQty: number | null;
  /** Shots on the current order. `COUNT(cavity)`, not to be confused with pieces. */
  shotCount: number | null;
  /**
   * How many order slots the current shot carries, 0 when no order is loaded.
   *
   * Load-bearing rather than descriptive: above 1, `std_time` arrives summed
   * across the slots while `cycle_time` stays one cycle, so `oaPct` scales with
   * this number. Reported either way - §9.1 makes no exception, and the plant
   * board was confirmed to do the same (D-27) - and this is what lets the
   * envelope name the machines it applies to.
   */
  poSlots: number;
  /**
   * `vCreateDateTxt` of the ACTIVE slots only, raw and in slot order.
   *
   * Input to the Order-End shift check (`domain/orderShift.ts`). Carried
   * unparsed because `foldMachineOa` has no clock and no shift config - which
   * shift a timestamp falls in is a question about the SITE, and the site is
   * only known one level up.
   */
  createdRaw: readonly (string | null)[];
  /** Set when the machine had an order but %OA could not be computed from it. */
  gap: OaGap | null;
  /**
   * When each order this machine has ALREADY finished stopped producing, ISO
   * UTC, newest first - the production board's `Order End` cards for it.
   *
   * Layer 1 of DESIGN.md §8.4: every PO group of this machine except the newest
   * one is an order it has moved on from, and the board draws each as a second
   * card beside the live one. `foldMachineOa` used to drop those groups on the
   * floor, which is why `Order End` could only ever be 0 anywhere on this board
   * - the status table never carries the value (measured over 24 h at THS 6332
   * on 2026-09-10: `Stop`, `Mass Pro` and `Dandori`, nothing else).
   *
   * Instants and not a count, for the same reason `createdRaw` is unparsed:
   * which of them count is a question about the SITE's calendar day, and this
   * function has neither a clock nor a timezone. `countFinishedOrders` answers
   * it one level up, where the timezone is known.
   *
   * Groups holding no real order are left out - a machine idling with `-` in
   * every slot has not finished anything. The board tests slot 0 alone where
   * this tests all four; measured across every plant over 24 h on 2026-09-10,
   * no group has an empty slot 0 and a loaded one after it, so the two rules
   * pick the same groups on live data.
   */
  finishedOrders: readonly string[];
}

/**
 * The four `ProductionOrderN` columns reduced to the slots that hold a real
 * order, carrying the index each one came from.
 *
 * Exported because the trend (Q-05) reads the same four columns off its own
 * hourly rows, and "which slots count as loaded" is a rule about the data, not
 * about either query. One definition, or the chart and the card can disagree
 * about whether a machine had an order at all.
 */
export function orderSlots(
  po: readonly (string | null)[],
): { i: number; po: string }[] {
  return po
    .map((v, i) => ({ po: (v ?? '').trim(), i }))
    .filter(({ po }) => !EMPTY_PO.has(po));
}

/** Which of the four slots hold a real order, by index. */
function activeSlots(row: MachineOaRow): number[] {
  return orderSlots([row.po0, row.po1, row.po2, row.po3]).map(({ i }) => i);
}

function slotsOf(row: MachineOaRow): string[] {
  return orderSlots([row.po0, row.po1, row.po2, row.po3]).map(({ po }) => po);
}

/** `null` for anything that is not a usable number, so NaN never reaches a sum. */
export function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const finite = finiteNumber;

/**
 * DESIGN.md §9.1 applied to one (order x machine) group, with the guards the
 * live data turned out to need. Returns the reason instead of a number when the
 * inputs cannot support one - never a zero standing in for "unknown".
 */
export function oaFromPoGroup(input: {
  minStdTime: number | null;
  sumQty: number | null;
  weightedTime: number | null;
}): { oaPct: number | null; gap: OaGap | null } {
  const minStd = finite(input.minStdTime);
  const qty = finite(input.sumQty);
  const weighted = finite(input.weightedTime);

  if (minStd === null || minStd <= 0) return { oaPct: null, gap: 'no_std_time' };
  if (qty === null || qty <= 0) return { oaPct: null, gap: 'no_output' };
  if (weighted === null || weighted <= 0) return { oaPct: null, gap: 'no_output' };

  const pct = (minStd * qty) / weighted * 100;
  return Number.isFinite(pct) ? { oaPct: round1(pct), gap: null } : { oaPct: null, gap: 'no_output' };
}

/**
 * Q-04's `TotalPlan` for one order group: DESIGN.md §9.2's
 * `plan_qty0 + plan_qty1 + plan_qty2 + plan_qty3`, restricted to the slots that
 * actually hold an order.
 *
 * The restriction is belt-and-braces rather than a correction: measured over
 * 46,962 live rows on 2026-08-25, `plan_qtyN > 0` exactly when
 * `ProductionOrderN` is set - not one row carried a plan for an empty slot or
 * an order with no plan. Reading the empty slots anyway would mean a stray
 * value in `plan_qty3` could inflate a single-order machine's denominator with
 * no order to attribute it to.
 *
 * `null`, not 0, when the slots carry no plan. THS 6338's gateway sends
 * `plan_qty = 0` on every row; "the plan is zero" and "we do not know the
 * plan" are different statements and only one of them is true there (R2).
 */
export function planFromSlots(
  /* Structural, not `MachineOaRow`: the hourly rows carry the same four plan
     columns and must apply the same rule to them. This function's own header
     makes the point about `orderSlots` - one definition, or the chart and the
     card disagree about what a machine was planning to make. */
  row: Pick<MachineOaRow, 'plan0' | 'plan1' | 'plan2' | 'plan3'>,
  slotIndices: number[],
): number | null {
  const plans = [row.plan0, row.plan1, row.plan2, row.plan3];
  const active = slotIndices
    .map((i) => finite(plans[i] ?? null))
    .filter((v): v is number => v !== null);
  if (active.length === 0) return null;
  const total = active.reduce((a, b) => a + b, 0);
  return total > 0 ? total : null;
}

/**
 * Q-04 - `%Achievement`, DESIGN.md §9.2, at every level of the hierarchy.
 *
 * A ratio of the two sums, never a mean of the per-machine percentages: a
 * machine on a 60-piece order would otherwise carry the same weight as one on
 * an 800-piece order, and the card shows the plan and the output beside the
 * percentage, so a reader who divides them must get the number on the card.
 *
 * `plan = 0 -> null` **overrides** DESIGN.md §9.2's literal "if TotalPlan = 0
 * then 0": the contract's rule R2 (absence is never a fabricated zero) wins,
 * and the frontend already has a "no plan" state waiting for it
 * (`measure.noPlan` in the KPI strip).
 *
 * `actual = 0` against a real plan is NOT the same case - that is a measured
 * zero, an order loaded that has produced nothing in the window, and it is
 * reported as 0%.
 */
export function achievementFrom(plan: number | null, actual: number | null): number | null {
  const p = finite(plan);
  const a = finite(actual);
  if (p === null || p <= 0 || a === null) return null;
  const pct = (a / p) * 100;
  return Number.isFinite(pct) ? round1(pct) : null;
}

/**
 * Collapses the query's per-order rows to one row per machine, keeping only the
 * order it is running now.
 *
 * The newest row in the window belongs to exactly one slot combination, so the
 * group holding `MAX(time)` IS the loaded order - the same rule the production
 * board's cards follow. A machine whose order finished an hour ago has its slots
 * back at `-` and drops out of the average, exactly as it does on the board.
 * That is worth stating plainly: this card is an instantaneous read of the
 * machines currently on an order, not a shift-long average.
 *
 * The groups it does NOT keep are no longer discarded silently. Each one is an
 * order the machine has finished - the board draws them as `Order End` cards -
 * so their instants travel on `finishedOrders` for `countFinishedOrders` to
 * judge against the site's day. Dropping them is what made that figure
 * unreachable from this payload.
 */
export function foldMachineOa(rows: MachineOaRow[]): MachineOa[] {
  const byMachine = new Map<string, { row: MachineOaRow; at: string }[]>();

  for (const row of rows) {
    // Without both tags the row cannot be attributed to a machine, and putting
    // it somewhere convenient would be inventing provenance.
    if (!row.plant || !row.machine) continue;
    const at = influxTimeToIsoUtc(row.last_row);
    if (!at) continue;

    const key = `${row.plant}|${row.machine}`;
    const held = byMachine.get(key) ?? [];
    held.push({ row, at });
    byMachine.set(key, held);
  }

  /* Newest group first, so the head is the loaded order and the tail is
     everything the machine has already been through. One sort per machine over
     a handful of groups - 75 groups across 25 machines at THS 6332. */
  const folded = [...byMachine.values()].map((groups) => {
    const sorted = [...groups].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return {
      current: sorted[0]!,
      finishedOrders: sorted
        .slice(1)
        .filter(({ row }) => orderSlots([row.po0, row.po1, row.po2, row.po3]).length > 0)
        .map(({ at }) => at),
    };
  });

  return folded.map(({ current: { row }, finishedOrders }) => {
    const active = activeSlots(row);
    const slots = slotsOf(row);
    const base = {
      plant: row.plant as string,
      machine: row.machine as string,
      process: row.process,
    };

    // No order loaded. Not a zero - there is nothing being measured against.
    // This is also the panel's own early-return: with no `ProductionOrder0` it
    // never runs the shift check, which is why the 51% of `vCreateDateTxt` rows
    // reading `"-"` never mattered (domain/orderShift.ts).
    if (slots.length === 0) {
      return {
        ...base,
        groupPo: null,
        oaPct: null,
        actualQty: null,
        planQty: null,
        shotCount: null,
        poSlots: 0,
        createdRaw: [],
        gap: null,
        /* A machine with nothing loaded now is the ordinary case for one that
           finished an order an hour ago - its slots go back to `-`. So this is
           carried on the empty branch too, and it is the branch most of the
           board's `Order End` cards come from. */
        finishedOrders,
      };
    }

    const planQty = planFromSlots(row, active);
    const groupPo = slots.join('_');

    /*
     * A machine running several orders in one shot is computed like any other,
     * because DESIGN.md §9.1 makes no exception for it - `Group_PO` is
     * `PO0_PO1_PO2_PO3` by definition, so the multi-order case is the case the
     * formula was written for.
     *
     * It is worth knowing what that costs. `std_time` arrives already summed
     * across the active slots while `cycle_time` is one physical cycle, so the
     * figure scales with the slot count: THS 6332 machine I4 reads 57% on order
     * 110000958498 alone and 114% on the same order paired with 110000958497,
     * same cycle, same cavity. ASI 6051 M-ID-02 reads 419% on three.
     *
     * **D-27 closed 2026-08-26: the production board does exactly the same.**
     * Its I5 card, marked `110000961179 (+1)` for the second order, printed
     * `%OA 105.9%` while this code computed 105.9% from the same rows - and
     * three single-order machines on the same screen matched too (I1 98.5,
     * I3 99.7, I6 101.4). The old dashboard neither halves these nor excludes
     * them, so reporting the figure is agreement with it, not a divergence.
     *
     * What that does NOT settle is whether a reader should take 105.9% as
     * "beating standard" - that is D-19, still open. Machines above 100% are
     * named on the envelope for the same reason.
     */
    const { oaPct, gap } = oaFromPoGroup({
      minStdTime: row.min_std_time,
      sumQty: row.sum_qty,
      weightedTime: row.weighted_time,
    });
    const created = [row.cd0, row.cd1, row.cd2, row.cd3];
    return {
      ...base,
      groupPo,
      oaPct,
      gap,
      actualQty: finite(row.sum_qty),
      planQty,
      shotCount: finite(row.shot_count),
      poSlots: slots.length,
      createdRaw: active.map((i) => created[i] ?? null),
      finishedOrders,
    };
  });
}

/**
 * The board's `Order End` count for a set of machines: orders finished since
 * `since`, DESIGN.md §8.4 layer 1.
 *
 * `since` is midnight of the site's calendar day (`startOfLocalDay`), because
 * that is the window the board's own picker is pinned to - `from=now/d` in the
 * stored 6332 drill-down URL. Counted here rather than in `foldMachineOa` for
 * the reason `finishedOrders` records: the fold has no timezone.
 *
 * Orders and not machines. A machine that ran three orders since midnight
 * contributes three, which is exactly what the board draws - three cards.
 * Reconciled against the live instance on 2026-09-10 at 09:45 Bangkok: 19
 * orders across 14 machines at 6332, against 37 over a flat 24 h and 0 over the
 * production day, whose 08:00 anchor is a different clock (see
 * `startOfLocalDay`).
 */
export function countFinishedOrders(machines: MachineOa[], since: Date): number {
  const from = since.toISOString();
  /* String comparison, not Date.parse per instant: both sides are ISO UTC with
     the same shape, so lexical order IS chronological order, and this runs over
     every machine on every poll. */
  return machines.reduce(
    (n, m) => n + m.finishedOrders.filter((at) => at >= from).length,
    0,
  );
}

/**
 * `Order End` layer 2 applied to a site's machines - DESIGN.md §8.4.
 *
 * **This classifies. It no longer removes anything from %OA.** Rule change from
 * the design owner, 2026-09-08: a machine carrying an order created in an
 * earlier shift stays in the average until the order genuinely ends. This code
 * may not rule an order finished on its own and take the machine's figures out
 * on the strength of that inference.
 *
 * The genuine end signal is already in the data and needs no inference. When an
 * order finishes, its `ProductionOrderN` slots go back to `-`, `foldMachineOa`
 * gives that machine `oaPct: null`, and `averageOa` passes over it. Slots
 * clearing is now the ONLY way a machine leaves the %OA denominator.
 *
 * What forced the change: ASI 6051 runs one order across days. Measured there
 * on 2026-09-08, all seven machines with a computable %OA - a real 75.0%
 * average, every one of them still shooting that minute - were judged `ended`
 * against the Day shift because their orders were created the previous morning,
 * and the plant's %OA card went blank. THS creates an order per shift and so
 * never hit this, which is how a rule reconciled there came to be read as
 * universal.
 *
 * The split survives because the verdict is still worth SAYING. It feeds
 * `orderShiftWarnings`, which names the carried-over machines on the envelope:
 * the production board does blank them, so this figure can now differ from the
 * board by exactly those machines, and a reader should not have to work that
 * out by subtraction.
 *
 * Measured at THS on 2026-08-27, when the verdict still moved the number: 13
 * machines `current`, 2 `ended` (`I5` and `IC5`, on orders created 20:06
 * Bangkok the previous night shift), 0 `unknown` - 75.2% with them, 81.0%
 * without. Under this rule THS reports the 75.2%.
 */
export function splitByOrderShift(
  machines: MachineOa[],
  shift: ResolvedShift | null,
): { current: MachineOa[]; ended: MachineOa[]; unknown: MachineOa[] } {
  const current: MachineOa[] = [];
  const ended: MachineOa[] = [];
  const unknown: MachineOa[] = [];

  for (const m of machines) {
    // No order loaded: nothing to date, and it carries no %OA anyway. Left in
    // `current` so the caller's set stays the machine set it was handed.
    if (m.poSlots === 0) {
      current.push(m);
      continue;
    }
    const verdict = orderShiftVerdict(m.createdRaw, shift);
    if (verdict === 'ended') ended.push(m);
    else if (verdict === 'unknown') unknown.push(m);
    else current.push(m);
  }

  return { current, ended, unknown };
}

/**
 * Which machines carry an order layer 2 cannot tie to the current shift.
 *
 * Both groups are IN %OA. These sentences name them; since 2026-09-08 neither
 * reports a removal, because neither causes one.
 */
export function orderShiftWarnings(
  node: string,
  split: { ended: MachineOa[]; unknown: MachineOa[] },
): string[] {
  const out: string[] = [];

  const ended = split.ended.filter((m) => m.oaPct !== null);
  if (ended.length > 0) {
    out.push(
      `${node}: ${ended.length} machine(s) are running an order created in an earlier shift (${ended
        .map((m) => `${m.machine} ${m.oaPct}%`)
        .sort()
        .join(', ')}) - KEPT in %OA: an order ends when its PO slots clear, not because it predates the current shift (design owner, 2026-09-08). The production \`Machine Status V2.0\` board blanks these, so this figure can differ from that board by exactly these machines (DESIGN.md §8.4 layer 2)`,
    );
  }

  const unknown = split.unknown.filter((m) => m.oaPct !== null);
  if (unknown.length > 0) {
    out.push(
      `${node}: ${unknown.length} machine(s) carry an order whose creation time could not be read (${unknown
        .map((m) => m.machine)
        .sort()
        .join(', ')}) - kept in %OA rather than dropped, so this figure can read higher than the production board, which blanks them`,
    );
  }

  return out;
}

/**
 * The card's number: the plain mean of every machine under this node that has a
 * computable %OA.
 *
 * Applied identically at plant, company and global level over the MACHINES
 * below it - never as a mean of the levels beneath. Averaging plant averages
 * would give a 2-machine plant the same say as a 21-machine one at company
 * level while the plant cards themselves stayed per-machine, so the same board
 * would carry two different definitions of the same word.
 *
 * `null`, not 0, when nothing under it is measurable (R2).
 */
export function averageOa(machines: MachineOa[]): number | null {
  const usable = machines.filter((m) => m.oaPct !== null);
  if (usable.length === 0) return null;
  return round1(usable.reduce((a, m) => a + (m.oaPct as number), 0) / usable.length);
}

/** Sums a machine field, `null` only when not one machine reported it (R2). */
export function sumMachineField(
  machines: MachineOa[],
  pick: (m: MachineOa) => number | null,
): number | null {
  const usable = machines.map(pick).filter((v): v is number => v !== null);
  return usable.length === 0 ? null : usable.reduce((a, b) => a + b, 0);
}

/**
 * The caveats this plant's %OA carries, as sentences for `meta.warnings`.
 *
 * Every machine dropped from the average is named here. A machine silently
 * missing from a mean is indistinguishable from one that was measured and
 * happened to agree with it.
 */
export function oaWarnings(plant: string, machines: MachineOa[]): string[] {
  const out: string[] = [];
  const names = (gap: OaGap) =>
    machines.filter((m) => m.gap === gap).map((m) => m.machine).sort();

  const multi = machines.filter((m) => m.poSlots > 1).map((m) => m.machine).sort();
  if (multi.length > 0) {
    out.push(
      `${plant}: ${multi.length} machine(s) are running more than one order in the same shot (${multi.join(', ')}) - ` +
        'their %OA is computed over the summed standard time of the active PO slots against one physical cycle, so it reads higher than a single-order machine on the same cycle. Reconciled against the plant board on 2026-08-26 and identical there (I5: 105.9% both sides), so this is what the board shows too, not a divergence',
    );
  }

  const noStd = names('no_std_time');
  if (noStd.length > 0) {
    out.push(
      `${plant}: %OA not reported for ${noStd.length} machine(s) whose order carries std_time = 0 (${noStd.join(', ')}) - ` +
        'the formula would yield exactly 0%, which reads as "no efficiency" rather than "no standard time"',
    );
  }

  const noOutput = names('no_output');
  if (noOutput.length > 0) {
    out.push(
      `${plant}: %OA not reported for ${noOutput.length} machine(s) whose order has produced nothing in the window (${noOutput.join(', ')})`,
    );
  }

  // Above 100% means the machine beat its own standard cycle. Real when a
  // standard is stale (THS has machines at 102% and 115%), so it is reported -
  // but an executive asking "how is efficiency 115%" deserves an answer that
  // exists somewhere in the payload.
  const over = machines.filter((m) => m.oaPct !== null && (m.oaPct as number) > 100);
  if (over.length > 0) {
    out.push(
      `${plant}: ${over.length} machine(s) report %OA above 100% (${over
        .map((m) => `${m.machine} ${m.oaPct}%`)
        .sort()
        .join(', ')}) - the machine is beating the std_time on its order, so the standard is likely stale in the master data`,
    );
  }

  return out;
}

/**
 * The caveats this plant's `%Achievement` carries.
 *
 * Neither of these fires on the live data as measured on 2026-08-25, and that
 * is the point: both encode an assumption this figure rests on, so if the data
 * changes underneath it the payload says so instead of quietly reporting a
 * wrong ratio.
 */
export function achievementWarnings(plant: string, machines: MachineOa[]): string[] {
  const out: string[] = [];

  // Output in the numerator with nothing in the denominator inflates the ratio,
  // and the card shows both numbers, so a reader dividing them would get a
  // different answer than the one printed. Measured: 0 rows of 46,962 have an
  // order without a plan.
  const orphan = machines
    .filter((m) => m.actualQty !== null && m.actualQty > 0 && m.planQty === null)
    .map((m) => m.machine)
    .sort();
  if (orphan.length > 0) {
    out.push(
      `${plant}: ${orphan.length} machine(s) report output against an order with no plan (${orphan.join(', ')}) - ` +
        'their pieces are in the achievement numerator with nothing in the denominator, so the percentage reads higher than the plan and actual shown beside it',
    );
  }

  return out;
}
