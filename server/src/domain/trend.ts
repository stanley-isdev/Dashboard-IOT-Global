import type { TrendPoint } from '@dashboard/contract';
import type { MachineHourOaRow } from '../influx/queries.ts';
import { finiteNumber, orderSlots, round1 } from './oa.ts';
import { influxTimeToIsoUtc } from '../influx/time.ts';

/**
 * Q-05 - the hourly %OA trend under the KPI strip.
 *
 * ## The three rules, and why each one is the one it is
 *
 * **Within a machine-hour: a ratio of sums.** DESIGN.md §9.1 defines %OA per
 * `Group_PO`, and a machine can finish one order and start another inside the
 * same clock hour (measured: 11 of 287 machine-hours on 2026-08-26). Its
 * numerators and denominators are added before the division rather than its
 * percentages averaged, so nothing the machine produced in that hour is
 * discarded and a two-shot order cannot carry the same weight as a two-hundred-
 * shot one. Where a machine ran a single order - the other 96% - this is
 * exactly §9.1 unchanged.
 *
 * **Across machines: the plain mean, the same rule the card uses.** D-20 closed
 * on `simple_avg` because that is what reproduces the production board's header,
 * and the same word has to mean the same thing on the chart as on the card
 * above it. The cost is visible in the live data and is not hidden: an hour
 * measured over one machine gets the same dot as an hour measured over
 * eighteen, which is what `machine_count` on every point exists to say.
 *
 * **Hours with nothing measurable are emitted, not skipped.** A 24-slot
 * timeline with a gap in it says "no production that hour"; 19 points squeezed
 * across the same axis says the hours were shorter. `oa_pct: null` is the
 * contract's own way to spell absence (R2), and TrendChart already bridges it.
 *
 * ## What this is NOT
 *
 * Not shift-relative (D-26, open): the buckets are clock hours. Not comparable
 * point-to-point when the denominator moves - the 09:00 bucket on 2026-08-26
 * read 158.3% over five machines, three of which were ASI machines running two
 * and three orders in one shot (D-27), while the hour before and after it were
 * measured over fourteen. The figure is reported as computed, as it is on the
 * card, and the payload carries the counts that explain it.
 */

/** One machine's %OA inside one clock hour, folded from however many orders it ran. */
export interface MachineHourOa {
  /** The hour's start, ISO UTC. */
  ts: string;
  plant: string;
  machine: string;
  /** `null` when the machine had an order but no usable standard time or output. */
  oaPct: number | null;
  /** The most PO slots any of its order groups carried that hour. 1 unless D-27 applies. */
  poSlots: number;
}

/**
 * Collapses the query's (hour x machine x order) rows to one entry per
 * (hour x machine).
 *
 * A row with no order loaded is dropped rather than entered as a zero - the
 * same treatment the card gives it, and for the same reason: "no order" is not
 * "no efficiency" (R2). A machine that spent the whole hour idle therefore does
 * not appear in that hour at all, and `machine_count` falls instead of the line.
 */
export function foldMachineHours(rows: MachineHourOaRow[]): MachineHourOa[] {
  const acc = new Map<
    string,
    { ts: string; plant: string; machine: string; num: number; den: number; poSlots: number }
  >();

  for (const row of rows) {
    // Without all three the row cannot be placed on the chart or attributed to
    // a machine, and putting it somewhere convenient would invent provenance.
    if (!row.plant || !row.machine) continue;
    const ts = influxTimeToIsoUtc(row.bucket);
    if (!ts) continue;

    const slots = orderSlots([row.po0, row.po1, row.po2, row.po3]);
    if (slots.length === 0) continue;

    const key = `${ts}|${row.plant}|${row.machine}`;
    const held =
      acc.get(key) ??
      { ts, plant: row.plant, machine: row.machine, num: 0, den: 0, poSlots: 0 };
    acc.set(key, held);
    held.poSlots = Math.max(held.poSlots, slots.length);

    const minStd = finiteNumber(row.min_std_time);
    const qty = finiteNumber(row.sum_qty);
    const weighted = finiteNumber(row.weighted_time);
    // Same guards as oaFromPoGroup: a std_time of 0 would make the whole hour
    // read 0%, and an order that produced nothing has no time to divide by.
    if (minStd === null || minStd <= 0) continue;
    if (qty === null || qty <= 0) continue;
    if (weighted === null || weighted <= 0) continue;

    held.num += minStd * qty;
    held.den += weighted;
  }

  return [...acc.values()].map((m) => {
    const pct = m.den > 0 ? (m.num / m.den) * 100 : null;
    return {
      ts: m.ts,
      plant: m.plant,
      machine: m.machine,
      oaPct: pct !== null && Number.isFinite(pct) ? round1(pct) : null,
      poSlots: m.poSlots,
    };
  });
}

