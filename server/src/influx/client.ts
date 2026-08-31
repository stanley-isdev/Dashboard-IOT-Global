import type { Env } from '../config/env.ts';

/**
 * Plain-HTTP InfluxDB 3.x (IOx) client - `POST /api/v3/query_sql`, JSON in,
 * JSON rows out. Chosen over the Arrow/Flight SQL client so the backend needs
 * no native/gRPC dependency and fixtures stay trivial (BACKEND-HANDOVER §2,
 * verified against the live instance in §4.1).
 *
 * Two behaviours here exist because of measured failure modes, not theory
 * (BACKEND-HANDOVER §4.2):
 *
 *   1. DataFusion lower-cases unquoted identifiers, so `codeCompany` resolves
 *      to `codecompany`, which does not exist. The server answers HTTP 500
 *      with a ZERO-LENGTH body - no message, nothing to debug from.
 *      `assertIdentifiersQuoted` refuses to send such a query at all and names
 *      the offending column, because the alternative is an operator staring at
 *      an empty 500.
 *   2. Time windows wider than ~3 days fail the same silent way.
 *      `describeFailure` turns the empty 500 into a message naming both
 *      suspects instead of "Internal Server Error".
 */

export class InfluxError extends Error {
  status?: number;
  body?: string;

  constructor(message: string, opts: { status?: number; body?: string } = {}) {
    super(message);
    this.name = 'InfluxError';
    this.status = opts.status;
    this.body = opts.body;
  }
}

/**
 * Columns whose real casing is not all-lower, taken from the live
 * `information_schema` dump in BACKEND-HANDOVER §4.3d. Any of these appearing
 * outside double quotes is the silent-500 bug, so the query never leaves here.
 */
const MIXED_CASE_COLUMNS = [
  'codeCompany',
  'codeCountry',
  'mainGroup',
  'Result',
  'Result1',
  'MachineState',
  'MachineStatus',
  'StatusStartTime',
  'StartTime',
  'SendTrigger',
  'AlarmCount',
  'AlarmMessage',
  'ProductionOrder0',
  'ProductionOrder1',
  'ProductionOrder2',
  'ProductionOrder3',
  'TotalEnergy_Diff',
  'MotorEnergy_Diff',
  'HeatingEnergy_Diff',
  'vIcsName0',
  'vIcsName1',
  'vIcsName2',
  'vIcsName3',
  // Read by the Order-End shift check (domain/orderShift.ts). Mixed case, so
  // unquoted they hit the same silent-500 as every other column on this list.
  'vCreateDateTxt0',
  'vCreateDateTxt1',
  'vCreateDateTxt2',
  'vCreateDateTxt3',
];

/** Quotes an identifier so DataFusion preserves its case. Always use this. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Quotes a STRING VALUE for a SQL predicate. Not interchangeable with `ident`:
 * that one produces `"Result"`, this one produces `'Mass Pro'`.
 *
 * Every value reaching a query builder is server-owned config today, but the old
 * Grafana panel interpolated `'${Lamp_var}'` straight into its SQL
 * (docs/grafana/MACHINE-STATUS-V2.md F-14) and that is the habit worth not
 * inheriting - the first request-supplied filter must not be the moment anyone
 * remembers escaping exists.
 */
export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function assertIdentifiersQuoted(sql: string): void {
  // Strip quoted spans first, then anything left is genuinely unquoted.
  const bare = sql.replace(/"[^"]*"/g, '');
  const offenders = MIXED_CASE_COLUMNS.filter((c) => new RegExp(`\\b${c}\\b`).test(bare));
  if (offenders.length > 0) {
    throw new InfluxError(
      `Unquoted mixed-case identifier(s) in SQL: ${offenders.join(', ')}. ` +
        'DataFusion lower-cases these and InfluxDB answers HTTP 500 with an empty body. ' +
        `Wrap them with ident(), e.g. ${ident(offenders[0]!)}.`,
    );
  }
}

function describeFailure(status: number, body: string, sql: string): string {
  const head = sql.replace(/\s+/g, ' ').slice(0, 200);
  if (status === 500 && body === '') {
    return (
      'InfluxDB returned HTTP 500 with an empty body. Measured causes (BACKEND-HANDOVER §4.2): ' +
      'an unquoted mixed-case identifier, or a time window wider than ~3 days. ' +
      `Query: ${head}`
    );
  }
  if (status === 401 || status === 403) {
    return `InfluxDB rejected the token (HTTP ${status}). Check INFLUX_TOKEN and its read permission.`;
  }
  if (status === 404) {
    return `InfluxDB has no /api/v3/query_sql endpoint (HTTP 404). Wrong edition or wrong INFLUX_URL.`;
  }
  return `InfluxDB returned HTTP ${status}: ${body || '(empty body)'}. Query: ${head}`;
}

export interface InfluxClient {
  /** False when INFLUX_URL/DATABASE/TOKEN are absent - tests and /meta still work. */
  readonly configured: boolean;
  query<T>(sql: string): Promise<T[]>;
}

export function createInfluxClient(env: Env): InfluxClient {
  const base = env.INFLUX_URL?.replace(/\/+$/, '');
  const db = env.INFLUX_DATABASE;
  const token = env.INFLUX_TOKEN;
  const timeoutMs = env.INFLUX_TIMEOUT_MS;
  const configured = Boolean(base && db && token);

  return {
    configured,

    async query<T>(sql: string): Promise<T[]> {
      if (!configured) {
        throw new InfluxError(
          'InfluxDB is not configured - set INFLUX_URL, INFLUX_DATABASE and INFLUX_TOKEN in server/.env',
        );
      }
      assertIdentifiersQuoted(sql);

      let res: Response;
      try {
        res = await fetch(`${base}/api/v3/query_sql`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ db, q: sql, format: 'json' }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError') {
          throw new InfluxError(`InfluxDB did not respond within ${timeoutMs} ms`);
        }
        throw new InfluxError(`Could not reach InfluxDB at ${base}: ${e.message}`);
      }

      if (!res.ok) {
        const body = (await res.text().catch(() => '')).trim();
        throw new InfluxError(describeFailure(res.status, body, sql), { status: res.status, body });
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new InfluxError('InfluxDB returned a body that was not JSON');
      }
      if (!Array.isArray(json)) {
        throw new InfluxError('InfluxDB returned JSON that was not an array of rows');
      }
      return json as T[];
    },
  };
}
