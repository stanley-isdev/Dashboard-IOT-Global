import { describe, expect, it } from 'vitest';
import {
  buildTrend,
  foldMachineHours,
  hourSlots,
  trendWarnings,
  type MachineHourOa,
} from '../src/domain/trend.ts';
import { machineHourOaSql, TREND_POINTS } from '../src/influx/queries.ts';
import type { MachineHourOaRow } from '../src/influx/queries.ts';

/**
 * Q-05 against the live InfluxDB, read at 2026-08-26 ~08:41Z. As with
 * oa.test.ts, the numbers here were taken out of the instance in those minutes
 * rather than invented, so the file is a reconciliation and not a restatement
 * of the code.
 *
 * The shape of that day is the thing worth pinning: the hourly average moved
 * between 70.4% and 158.3% while the number of machines behind it moved between
 * 1 and 18, and the 158.3% hour was five machines of which three were ASI
 * machines running two and three orders in one shot (D-27).
 */

/** A row as the query returns it, one order in slot 0. */
function row(over: Partial<MachineHourOaRow> = {}): MachineHourOaRow {
  return {
    bucket: '2026-08-25T18:00:00',
    plant: '6332',
    machine: 'P1I1',
    po0: '110000958487',
    po1: '-',
    po2: '-',
    po3: '-',
    min_std_time: 65,
    sum_qty: 51,
    weighted_time: 3570,
    ...over,
  };
}

const NOW = new Date('2026-08-26T08:41:23.000Z');
/** A date-hour on the timeline NOW produces, which runs 2026-08-25T09 .. 2026-08-26T08. */
const at = (dateHourUtc: string) => `${dateHourUtc}:00:00.000Z`;

function hour(over: Partial<MachineHourOa> = {}): MachineHourOa {
  return { ts: at('2026-08-26T08'), plant: '6332', machine: 'I5', oaPct: 80, poSlots: 1, ...over };
}

const SITE_OF = (plant: string) => (plant === '6051' ? 'ASI' : plant === 'X' ? null : 'THS');

describe('machineHourOaSql', () => {
  it('bins on the hour and asks for one bucket fewer than it draws', () => {
    const sql = machineHourOaSql(24);
    expect(sql).toContain(`date_bin(INTERVAL '1 hour', "time") AS bucket`);
    // 23, not 24: the newest bucket is the hour in progress, so a full 24 h back
    // would return a partial bucket the chart has no slot for.
    expect(sql).toContain(`- INTERVAL '23 hours'`);
  });

  it('quotes every mixed-case column, or InfluxDB answers 500 with an empty body', () => {
    const sql = machineHourOaSql();
    for (const slot of [0, 1, 2, 3]) {
      expect(sql).toContain(`"ProductionOrder${slot}"`);
    }
    expect(sql).not.toMatch(/[^"]ProductionOrder0[^"]/);
  });

  it('refuses a window it knows the server answers 500 to', () => {
    expect(() => machineHourOaSql(200)).toThrow(/2\.\.71/);
    expect(() => machineHourOaSql(1)).toThrow(/2\.\.71/);
  });
});

