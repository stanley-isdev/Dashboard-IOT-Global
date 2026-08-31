import type { SourceHealth } from '@dashboard/contract';
import type { Env } from '../config/env.ts';
import { FRESHNESS } from '../config/policy.ts';
import type { LiveSnapshot } from '../services/liveSnapshot.ts';

/**
 * Real source health, derived from the snapshot poller rather than probed
 * separately: the business query IS the probe, so `ok` can never mean "a
 * SELECT 1 succeeded while the query the screen depends on was failing".
 *
 * `degraded` vs `down` is the distinction that matters to an operator.
 * A poll that just failed but succeeded moments ago is a blip on a source we
 * still have good data from; one that has never succeeded, or has been failing
 * past the staleness threshold, is an outage. Reporting both as `down` would
 * make the amber banner meaningless.
 *
 * MSSQL is listed ONLY when it is configured. It is unwired in milestone 1
 * (D-18 - whether defect data reaches the exec dashboard is still open), and
 * `Envelope.partial` is `sources.some(s => s.status !== 'ok')`, so an
 * unconfigured source permanently pinned to `down` would flag every response
 * as partial and dim the entire dashboard forever - crying wolf about a source
 * no route reads. Absent means "not part of this deployment"; present and
 * `down` means "should be working and is not".
 */
export function sourceHealthFrom(
  snapshot: LiveSnapshot | null,
  env: Env,
  nowMs: number = Date.now(),
): SourceHealth[] {
  const sources: SourceHealth[] = [influxHealth(snapshot, env, nowMs)];

  if (env.MSSQL_SERVER) {
    sources.push({
      name: 'mssql',
      status: 'down',
      last_success: null,
      message: 'configured but not wired into any route - defect data deferred (D-18)',
    });
  }

  return sources;
}

function influxHealth(snapshot: LiveSnapshot | null, env: Env, nowMs: number): SourceHealth {
  if (!env.INFLUX_URL || !env.INFLUX_DATABASE || !env.INFLUX_TOKEN) {
    return {
      name: 'influxdb',
      status: 'down',
      last_success: null,
      message: 'not configured - set INFLUX_URL, INFLUX_DATABASE and INFLUX_TOKEN in server/.env',
    };
  }

  if (!snapshot) {
    return {
      name: 'influxdb',
      status: 'down',
      last_success: null,
      message: 'no poll has completed yet',
    };
  }

  if (snapshot.ok) {
    // Telemetry is landing but the %OA aggregate is not. `ok` would claim the
    // whole feed is healthy while the KPI strip serves an ageing average, so
    // this is exactly the "degraded" case: good data, one query down.
    if (!snapshot.oaOk) {
      return {
        name: 'influxdb',
        status: 'degraded',
        last_success: snapshot.lastSuccessAt,
        message: `machine status is live but the %OA query is failing: ${snapshot.oaError ?? 'unknown error'}`,
      };
    }
    // Same reasoning one query down: the KPI strip is honest, the chart is not
    // being refreshed, and calling that `ok` would leave the reader to notice
    // for themselves that the trend has stopped moving.
    if (!snapshot.trendOk) {
      return {
        name: 'influxdb',
        status: 'degraded',
        last_success: snapshot.lastSuccessAt,
        message: `machine status and %OA are live but the hourly trend query is failing: ${snapshot.trendError ?? 'unknown error'}`,
      };
    }
    return {
      name: 'influxdb',
      status: 'ok',
      last_success: snapshot.lastSuccessAt,
      message: null,
    };
  }

  const lastMs = snapshot.lastSuccessAt ? new Date(snapshot.lastSuccessAt).getTime() : null;
  const recentlyGood =
    lastMs !== null && (nowMs - lastMs) / 1000 <= FRESHNESS.stale_after_sec;

  return {
    name: 'influxdb',
    status: recentlyGood ? 'degraded' : 'down',
    last_success: snapshot.lastSuccessAt,
    message: snapshot.error,
  };
}
