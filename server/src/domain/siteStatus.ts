import type { DataReadiness, Freshness, SiteStatus } from '@dashboard/contract';
import { isReporting } from '@dashboard/domain-shared';

/**
 * Turns "when did we last hear from this plant" into the five-way `SiteStatus`.
 *
 * The whole point of the enum (common.ts) is that these are different facts
 * demanding different responses, and the old dashboards conflated them:
 *
 *   not_connected  no gateway commissioned - nothing is wrong at that site
 *   online         reporting inside stale_after_sec
 *   stale          was reporting, has gone quiet - last numbers stay on screen
 *   no_data        connected but silent past no_data_after_sec
 *
 * Thresholds come from the server-owned FRESHNESS policy, never from a
 * constant here and never from the frontend: acceptable silence is a business
 * decision that differs by site.
 */
export function plantStatusFrom(opts: {
  readiness: DataReadiness;
  lastSeen: string | null;
  nowMs: number;
  freshness: Freshness;
}): SiteStatus {
  const { readiness, lastSeen, nowMs, freshness } = opts;

  if (readiness !== 'live') return 'not_connected';
  if (!lastSeen) return 'no_data';

  const seenMs = new Date(lastSeen).getTime();
  if (Number.isNaN(seenMs)) return 'no_data';

  const ageSec = (nowMs - seenMs) / 1000;
  if (ageSec <= freshness.stale_after_sec) return 'online';
  if (ageSec <= freshness.no_data_after_sec) return 'stale';
  return 'no_data';
}

/**
 * A company is only as connected as its plants. `degraded` is the case
 * common.ts calls out by name - some children report, some do not - and it
 * exists so a partly-wired site is not rounded up to healthy or down to dead.
 */
export function rollUpCompanyStatus(
  readiness: DataReadiness,
  plantStatuses: SiteStatus[],
): SiteStatus {
  if (readiness !== 'live') return 'not_connected';
  if (plantStatuses.length === 0) return 'no_data';

  const reporting = plantStatuses.filter(isReporting);
  if (reporting.length === 0) return 'no_data';
  if (reporting.length < plantStatuses.length) return 'degraded';
  return reporting.every((s) => s === 'online') ? 'online' : 'stale';
}

/** The most recent instant among a set, or null when none is known. */
export function latestSeen(values: (string | null)[]): string | null {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const ms = new Date(v).getTime();
    if (Number.isNaN(ms)) continue;
    if (best === null || ms > best) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}