/** The `points` hour-starts ending at the hour `now` falls in, oldest first, ISO UTC. */
export function hourSlots(now: Date, points: number): string[] {
  const end = new Date(now.getTime());
  end.setUTCMinutes(0, 0, 0);
  const out: string[] = [];
  for (let i = points - 1; i >= 0; i--) {
    out.push(new Date(end.getTime() - i * 3_600_000).toISOString());
  }
  return out;
}

export interface TrendBuild {
  points: TrendPoint[];
  /** Buckets the database returned that fall outside the emitted timeline. */
  strayBuckets: string[];
}

/**
 * The chart's array: exactly `points` hourly entries, oldest first, the last
 * being the hour in progress.
 *
 * The timeline comes from the SERVER's clock while the buckets come from the
 * database's, and the two are not guaranteed to agree. Rather than trust either
 * silently, any returned bucket that falls outside the emitted range is
 * collected into `strayBuckets` for the caller to put on the envelope - a chart
 * quietly missing its newest hour because two machines disagree about what time
 * it is looks exactly like a plant that stopped producing.
 */
export function buildTrend(opts: {
  hours: MachineHourOa[];
  now: Date;
  points: number;
  /** Plant code to the site the point should count, `null` for a plant off the map. */
  siteOf: (plant: string) => string | null;
}): TrendBuild {
  const slots = hourSlots(opts.now, opts.points);
  const index = new Map(slots.map((ts) => [ts, [] as MachineHourOa[]]));
  const stray = new Set<string>();

  for (const h of opts.hours) {
    const bucket = index.get(h.ts);
    if (!bucket) {
      stray.add(h.ts);
      continue;
    }
    bucket.push(h);
  }

  const points = slots.map((ts): TrendPoint => {
    const all = index.get(ts) ?? [];
    // Counted off the machines that produced a figure, not the ones that
    // reported: it is the denominator of the mean directly above it.
    const usable = all.filter((h) => h.oaPct !== null);
    const sites = new Set<string>();
    for (const h of usable) {
      const site = opts.siteOf(h.plant);
      if (site) sites.add(site);
    }
    return {
      ts,
      oa_pct:
        usable.length === 0
          ? null
          : round1(usable.reduce((a, h) => a + (h.oaPct as number), 0) / usable.length),
      site_count: sites.size,
      machine_count: usable.length,
    };
  });

  return { points, strayBuckets: [...stray].sort() };
}

/**
 * The caveats the chart carries, as sentences for `meta.warnings`.
 *
 * Both are about the shape of the denominator rather than the value of the
 * line, because that is what a reader cannot see and cannot infer: a dot drawn
 * from one machine is the same dot as one drawn from eighteen.
 */
export function trendWarnings(build: TrendBuild): string[] {
  const out: string[] = [];
  const measured = build.points.filter((p) => p.oa_pct !== null);

  if (measured.length > 0) {
    const counts = measured.map((p) => p.machine_count ?? 0);
    const low = Math.min(...counts);
    const high = Math.max(...counts);
    // Only worth saying when the swing is big enough to move the mean around.
    // A 12-to-14 range is the same measurement; 1-to-18 is not.
    if (high >= 4 && low * 2 <= high) {
      out.push(
        `trend: the hourly %OA is a mean over the machines that had an order loaded in that hour, and that count swings from ${low} to ${high} across the 24 h shown - hours measured over few machines move for reasons that are not production. Each point carries its own machine_count`,
      );
    }
  }

  const empty = build.points.length - measured.length;
  if (empty > 0) {
    out.push(
      `trend: ${empty} of ${build.points.length} hours had no machine with an order loaded and are reported as null, not 0 - a gap in the line, never a drop to the floor`,
    );
  }

  if (build.strayBuckets.length > 0) {
    out.push(
      `trend: InfluxDB returned ${build.strayBuckets.length} hourly bucket(s) outside the 24 h this server timed (${build.strayBuckets.slice(0, 3).join(', ')}) - the two clocks disagree, so the chart may be missing an hour`,
    );
  }

  return out;
}
