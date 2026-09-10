import { describe, expect, it } from 'vitest';
import {
  achievementFrom,
  achievementWarnings,
  averageOa,
  countFinishedOrders,
  foldMachineOa,
  oaFromPoGroup,
  oaWarnings,
  planFromSlots,
  sumMachineField,
  type MachineOa,
} from '../src/domain/oa.ts';
import type { MachineOaRow } from '../src/influx/queries.ts';

/**
 * Q-03 against the production `Machine Status V2.0` board for plant 6332,
 * read at 2026-08-25 ~11:45Z. Every figure in this file was taken off that
 * screen or out of the live InfluxDB in the same minutes, which is what makes
 * these tests a reconciliation rather than a restatement of the code.
 *
 * The board:  TOTAL 29 · RUNNING 12 · STOP 17 · AVG %OA 69.8%
 * Four cards carried an order; the other 25 printed `%OA 0.0%` with `PROD.ORD.NO.: -`.
 */

/** Convenience: a row as the query returns it, one order in slot 0. */
function row(over: Partial<MachineOaRow> = {}): MachineOaRow {
  return {
    plant: '6332',
    machine: 'I5',
    po0: '110000962985',
    po1: '-',
    po2: '-',
    po3: '-',
    // The board's I5 card: OUTPUT PLAN 400, and nothing in the other slots.
    plan0: 400,
    plan1: 0,
    plan2: 0,
    plan3: 0,
    process: 'Injection',
    min_std_time: 31,
    sum_qty: 295,
    shot_count: 295,
    weighted_time: 19236.09,
    last_row: '2026-08-25T10:05:54.359',
    // The order's creation time, in the shape the live column actually holds
    // (`YYYY-MM-DD HH:MM:SS`, UTC). Only slot 0 is occupied, matching `po0`.
    cd0: '2026-08-25 09:12:00',
    cd1: '-',
    cd2: '-',
    cd3: '-',
    ...over,
  };
}

describe('oaFromPoGroup - DESIGN.md §9.1', () => {
  it("reproduces the board's I5 card exactly", () => {
    // The card read: PROD.ORD.NO. 110000962985 · OUTPUT ACTUAL 295 · %OA 47.5%
    expect(oaFromPoGroup({ minStdTime: 31, sumQty: 295, weightedTime: 19236.09 })).toEqual({
      oaPct: 47.5,
      gap: null,
    });
  });

  it('reports null, never 0%, when the order carries no standard time', () => {
    // The real numbers are THS 6338's, from a gateway that sends no std_time.
    // It no longer reaches this branch - it sends no order either, so it stops
    // at "no order loaded" - but a first pass that grouped on the concatenated
    // order key scored these 313 pieces 0%, dropping the company average from
    // 66.7% to 57.4% on a number nobody had measured. This is the backstop.
    expect(oaFromPoGroup({ minStdTime: 0, sumQty: 313, weightedTime: 21029.46 })).toEqual({
      oaPct: null,
      gap: 'no_std_time',
    });
  });

  it('reports null when the order has produced nothing to divide by', () => {
    expect(oaFromPoGroup({ minStdTime: 31, sumQty: 0, weightedTime: 0 })).toEqual({
      oaPct: null,
      gap: 'no_output',
    });
  });

  it('reports null rather than Infinity or NaN on absent inputs', () => {
    expect(oaFromPoGroup({ minStdTime: null, sumQty: null, weightedTime: null }).oaPct).toBeNull();
    expect(oaFromPoGroup({ minStdTime: 31, sumQty: 295, weightedTime: 0 }).oaPct).toBeNull();
  });

  it('lets a value above 100% through - a machine can beat a stale standard', () => {
    // I8 on the same plant, same window: std 58 over 119 pieces in 5986.49 s.
    // Real, and reported, because clamping it would hide master data that needs
    // fixing behind a number that looks fine.
    expect(oaFromPoGroup({ minStdTime: 58, sumQty: 119, weightedTime: 5986.49 }).oaPct).toBe(115.3);
  });
});

