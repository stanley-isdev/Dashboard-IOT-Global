#!/usr/bin/env node
/**
 * Run one SQL query against the InfluxDB instance `server/.env` points at.
 *
 *   node scripts/influx-query.mjs "SELECT ..."
 *   node scripts/influx-query.mjs --file query.sql
 *   echo "SELECT ..." | node scripts/influx-query.mjs
 *
 * Reads the URL, database and token out of `server/.env` so the token never has
 * to be pasted onto a command line or into shell history. Nothing here writes -
 * the v3 SQL endpoint is read-only - so it is safe to point at production.
 *
 * Output is a table by default, `--json` for the raw rows, `--csv` to paste into
 * a spreadsheet.
 *
 * Two things the live instance will do to you, both worth knowing before you
 * start (BACKEND-HANDOVER §4.2):
 *
 *   - **Unquoted mixed-case columns return HTTP 500 with an EMPTY body.**
 *     DataFusion lower-cases them, so `Result` becomes `result`, which does not
 *     exist. Always write `"Result"`, `"ProductionOrder0"`, `"vCreateDateTxt0"`
 *     with double quotes. This script names the offenders instead of letting the
 *     server answer with nothing.
 *   - **Unbounded queries hit a file-scan cap.** A query with no `time`
 *     predicate can come back "Query would scan 432 Parquet files, exceeding the
 *     file limit". Always put a `WHERE "time" >= now() - INTERVAL '24 hours'` on
 *     it. Windows wider than ~3 days fail differently, with the empty 500.
 */
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const ENV_PATH = new URL('../server/.env', import.meta.url);

/** Mixed-case columns on the live schema. Unquoted, each is a silent 500. */
const MIXED_CASE = [
  'codeCompany', 'codeCountry', 'mainGroup', 'Result', 'Result1', 'MachineState',
  'MachineStatus', 'StatusStartTime', 'StartTime', 'SendTrigger', 'AlarmCount',
  'AlarmMessage', 'ProductionOrder0', 'ProductionOrder1', 'ProductionOrder2',
  'ProductionOrder3', 'TotalEnergy_Diff', 'MotorEnergy_Diff', 'HeatingEnergy_Diff',
  'vIcsName0', 'vIcsName1', 'vIcsName2', 'vIcsName3',
  'vCreateDateTxt0', 'vCreateDateTxt1', 'vCreateDateTxt2', 'vCreateDateTxt3',
];

function loadEnv() {
  let raw;
  try {
    raw = readFileSync(ENV_PATH, 'utf8');
  } catch {
    console.error(`Cannot read ${ENV_PATH.pathname}. Copy server/.env.example to server/.env first.`);
    exit(1);
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  for (const key of ['INFLUX_URL', 'INFLUX_DATABASE', 'INFLUX_TOKEN']) {
    if (!env[key]) {
      console.error(`server/.env is missing ${key}.`);
      exit(1);
    }
  }
  return env;
}

function readSql() {
  const args = argv.slice(2).filter((a) => !a.startsWith('--'));
  const fileFlag = argv.indexOf('--file');
  if (fileFlag !== -1 && argv[fileFlag + 1]) return readFileSync(argv[fileFlag + 1], 'utf8');
  if (args.length > 0) return args.join(' ');
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function warnUnquoted(sql) {
  const bare = sql.replace(/"[^"]*"/g, '');
  const bad = MIXED_CASE.filter((c) => new RegExp(`\\b${c}\\b`).test(bare));
  if (bad.length > 0) {
    console.error(
      `\n!! Unquoted mixed-case column(s): ${bad.join(', ')}\n` +
        `   InfluxDB will answer HTTP 500 with an empty body. Wrap them in double quotes, e.g. "${bad[0]}".\n`,
    );
  }
}

const env = loadEnv();
const sql = readSql().trim();
if (!sql) {
  console.error('Usage: node scripts/influx-query.mjs "SELECT ... FROM production_machine_status WHERE ..."');
  exit(1);
}
warnUnquoted(sql);
// `information_schema` is metadata, has no `time` column at all, and is not
// subject to the file-scan cap - warning about it sends you off adding a
// predicate that makes the query fail for a different reason.
if (!/\btime\b/.test(sql) && !/information_schema/i.test(sql)) {
  console.error('!! No `time` predicate. Add WHERE "time" >= now() - INTERVAL \'24 hours\' or the file-scan cap may reject it.\n');
}

const base = env.INFLUX_URL.replace(/\/+$/, '');
const started = Date.now();
let res;
try {
  res = await fetch(`${base}/api/v3/query_sql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.INFLUX_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ db: env.INFLUX_DATABASE, q: sql, format: 'json' }),
    signal: AbortSignal.timeout(60_000),
  });
} catch (err) {
  console.error(`Could not reach ${base}: ${err.message}`);
  console.error('If this is a timeout, check the VPN / plant network - the host is not public.');
  exit(1);
}

if (!res.ok) {
  const body = (await res.text()).trim();
  console.error(`HTTP ${res.status}${body ? `: ${body.slice(0, 400)}` : ' with an EMPTY body'}`);
  if (res.status === 500 && !body) {
    console.error('Empty 500 = an unquoted mixed-case column, or a time window wider than ~3 days.');
  }
  exit(1);
}

const rows = await res.json();
const ms = Date.now() - started;

if (argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (argv.includes('--csv')) {
  if (rows.length > 0) {
    const cols = Object.keys(rows[0]);
    console.log(cols.join(','));
    for (const r of rows) console.log(cols.map((c) => JSON.stringify(r[c] ?? '')).join(','));
  }
} else if (rows.length === 0) {
  console.log('(no rows)');
} else {
  console.table(rows);
}
console.error(`\n${rows.length} row(s) in ${ms} ms  ·  ${base}  db=${env.INFLUX_DATABASE}`);
