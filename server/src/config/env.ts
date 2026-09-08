import { z } from 'zod';

/**
 * Treats `KEY=` as "not set".
 *
 * A .env line with nothing after the `=` gives an EMPTY STRING, not an absent
 * key, and every optional field below is the kind a deployment leaves blank
 * rather than deletes - .env.example ships them that way and says so. Without
 * this, `INFLUX_URL=` failed `.url()` and the server refused to boot, which is
 * the exact opposite of the documented behaviour ("leaving these blank is
 * supported - /meta and /healthz still work and every source reports down").
 *
 * Applied only to optional fields. A blank CORS_ORIGIN or PORT should still be
 * the loud failure it already is.
 */
const blankAsAbsent = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/**
 * Unlike the frontend's forgiving `runtimeConfig` (which falls back to mock
 * data and surfaces a banner on bad config), the backend must never boot on
 * malformed config - a server silently misconfigured against the wrong
 * InfluxDB/MSSQL instance is worse than one that refuses to start.
 */
const zEnv = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1),

  /**
   * Absolute path to the built frontend - the `dist/` that `npm run build`
   * writes - served from this same process and this same port.
   *
   * Optional, and absent means API-only. That is what every test in this suite
   * runs, and what a deployment that puts a reverse proxy in front of the
   * frontend would run; see plugins/staticSite.ts.
   *
   * Not validated here beyond being a non-empty string, because the check that
   * matters is whether the directory exists, and @fastify/static already makes
   * that a boot failure rather than a server that answers every page with 404.
   */
  STATIC_DIR: z.preprocess(blankAsAbsent, z.string().min(1).optional()),

  // Still optional: /meta and /healthz are pure master data and must keep
  // working (and staying testable) without credentials. When these are absent
  // the snapshot poller idles and every source honestly reports `down`.
  INFLUX_URL: z.preprocess(blankAsAbsent, z.string().url().optional()),
  INFLUX_DATABASE: z.preprocess(blankAsAbsent, z.string().optional()),
  INFLUX_TOKEN: z.preprocess(blankAsAbsent, z.string().optional()),

  /**
   * The fleet's reference zone - where the time picker's calendar days are
   * resolved to instants.
   *
   * MUST match `referenceTimezone` in public/config/runtime-config.json. The
   * calendar draws "1 Aug" in the reader's reference zone and sends the plain
   * day; if the server resolved it against its own clock instead, a Bangkok
   * reader's window would land seven hours out and the first shift of their
   * chosen day would be counted in the previous one.
   *
   * Defaulted rather than required because every other zone-aware value on this
   * server already comes off master data; this is the one the CLIENT chose, and
   * a boot failure over a value that is right in the overwhelming majority of
   * deployments would be a worse trade than a default that matches it.
   */
  REFERENCE_TIMEZONE: z.string().min(3).includes('/').default('Asia/Bangkok'),

  /**
   * How long an assembled window is cached, in ms.
   *
   * Only absolute windows ever hit it - a `now`-anchored one has a new key
   * every second - so this is really "how stale may a wall of screens showing
   * the same fixed window be". See services/windowedSnapshot.ts.
   */
  WINDOW_CACHE_MS: z.coerce.number().int().nonnegative().default(30_000),

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

  MSSQL_SERVER: z.preprocess(blankAsAbsent, z.string().optional()),
  MSSQL_DATABASE: z.preprocess(blankAsAbsent, z.string().optional()),
  MSSQL_USER: z.preprocess(blankAsAbsent, z.string().optional()),
  MSSQL_PASSWORD: z.preprocess(blankAsAbsent, z.string().optional()),
});

export type Env = z.infer<typeof zEnv>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = zEnv.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