describe('foldMachineOa - one row per machine, the order it is running now', () => {
  it('keeps the newest order and drops the ones that finished', () => {
    // I9 ran 110000938238 at 99.5% earlier in the window, then went back to no
    // order - which is why the board showed I9 with `-` and 0.0%, not 99.5%.
    const folded = foldMachineOa([
      row({
        machine: 'I9',
        po0: '110000938238',
        min_std_time: 48,
        sum_qty: 340,
        weighted_time: 16403.64,
        last_row: '2026-08-25T06:00:00.000',
      }),
      row({
        machine: 'I9',
        po0: '-',
        min_std_time: 0,
        sum_qty: 0,
        weighted_time: 0,
        last_row: '2026-08-25T11:44:00.000',
      }),
    ]);

    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ machine: 'I9', groupPo: null, oaPct: null, gap: null });
  });

  it('computes %OA for a machine running several orders, per §9.1 as written', () => {
    // ASI 6051, machine M-ID-02: three orders in one physical shot. std_time is
    // the SUM of the active slots (168 = 3 x 56) while cycle_time is still one
    // cycle, so the figure comes out about three times reality.
    //
    // Reported anyway - §9.1 makes no exception for the multi-order case, and
    // the design owner chose to follow the document (2026-08-26). `poSlots`
    // carries the caveat to the envelope instead. See D-27.
    const folded = foldMachineOa([
      row({
        plant: '6051',
        machine: 'M-ID-02',
        po0: 'ASSI92803061',
        po1: 'ASSI92803063',
        po2: 'ASSI92803064',
        min_std_time: 168,
        sum_qty: 168,
        shot_count: 28,
        weighted_time: 6737.22,
      }),
    ]);

    expect(folded[0]).toMatchObject({ oaPct: 418.9, gap: null, poSlots: 3 });
    expect(folded[0]!.actualQty).toBe(168);
    expect(oaWarnings('ASI/6051', folded).join(' ')).toContain('M-ID-02');
  });

  it('reads the same machine and order twice as far apart as the slot count', () => {
    /*
     * THS 6332, machine I4, 2026-08-26 - the controlled experiment the data
     * handed us. Order 110000958498 appears BOTH alone and paired with
     * 110000958497, on the same machine at the same ~45.5 s cycle with cavity 1
     * throughout. std_time and qty both double when the second slot opens:
     *
     *   1 slot : std 26, qty 1 -> 26/45.5   =  57%
     *   2 slots: std 52, qty 2 -> 104/91.2  = 114%
     *
     * Nothing physical changed. Both are reported, because §9.1 says to; this
     * test exists so the day someone reconciles against the plant board, the
     * two numbers and the reason they differ are already written down.
     */
    const alone = foldMachineOa([
      row({ machine: 'I4', po0: '110000958498', min_std_time: 26, sum_qty: 1, weighted_time: 45.5 }),
    ]);
    // `createdRaw` tracks the ACTIVE slots, so one order carries one date.
    expect(alone[0]).toMatchObject({
      oaPct: 57.1,
      poSlots: 1,
      createdRaw: ['2026-08-25 09:12:00'],
      gap: null,
      finishedOrders: [],
    });

    const paired = foldMachineOa([
      row({
        machine: 'I4',
        po0: '110000958498',
        po1: '110000958497',
        min_std_time: 52,
        sum_qty: 2,
        weighted_time: 91.2,
        cd1: '2026-08-25 09:40:00',
      }),
    ]);
    expect(paired[0]).toMatchObject({
      oaPct: 114,
      poSlots: 2,
      // Two open slots, two dates, in slot order - what layer 2 then reads.
      createdRaw: ['2026-08-25 09:12:00', '2026-08-25 09:40:00'],
      gap: null,
      finishedOrders: [],
    });
    // Reported, and named on the envelope so nobody reads 114% as a measurement.
    expect(oaWarnings('THS/6332', paired).join(' ')).toContain('I4');
  });

  it('still computes %OA when the same machine runs a single order', () => {
    const folded = foldMachineOa([
      row({ plant: '6051', machine: 'M-ID-01', po0: 'ASSI92803022', min_std_time: 56, sum_qty: 32, weighted_time: 1628.7 }),
    ]);
    expect(folded[0]).toMatchObject({ oaPct: 110, gap: null });
  });

  it('drops rows that cannot be attributed to a machine', () => {
    expect(foldMachineOa([row({ machine: null }), row({ plant: null })])).toEqual([]);
    // No timestamp means there is no way to tell which order is current.
    expect(foldMachineOa([row({ last_row: null })])).toEqual([]);
  });

  it('treats a blank PO slot the same as `-`', () => {
    expect(foldMachineOa([row({ po0: '  ' })])[0]!.groupPo).toBeNull();
  });
});

