/**
 * Why does a wide pick come back empty?
 *
 * Run against the live instance. Uses the server's own SQL builders and its own
 * client, so what it measures is what the board sends - a probe with
 * hand-written SQL would answer a different question than the one being asked.
 *
 *   cd server
 *   npm run probe:window              # the widest pick the calendar offers
 *   npm run probe:window -- --days 7
 *
 * It answers two questions, in order.
 *
 * **A. Does a chunk answer on its own?** The chunking in windowedSnapshot.ts
 * assumes a 71 h chunk usually answers and a 24 h slice always does
 * (BACKEND-HANDOVER, measured 2026-09-08: all 28 single-day chunks of that
 * month answered, zero rejections). If that still holds, a whole window can
 * only fail when something other than width is involved.
 *
 * **B. Does it still answer with the other two families in flight?** The real
 * server settles the three families concurrently - deliberately, so a dead
 * trend query costs the chart and not the machine counts - which means the
 * instance sees three reads at once, not one. The handover measured 6 and 12
 * concurrent (828 and 392 status rows against 1,510 read one at a time) but
 * never 3 against 1, and 3 is what production runs. This closes that gap.
 *
 * B is the one to read carefully, because its bad outcome is not an error. A
 * short answer and a quiet day look identical from here, so the row COUNTS
 * matter as much as the pass/fail.
 */
import { loadEnv } from '../src/config/env.ts';
import { createInfluxClient } from '../src/influx/client.ts';
import {
  chunkWindow,
  latestMachineStatusInSql,
  machineHourOaInSql,
  machineOaInSql,
  MAX_WINDOW_HOURS,
  NARROW_WINDOW_HOURS,
  RETENTION_DAYS,
  type Window,
} from '../src/influx/queries.ts';

interface Attempt {
  ok: boolean;
  rows: number;
  ms: number;
  error?: string;
}

const FAMILIES = [
  ['status', latestMachineStatusInSql],
  ['oa', machineOaInSql],
  ['trend', machineHourOaInSql],
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const short = (iso: string) => iso.slice(5, 16).replace('T', ' ');

/** The instance's rejection is long and mostly boilerplate; the cause is not. */
function why(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m.includes('Parquet files')) {
    const n = /scan (\d+) Parquet/.exec(m)?.[1];
    return `file limit${n ? ` (${n} files)` : ''}`;
  }
  if (/timed out|aborted/i.test(m)) return 'timeout';
  return m.replace(/\s+/g, ' ').slice(0, 70);
}

async function main() {
  const env = loadEnv();
  const client = createInfluxClient(env);
  if (!client.configured) {
    throw new Error('InfluxDB is not configured - this probe only means anything against the real instance.');
  }

  const days = Number(arg('days') ?? RETENTION_DAYS);
  const to = arg('to') ?? new Date().toISOString();
  const from = arg('from') ?? new Date(Date.parse(to) - days * 86_400_000).toISOString();
  const window: Window = { from, to };

  const run = async (sql: string): Promise<Attempt> => {
    const t = Date.now();
    try {
      const rows = await client.query<unknown>(sql);
      return { ok: true, rows: rows.length, ms: Date.now() - t };
    } catch (err) {
      return { ok: false, rows: 0, ms: Date.now() - t, error: why(err) };
    }
  };

  console.log(`window        ${short(from)} .. ${short(to)}  (${days} days)`);
  console.log(`chunk widths  ${MAX_WINDOW_HOURS} h, retried at ${NARROW_WINDOW_HOURS} h`);
  console.log(`timeout       ${env.INFLUX_TIMEOUT_MS} ms per query\n`);

  /* ---- A. one family, one query at a time -------------------------------- */

  console.log('A. status family alone, sequential - what the handover measured\n');
  const chunks = chunkWindow(window, MAX_WINDOW_HOURS);
  const soloOk: Window[] = [];
  let wideOk = 0;
  let narrowOk = 0;
  let narrowFail = 0;

  for (const [i, c] of chunks.entries()) {
    const a = await run(latestMachineStatusInSql(c));
    const label = `  chunk ${String(i).padStart(2)}  ${short(c.from)} .. ${short(c.to)}`;
    if (a.ok) {
      wideOk++;
      soloOk.push(c);
      console.log(`${label}  OK    ${String(a.rows).padStart(5)} rows  ${a.ms} ms`);
      continue;
    }
    console.log(`${label}  FAIL  ${a.error}  ${a.ms} ms  -> retrying as ${NARROW_WINDOW_HOURS} h slices`);

    for (const s of chunkWindow(c, NARROW_WINDOW_HOURS)) {
      const r = await run(latestMachineStatusInSql(s));
      if (r.ok) {
        narrowOk++;
        soloOk.push(s);
      } else {
        narrowFail++;
      }
      console.log(
        `      slice   ${short(s.from)} .. ${short(s.to)}  ${r.ok ? 'OK  ' : 'FAIL'}` +
          `  ${String(r.rows).padStart(5)} rows  ${r.ms} ms${r.error ? `  ${r.error}` : ''}`,
      );
    }
  }

  console.log(
    `\n  ${wideOk}/${chunks.length} wide chunks answered; ` +
      `narrow retries ${narrowOk} answered, ${narrowFail} refused.`,
  );
  if (narrowFail === 0 && soloOk.length > 0) {
    console.log('  Every slice is readable on its own, so width alone does not explain an empty board.');
  }

  /* ---- B. three families at once, as the server actually runs them -------- */

  if (soloOk.length === 0) {
    console.log('\nB. skipped - nothing answered alone, so there is nothing to compare against.');
    return;
  }

  const probe = soloOk[Math.floor(soloOk.length / 2)]!;
  console.log(`\nB. the same slice with all three families in flight - what production does`);
  console.log(`   slice ${short(probe.from)} .. ${short(probe.to)}\n`);

  const alone: Record<string, Attempt> = {};
  for (const [name, sql] of FAMILIES) alone[name] = await run(sql(probe));

  const together = Object.fromEntries(
    (await Promise.all(FAMILIES.map(async ([name, sql]) => [name, await run(sql(probe))] as const))).map(
      ([n, a]) => [n, a],
    ),
  ) as Record<string, Attempt>;

  console.log('  family   alone                      three at once');
  for (const [name] of FAMILIES) {
    const a = alone[name]!;
    const b = together[name]!;
    const fmt = (x: Attempt) =>
      `${x.ok ? 'OK  ' : 'FAIL'} ${String(x.rows).padStart(5)} rows ${String(x.ms).padStart(5)} ms${x.error ? ` ${x.error}` : ''}`;
    console.log(`  ${name.padEnd(7)}  ${fmt(a).padEnd(26)} ${fmt(b)}`);
  }

  const lost = FAMILIES.filter(([n]) => alone[n]!.ok && (!together[n]!.ok || together[n]!.rows < alone[n]!.rows));
  console.log('');
  if (lost.length === 0) {
    console.log('  Three in flight cost nothing here. Concurrency is not the difference.');
  } else {
    console.log(
      `  ${lost.map(([n]) => n).join(', ')} came back worse with three in flight.\n` +
        '  That is the failure the handover warns about: a short answer is indistinguishable\n' +
        '  from a quiet day, so nothing downstream can detect it.',
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