describe('foldMachineHours', () => {
  it("reproduces the 18:00 bucket's single machine exactly", () => {
    // 65 * 51 / 3570 = 92.857... The hour had exactly one machine on an order,
    // out of 22 that reported at all.
    expect(foldMachineHours([row()])).toEqual([
      { ts: '2026-08-25T18:00:00.000Z', plant: '6332', machine: 'P1I1', oaPct: 92.9, poSlots: 1 },
    ]);
  });

  it('adds a machine\'s two orders in one hour before dividing, never after', () => {
    /*
     * ASI M-ID-02 in the 09:00 bucket: three orders in one shot at 418.9% and
     * two at 279.4%. Averaging those percentages gives 349.2 and lets the
     * 14-shot group weigh as much as the 28-shot one. The ratio of the sums -
     * (168*168 + 112*56) / (6737.22 + 2245.04) - is 384.0, which is the figure the
     * machine's whole hour actually earned.
     */
    const folded = foldMachineHours([
      row({
        bucket: '2026-08-25T09:00:00',
        plant: '6051',
        machine: 'M-ID-02',
        po0: 'ASSI92803061',
        po1: 'ASSI92803063',
        po2: 'ASSI92803064',
        min_std_time: 168,
        sum_qty: 168,
        weighted_time: 6737.22,
      }),
      row({
        bucket: '2026-08-25T09:00:00',
        plant: '6051',
        machine: 'M-ID-02',
        po0: 'ASSI92803056',
        po1: 'ASSI92803057',
        min_std_time: 112,
        sum_qty: 56,
        weighted_time: 2245.04,
      }),
    ]);

    expect(folded).toHaveLength(1);
    expect(folded[0].oaPct).toBe(384);
    // The widest group's slot count, so the machine can be named as a D-27 case.
    expect(folded[0].poSlots).toBe(3);
  });

  it('drops a machine with no order rather than entering it as a zero', () => {
    // 6051 M-ID-10 in the 08:00 bucket: all four slots `-`, std_time and qty 0.
    const folded = foldMachineHours([
      row({ po0: '-', po1: '-', po2: '-', po3: '-', min_std_time: 0, sum_qty: 0, weighted_time: 0 }),
    ]);
    expect(folded).toEqual([]);
  });

  it('reports null, not 0%, when an order carries no standard time or no output', () => {
    const noStd = foldMachineHours([row({ min_std_time: 0 })]);
    const noOut = foldMachineHours([row({ sum_qty: 0, weighted_time: 0 })]);
    expect(noStd[0].oaPct).toBeNull();
    expect(noOut[0].oaPct).toBeNull();
    // Still present, because the machine WAS on an order - the hour knows it
    // exists and simply cannot score it.
    expect(noStd[0].machine).toBe('P1I1');
  });

  it('drops rows that cannot be placed on the chart or attributed to a machine', () => {
    expect(foldMachineHours([row({ bucket: null })])).toEqual([]);
    expect(foldMachineHours([row({ plant: null })])).toEqual([]);
    expect(foldMachineHours([row({ machine: null })])).toEqual([]);
  });

  it('reads the bucket as UTC even though InfluxDB sends no zone marker', () => {
    // R1: a bare `2026-08-25T18:00:00` parsed as local time is the seven-hour
    // defect the whole primitives module exists to prevent.
    expect(foldMachineHours([row()])[0].ts).toBe('2026-08-25T18:00:00.000Z');
  });
});

describe('hourSlots', () => {
  it('emits `points` hour-starts ending at the hour now falls in', () => {
    const slots = hourSlots(NOW, TREND_POINTS);
    expect(slots).toHaveLength(24);
    expect(slots[23]).toBe('2026-08-26T08:00:00.000Z');
    expect(slots[0]).toBe('2026-08-25T09:00:00.000Z');
  });

  it('is oldest first, matching what TrendChart has always drawn', () => {
    const slots = hourSlots(NOW, 3);
    expect(slots).toEqual([
      '2026-08-26T06:00:00.000Z',
      '2026-08-26T07:00:00.000Z',
      '2026-08-26T08:00:00.000Z',
    ]);
  });
});