/**
 * `Order End` layer 1 - the figure that read 0 on every board until 2026-09-10.
 *
 * The cause was here: the fold kept the newest PO group per machine and dropped
 * the rest, and those dropped groups ARE the board's `Order End` cards. The
 * status table cannot supply them - measured over 24 h at THS 6332 the same
 * day, `production_machine_status` carried `Stop`, `Mass Pro` and `Dandori` and
 * nothing else - so `by_status['Order End']` is 0 on live data and the card had
 * no other source.
 */
describe('foldMachineOa - the orders a machine has already finished', () => {
  /* I5's real day: a 220-piece order finished at 04:11, a 400-piece one loaded
     at 10:05. The card shows the second; the first is an `Order End` card. */
  const twoOrders = [
    row({ po0: '110000953255', plan0: 220, sum_qty: 173, last_row: '2026-08-25T04:11:02.000' }),
    row({ po0: '110000962985', plan0: 400, sum_qty: 295, last_row: '2026-08-25T10:05:54.359' }),
  ];

  it('keeps the finished order the current card replaced', () => {
    const folded = foldMachineOa(twoOrders);
    expect(folded).toHaveLength(1);
    expect(folded[0]!.finishedOrders).toEqual(['2026-08-25T04:11:02.000Z']);
  });

  it('is unaffected by the order the rows arrive in', () => {
    expect(foldMachineOa([...twoOrders].reverse())[0]).toMatchObject({
      groupPo: '110000962985',
      finishedOrders: ['2026-08-25T04:11:02.000Z'],
    });
  });

  it('counts a finished order for a machine that has nothing loaded now', () => {
    // The ordinary case: the slots go back to `-` the moment an order ends, so
    // most `Order End` cards belong to machines whose current card is idle.
    const folded = foldMachineOa([
      row({ po0: '110000953255', last_row: '2026-08-25T04:11:02.000' }),
      row({ po0: '-', plan0: 0, last_row: '2026-08-25T10:05:54.359' }),
    ]);
    expect(folded[0]).toMatchObject({
      groupPo: null,
      finishedOrders: ['2026-08-25T04:11:02.000Z'],
    });
  });

  it('does not count an idle stretch as a finished order', () => {
    // A group with `-` in every slot is a machine sitting still, not an order.
    const folded = foldMachineOa([
      row({ po0: '-', plan0: 0, last_row: '2026-08-25T03:00:00.000' }),
      row({ po0: '110000962985', last_row: '2026-08-25T10:05:54.359' }),
    ]);
    expect(folded[0]!.finishedOrders).toEqual([]);
  });

  it('counts orders and not machines, newest first', () => {
    const folded = foldMachineOa([
      row({ machine: 'I6', po0: 'A', last_row: '2026-08-25T02:00:00.000' }),
      row({ machine: 'I6', po0: 'B', last_row: '2026-08-25T05:00:00.000' }),
      row({ machine: 'I6', po0: 'C', last_row: '2026-08-25T09:00:00.000' }),
    ]);
    expect(folded[0]!.finishedOrders).toEqual([
      '2026-08-25T05:00:00.000Z',
      '2026-08-25T02:00:00.000Z',
    ]);
    // Three orders, one machine - which is the whole reason this is not part of
    // the census. TOTAL would count I6 once.
    expect(countFinishedOrders(folded, new Date('2026-08-25T00:00:00Z'))).toBe(2);
  });
});

