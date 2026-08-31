import { z } from 'zod';

/**
 * Unlike the frontend's forgiving `runtimeConfig` (which falls back to mock
 * data and surfaces a banner on bad config), the backend must never boot on
 * malformed config - a server silently misconfigured against the wrong
 * InfluxDB/MSSQL instance is worse than one that refuses to start.
 */
const zEnv = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1),

  // Still optional: /meta and /healthz are pure master data and must keep
  // working (and staying testable) without credentials. When these are absent
  // the snapshot poller idles and every source honestly reports `down`.
  INFLUX_URL: z.string().url().optional(),
  INFLUX_DATABASE: z.string().optional(),
  INFLUX_TOKEN: z.string().optional(),

  /** Per-query ceiling. Measured p100 for the liveness query is ~100 ms. */
  INFLUX_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  /**
   * How often the backend refreshes its snapshot from InfluxDB.
   *
   * MUST stay below the frontend's `refreshMs` in
   * public/config/runtime-config.json. The UI's freeze detector
   * (`FREEZE_THRESHOLD = 3`) declares the feed frozen after three consecutive
   * identical payloads, so a poller slower than the client would raise a
   * false alarm on a healthy system. Default 2 s against a 3 s client.
   *
   * 3 s -> 2 s on 2026-08-27, alongside the client's 5 s -> 3 s: the counts
   * were up to 8 s behind the plant board and are now up to 5 s. The status
   * query measures ~300 ms, so this is a tenth of the interval.
   */
  SNAPSHOT_INTERVAL_MS: z.coerce.number().int().min(500).default(2_000),

  /**
   * How often the %OA aggregate (Q-03/Q-04) is re-read.
   *
   * **Lowered 30 s -> 5 s on 2026-08-27**, because 30 s was the lag the design
   * owner could see: the %OA card sat up to half a minute behind the plant
   * board next to it, and the board was always the newer number. Re-measured at
   * the current scope the query is 473-894 ms, so 5 s spends under a fifth of
   * the interval on a headline KPI that is read against another screen.
   */
  OA_REFRESH_MS: z.coerce.number().int().min(1_000).default(5_000),

  /**
   * How often the hourly trend (Q-05) is re-read - its own clock, on purpose.
   *
   * It shared `OA_REFRESH_MS` until 2026-08-27, which meant making %OA fast
   * would have made the chart six times more expensive for nothing: the trend
   * is the dearer query (418-1828 ms) and its newest point is an hour-long
   * bucket that a five-second refresh cannot visibly change.
   */
  TREND_REFRESH_MS: z.coerce.number().int().min(1_000).default(30_000),

  MSSQL_SERVER: z.string().optional(),
  MSSQL_DATABASE: z.string().optional(),
  MSSQL_USER: z.string().optional(),
  MSSQL_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof zEnv>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = zEnv.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