describe('buildTrend', () => {
  it('averages the machines in an hour as a plain mean, the rule the card uses', () => {
    const { points } = buildTrend({
      hours: [
        hour({ machine: 'A', oaPct: 40 }),
        hour({ machine: 'B', oaPct: 60 }),
        hour({ machine: 'C', oaPct: 110 }),
      ],
      now: NOW,
      points: TREND_POINTS,
      siteOf: SITE_OF,
    });
    expect(points[23].oa_pct).toBe(70);
    expect(points[23].machine_count).toBe(3);
  });

  it('emits every hour, so an idle hour is a gap and not a shorter axis', () => {
    const { points } = buildTrend({
      hours: [hour()],
      now: NOW,
      points: TREND_POINTS,
      siteOf: SITE_OF,
    });
    expect(points).toHaveLength(24);
    // 23 empty hours, reported as absence rather than as zero efficiency (R2).
    expect(points.filter((p) => p.oa_pct === null)).toHaveLength(23);
    expect(points[0]).toEqual({
      ts: '2026-08-25T09:00:00.000Z',
      oa_pct: null,
      site_count: 0,
      machine_count: 0,
    });
  });

  it('counts sites and machines off the machines that produced a figure', () => {
    const { points } = buildTrend({
      hours: [
        hour({ plant: '6332', machine: 'I5', oaPct: 90 }),
        hour({ plant: '6337', machine: 'A1', oaPct: 70 }),
        hour({ plant: '6051', machine: 'M-ID-01', oaPct: 80 }),
        // On an order, but unscorable: in neither denominator.
        hour({ plant: '6051', machine: 'M-ID-09', oaPct: null }),
      ],
      now: NOW,
      points: TREND_POINTS,
      siteOf: SITE_OF,
    });
    // Two THS plants are one site; the unscorable machine counts nowhere.
    expect(points[23].site_count).toBe(2);
    expect(points[23].machine_count).toBe(3);
    expect(points[23].oa_pct).toBe(80);
  });

  it('does not credit a site to a plant master data has never heard of', () => {
    const { points } = buildTrend({
      hours: [hour({ plant: 'X', machine: 'ghost', oaPct: 50 })],
      now: NOW,
      points: TREND_POINTS,
      siteOf: SITE_OF,
    });
    // The machine is measured, but it belongs to no site on this board.
    expect(points[23].machine_count).toBe(1);
    expect(points[23].site_count).toBe(0);
  });

  it('collects buckets outside its own timeline instead of silently dropping them', () => {
    const { points, strayBuckets } = buildTrend({
      hours: [hour(), hour({ ts: '2026-08-24T08:00:00.000Z' })],
      now: NOW,
      points: TREND_POINTS,
      siteOf: SITE_OF,
    });
    expect(strayBuckets).toEqual(['2026-08-24T08:00:00.000Z']);
    expect(points[23].machine_count).toBe(1);
  });

  it('reproduces the 24 h of 2026-08-26 measured against the live instance', () => {
    /*
     * Five hours off that day, folded exactly as the query returned them. The
     * point is the pair of columns, not the line: 158.3% over five machines
     * sits next to 82.6% over fifteen, and nothing about the dot on the chart
     * distinguishes them.
     */
    const measured: [string, number[]][] = [
      ['2026-08-25T09', [49.0, 114.6, 47.5, 196.5, 384.0]],
      ['2026-08-25T14', [82.6]],
      ['2026-08-25T18', [92.9]],
      ['2026-08-26T01', [100.1]],
    ];
    const hours = measured.flatMap(([h, pcts]) =>
      pcts.map((oaPct, i) => hour({ ts: at(h), machine: `m${i}`, oaPct })),
    );
    const { points } = buildTrend({ hours, now: NOW, points: TREND_POINTS, siteOf: SITE_OF });
    const by = new Map(points.map((p) => [p.ts, p]));

    // (49.0 + 114.6 + 47.5 + 196.5 + 384.0) / 5 = 158.32
    expect(by.get(at('2026-08-25T09'))?.oa_pct).toBe(158.3);
    expect(by.get(at('2026-08-25T09'))?.machine_count).toBe(5);
    expect(by.get(at('2026-08-25T18'))?.oa_pct).toBe(92.9);
    expect(by.get(at('2026-08-25T18'))?.machine_count).toBe(1);
  });
});

describe('trendWarnings', () => {
  const build = (hours: MachineHourOa[], now = NOW) =>
    buildTrend({ hours, now, points: TREND_POINTS, siteOf: SITE_OF });

  it('names the swing in the denominator when it is wide enough to move the mean', () => {
    const hours = [
      hour({ ts: at('2026-08-26T08'), machine: 'only' }),
      ...Array.from({ length: 18 }, (_, i) => hour({ ts: at('2026-08-26T07'), machine: `m${i}` })),
    ];
    const warnings = trendWarnings(build(hours));
    expect(warnings.some((w) => w.includes('swings from 1 to 18'))).toBe(true);
  });

  it('stays quiet when the count barely moves - that is the same measurement', () => {
    const hours = [
      ...Array.from({ length: 12 }, (_, i) => hour({ ts: at('2026-08-26T08'), machine: `m${i}` })),
      ...Array.from({ length: 14 }, (_, i) => hour({ ts: at('2026-08-26T07'), machine: `m${i}` })),
    ];
    expect(trendWarnings(build(hours)).some((w) => w.includes('swings'))).toBe(false);
  });

  it('says how many hours are a gap rather than a drop to the floor', () => {
    const warnings = trendWarnings(build([hour()]));
    expect(warnings.some((w) => w.includes('23 of 24 hours had no machine'))).toBe(true);
  });

  it('reports a clock disagreement instead of a chart quietly missing an hour', () => {
    const warnings = trendWarnings(build([hour(), hour({ ts: '2026-08-24T08:00:00.000Z' })]));
    expect(warnings.some((w) => w.includes('outside the 24 h this server timed'))).toBe(true);
  });
});