describe('countFinishedOrders - the board`s window, not ours', () => {
  const folded = () =>
    foldMachineOa([
      row({ po0: 'A', last_row: '2026-08-24T20:00:00.000' }),
      row({ po0: 'B', last_row: '2026-08-25T04:11:02.000' }),
      row({ po0: 'C', last_row: '2026-08-25T10:05:54.359' }),
    ]);

  it('counts only what ended on or after the cut', () => {
    // Bangkok midnight on the 25th is 17:00Z on the 24th, so all three of the
    // machine's groups are in the day and two of them are finished orders.
    expect(countFinishedOrders(folded(), new Date('2026-08-24T17:00:00Z'))).toBe(2);
    // Midnight UTC drops the one that ended at 20:00 the previous evening.
    expect(countFinishedOrders(folded(), new Date('2026-08-25T00:00:00Z'))).toBe(1);
    // A cut after everything: the day has produced no finished order yet.
    expect(countFinishedOrders(folded(), new Date('2026-08-25T12:00:00Z'))).toBe(0);
  });

  it('is 0 for machines that have finished nothing', () => {
    expect(countFinishedOrders(foldMachineOa([row()]), new Date('2026-08-25T00:00:00Z'))).toBe(0);
    expect(countFinishedOrders([], new Date('2026-08-25T00:00:00Z'))).toBe(0);
  });
});

describe('averageOa - the "Avg %OA" card', () => {
  const board = [
    { plant: '6332', machine: 'IC4', process: 'Injection', groupPo: 'a', oaPct: 48.9, actualQty: 137, planQty: null, shotCount: 137, poSlots: 1, createdRaw: [], gap: null, finishedOrders: [] },
    { plant: '6332', machine: 'I5', process: 'Injection', groupPo: 'b', oaPct: 47.5, actualQty: 295, planQty: null, shotCount: 295, poSlots: 1, createdRaw: [], gap: null, finishedOrders: [] },
    { plant: '6332', machine: 'IA1', process: 'Injection', groupPo: 'c', oaPct: 89.9, actualQty: 71, planQty: null, shotCount: 71, poSlots: 1, createdRaw: [], gap: null, finishedOrders: [] },
    { plant: '6332', machine: 'P1I1', process: 'Injection', groupPo: 'd', oaPct: 93, actualQty: 41, planQty: null, shotCount: 41, poSlots: 1, createdRaw: [], gap: null, finishedOrders: [] },
  ] as const;

  it("matches the board's AVG %OA of 69.8%", () => {
    expect(averageOa([...board])).toBe(69.8);
  });

  it('is unchanged by the 25 machines that had no order', () => {
    // The board prints 0.0% on those cards but does not count them: including
    // them as zeros gives 12.1%, which is not the number on the screen.
    const idle = Array.from({ length: 25 }, (_, i) => ({
      plant: '6332',
      machine: `x${i}`, process: 'Injection',
      groupPo: null,
      oaPct: null,
      actualQty: null,
      planQty: null,
      shotCount: null,
      poSlots: 0,
      createdRaw: [],
      gap: null,
      finishedOrders: [],
    }));
    expect(averageOa([...board, ...idle])).toBe(69.8);
  });

  it('is a plain mean, not weighted by output', () => {
    // Weighting the same four machines by qty gives 56.8% - 13 points below the
    // board. D-20 chose the board.
    expect(averageOa([...board])).not.toBe(56.8);
  });

  it('is null, not 0, when nothing under it is measurable', () => {
    expect(averageOa([])).toBeNull();
    expect(averageOa([{ ...board[0], oaPct: null }])).toBeNull();
  });

  it('sums output over the machines that reported any', () => {
    expect(sumMachineField([...board], (m) => m.actualQty)).toBe(544);
    expect(sumMachineField([], (m) => m.actualQty)).toBeNull();
  });
});

