import type { Absence, DataReadiness, Freshness, SiteStatus } from '@dashboard/contract';
import { isReporting } from '@dashboard/domain-shared';

/**
 * Whether a plant's telemetry has EVER reached this backend, over a horizon far
 * wider than any request's window (config/policy.ts's EVER_SEEN).
 *
 * Tri-state rather than a boolean because "we have not asked yet" is a real and
 * frequent state - every plant is in it until the first probe lands - and
 * collapsing it into `false` would flash every quiet site as `not_connected`
 * for the first seconds of every boot.
 *
 * The value is monotonic: `'no'` and `'unknown'` may become `'yes'`, never the
 * reverse. A site that has reported once has proven the pipe exists, and no
 * later silence unproves it.
 */
export type EverSeen = 'yes' | 'no' | 'unknown';

/**
 * Turns "when did we last hear from this plant" into the five-way `SiteStatus`.
 *
 * The whole point of the enum (common.ts) is that these are different facts
 * demanding different responses, and the old dashboards conflated them:
 *
 *   not_connected  nothing has ever reached us - either no gateway is
 *                  commissioned, or one is claimed and its data has never
 *                  arrived. Nothing is wrong at that site.
 *   online         reporting inside stale_after_sec
 *   stale          was reporting, has gone quiet - last numbers stay on screen
 *   no_data        HAS reached us before, but is silent in the picked window -
 *                  a shutdown week, a holiday, a machine with no order
 *
 * **Two inputs decide `not_connected`, not one.** `readiness` alone used to,
 * and that is the bug STJ exposed: master data declares it `live`, no row of
 * its telemetry has ever arrived here (D-17), and a status derived only from
 * config sailed past the `not_connected` gate and reported `no_data` - which an
 * executive reads as "that plant is quiet", escalating to a site that is doing
 * nothing wrong. Config can now assert `live` all it likes; `everSeen` is the
 * observation that has to agree with it.
 *
 * The order below matters. Direct evidence outranks the probe: a plant carrying
 * a `lastSeen` is in the hot window right now, so it has demonstrably reached
 * us whether or not the slower probe has answered yet.
 *
 * Thresholds come from the server-owned FRESHNESS policy, never from a
 * constant here and never from the frontend: acceptable silence is a business
 * decision that differs by site.
 */
export function plantStatusFrom(opts: {
  readiness: DataReadiness;
  lastSeen: string | null;
  everSeen: EverSeen;
  nowMs: number;
  freshness: Freshness;
}): SiteStatus {
  const { readiness, lastSeen, everSeen, nowMs, freshness } = opts;

  // Config's own fact, and the one thing no query can observe: whether anyone
  // has installed a gateway at that site yet (SEH mid-install, VNS unscheduled).
  if (readiness !== 'live') return 'not_connected';

  if (lastSeen) {
    const seenMs = new Date(lastSeen).getTime();
    // A row we cannot date still proves the plant reached us, so the honest
    // answer is silent-but-connected. Never `not_connected` - that would let a
    // malformed timestamp read as "this site was never wired".
    if (Number.isNaN(seenMs)) return 'no_data';

    const ageSec = (nowMs - seenMs) / 1000;
    if (ageSec <= freshness.stale_after_sec) return 'online';
    if (ageSec <= freshness.no_data_after_sec) return 'stale';
    return 'no_data';
  }

  /*
   * Silent in the picked window - and this is the fork the old code could not
   * make. `'no'` is a probe that came back empty across the full horizon, which
   * is as close to "never" as this system can get. `'unknown'` is a probe that
   * has not landed yet, and it deliberately keeps the pre-existing behaviour:
   * until we know, we claim only that we have no data, which is true.
   */
  return everSeen === 'no' ? 'not_connected' : 'no_data';
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

  /*
   * A company none of whose plants has ever reached us has not reached us
   * either, and saying `no_data` here would undo at the company level exactly
   * what `plantStatusFrom` just got right - STJ's single plant resolving to
   * `not_connected` only to roll up as "quiet". This sits above the `reporting`
   * filter because `not_connected` is not a reporting state, so every one of
   * these plants would otherwise fall into the `reporting.length === 0` case.
   *
   * `every`, not `some`: one silent plant beside a live one is the `degraded`
   * case below - partly wired, which is ASI's shape once its second plant lands.
   */
  if (plantStatuses.every((s) => s === 'not_connected')) return 'not_connected';

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

/**
 * Turns master data's absence note into the served `Absence`, or `null` for a
 * site that is reporting.
 *
 * **The reading comes from the database, not from this note.** A site with an
 * absence has no telemetry, and the UI says exactly that - "no telemetry
 * received" - because that is what the query established. `reason` is only for
 * what no query can know: SEH's gateways being fitted, VNS having no date. It
 * is `null` for STJ, and that is the correct outcome rather than a gap: the
 * database's answer is the whole answer, and every earlier attempt to say more
 * ended in a guess (a separate instance, an invented start date) that had to be
 * retracted.
 *
 * `contradicts_config` is the honest name for the STJ shape: master data says
 * `live`, nothing has ever arrived, and those two cannot both be true. It is
 * computed - never declared - so it cannot be quietly cleared by editing a
 * file, and it separates the absence somebody must chase from the five that
 * are simply waiting their turn in the rollout.
 */
export function absenceFor(opts: {
  status: SiteStatus;
  readiness: DataReadiness;
  note: { reason: string; owner: string } | null;
}): Absence | null {
  const { status, readiness, note } = opts;

  // A reporting site has no absence to explain, whatever config still carries.
  if (status !== 'not_connected') return null;

  /*
   * Returned even when config has nothing to add, and that is the point.
   *
   * The reading a viewer gets - "no telemetry received" - is a database fact,
   * so it must not depend on somebody having written a note. Returning `null`
   * here for an unannotated site is what let the map pin fall back to
   * `readiness.live` and caption STJ's empty tile "Live"; the absence object
   * itself is the signal that there is nothing to show, and `reason` is only
   * the optional human addition on top of it.
   */
  return {
    reason: note?.reason ?? null,
    owner: note?.owner ?? null,
    contradicts_config: readiness === 'live',
  };
}