describe('oaWarnings - every caveat is named on the envelope', () => {
  it('names the machines running several orders at once', () => {
    const warnings = oaWarnings('ASI/6051', [
      { plant: '6051', machine: 'M-ID-02', process: 'Injection', groupPo: 'a_b_c', oaPct: 418.9, actualQty: 168, planQty: null, shotCount: 28, poSlots: 3, createdRaw: [], gap: null, finishedOrders: [] },
      { plant: '6051', machine: 'M-ID-01', process: 'Injection', groupPo: 'd', oaPct: 110, actualQty: 32, planQty: null, shotCount: 16, poSlots: 1, createdRaw: [], gap: null, finishedOrders: [] },
    ]);

    expect(warnings.some((w) => w.includes('M-ID-02') && w.includes('more than one order'))).toBe(
      true,
    );
    // The single-order machine is above 100% too, and says so for its own reason.
    expect(warnings.some((w) => w.includes('M-ID-01 110%') && w.includes('stale'))).toBe(true);
  });

  it('says nothing when every machine measured cleanly', () => {
    expect(
      oaWarnings('THS/6332', [
        { plant: '6332', machine: 'I5', process: 'Injection', groupPo: 'a', oaPct: 47.5, actualQty: 295, planQty: null, shotCount: 295, poSlots: 1, createdRaw: [], gap: null, finishedOrders: [] },
      ]),
    ).toEqual([]);
  });
});

/**
 * Q-04 against the same live window. Every plan here was read out of
 * `production_machine_io` on 2026-08-25, not invented: 6332's four loaded
 * orders carried 220 / 400 / 309 / 816, and every ASI order carried 700.
 */
describe('planFromSlots - DESIGN.md §9.2 TotalPlan', () => {
  it("reads the board's I5 plan off the one active slot", () => {
    expect(planFromSlots(row(), [0])).toBe(400);
  });

  it('adds the slots of a machine running three orders at once', () => {
    // ASI 6051 M-ID-02: three orders, 700 apiece. Unlike %OA, this denominator
    // is genuinely three orders' worth of work.
    const r = row({ plan0: 700, plan1: 700, plan2: 700, plan3: 0 });
    expect(planFromSlots(r, [0, 1, 2])).toBe(2100);
  });

  it('ignores a plan sitting in a slot with no order', () => {
    // Not observed live (0 of 46,962 rows), which is exactly why it is pinned:
    // a stray plan_qty3 must not silently enlarge a single-order denominator.
    expect(planFromSlots(row({ plan3: 700 }), [0])).toBe(400);
  });

  it('reports no plan rather than a plan of zero', () => {
    // THS 6338's gateway sends plan_qty 0 on every row (R2).
    expect(planFromSlots(row({ plan0: 0 }), [0])).toBeNull();
    expect(planFromSlots(row(), [])).toBeNull();
    expect(planFromSlots(row({ plan0: null }), [0])).toBeNull();
  });
});

describe('achievementFrom - DESIGN.md §9.2 %AR', () => {
  it("reproduces the board's I5 card", () => {
    // 295 pieces against a 400-piece order.
    expect(achievementFrom(400, 295)).toBe(73.8);
  });

  it('is the ratio of the sums at plant level, not the mean of the ratios', () => {
    // The four 6332 cards: Σplan 1745, Σactual 544. The mean of their own
    // ratios is 41.0%, which would disagree with the plan and actual printed on
    // the same card.
    expect(achievementFrom(1745, 544)).toBe(31.2);
  });

  it('returns null, never 0%, when there is no plan to divide by', () => {
    // Overrides §9.2's literal "if TotalPlan = 0 then 0" in favour of R2.
    expect(achievementFrom(0, 313)).toBeNull();
    expect(achievementFrom(null, 313)).toBeNull();
    expect(achievementFrom(-1, 313)).toBeNull();
  });

  it('does report a measured zero: an order loaded that has made nothing', () => {
    // Different case entirely - the plan is known and the output is genuinely 0.
    expect(achievementFrom(400, 0)).toBe(0);
    // Unknown output is still unknown, though.
    expect(achievementFrom(400, null)).toBeNull();
  });

  it('reports past 100% instead of capping it', () => {
    // §9.2: the progress bar stops at 100%, the number does not.
    expect(achievementFrom(400, 460)).toBe(115);
  });
});

describe('foldMachineOa - the plan travels with the loaded order', () => {
  it('sums the plan across every active slot of a multi-order machine', () => {
    // ASI 6051 M-ID-02, orders ASSI92803053/54/55: 252 shots, 6 pcs per shot -
    // 2 per slot - for 1,512 pieces against 700 x 3 = 2,100, so 72% is a figure
    // about three real orders. Both halves of the achievement ratio scale with
    // the slot count, which is why it survives the case cleanly where %OA's
    // denominator does not (D-27).
    const folded = foldMachineOa([
      row({
        plant: '6051',
        machine: 'M-ID-02',
        po0: 'ASSI92803053',
        po1: 'ASSI92803054',
        po2: 'ASSI92803055',
        plan0: 700,
        plan1: 700,
        plan2: 700,
        min_std_time: 168,
        sum_qty: 1512,
        shot_count: 252,
        weighted_time: 60635,
      }),
    ]);

    expect(folded[0]!.planQty).toBe(2100);
    expect(folded[0]!.poSlots).toBe(3);
    // %OA is computed too, and scales with the slot count - see the D-27 tests.
    expect(folded[0]!.oaPct).toBeGreaterThan(100);
    expect(achievementFrom(folded[0]!.planQty, folded[0]!.actualQty)).toBe(72);
  });

  it('carries no plan for a machine with no order loaded', () => {
    const folded = foldMachineOa([row({ po0: '-', plan0: 0 })]);
    expect(folded[0]).toMatchObject({ groupPo: null, planQty: null, actualQty: null });
  });

  it('takes the plan of the current order, not of every order in the window', () => {
    // I5 finished a 220-piece order and loaded a 400-piece one. The card is an
    // instantaneous read, so 620 would be a plan nobody is working to.
    const folded = foldMachineOa([
      row({ po0: '110000953255', plan0: 220, sum_qty: 173, last_row: '2026-08-25T04:11:02.000' }),
      row({ po0: '110000962985', plan0: 400, sum_qty: 295, last_row: '2026-08-25T10:05:54.359' }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ planQty: 400, actualQty: 295 });
  });
});

describe('achievementWarnings', () => {
  const machine = (over: Partial<MachineOa>): MachineOa => ({
    plant: '6332',
    machine: 'I5',
    process: 'Injection',
    groupPo: 'PO',
    oaPct: 47.5,
    actualQty: 295,
    planQty: 400,
    shotCount: 295,
    poSlots: 1,
    createdRaw: ['2026-08-25 09:12:00'],
    gap: null,
    finishedOrders: [],
    ...over,
  });

  it('stays silent on the data as it actually is', () => {
    expect(achievementWarnings('THS/6332', [machine({})])).toEqual([]);
  });

  it('names a machine whose output has no plan behind it', () => {
    // Would inflate the numerator without touching the denominator, so a reader
    // dividing the plan and actual on the card would not get the percentage.
    const out = achievementWarnings('THS/6338', [machine({ machine: 'I24', planQty: null })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/I24/);
    expect(out[0]).toMatch(/nothing in the denominator/);
  });

});
