import type { Alert } from '@dashboard/contract';
import { severityForStopDuration } from '../config/policy.ts';
import type { LiveSnapshot, MachineObservation } from '../services/liveSnapshot.ts';

/**
 * Q-06: the top-N longest active stops across every site, built ENTIRELY from
 * `production_machine_status` - `Result='Stop'` and `StatusStartTime`,
 * DESIGN.md §10 - the same rows Q-01 already polls for the machine census, so
 * this costs no second query and can never disagree with the STOP count on
 * the KPI strip about which machines are down.
 *
 * Deliberately NOT reading `production_alarm_logs`: that table has severity,
 * `alarm_class` and a message, but nothing to say WHICH stop on a machine an
 * alarm row belongs to without a join this function does not attempt. So this
 * list only ever knows a machine is `Stop` and for how long - `severity` is
 * bucketed by duration alone (config/policy.ts `severityForStopDuration`),
 * `category` is always `'other'`, `reason`/`reason_code` are generic, and
 * `owner`/`production_order`/`part_name` stay `null` rather than invented
 * (T-08, contract rule R2). All five are placeholders pending a design
 * decision on whether/how to fold the alarm log in - not real classifications.
 *
 * ## Scope
 *
 * `inScope` is required, and required rather than defaulted, because the one
 * bug this function has had was a missing scope. It was called with the raw
 * snapshot while every other figure in the payload went through the region,
 * Lamp, Process and Zone filters, so narrowing the board to one base left this
 * list reporting stops at the bases the reader had just filtered out. The
 * project's own `alert-provenance` invariant caught it - "a site that sends
 * nothing cannot report a fault" - and because a violation is fatal outside
 * production, the whole response became a 500: picking one base emptied the
 * board rather than narrowing it.
 *
 * A default of "keep everything" would have made that failure silent again, and
 * silent is worse - the list would simply have been about a different machine
 * set than the cards above it. So the caller has to state the scope.
 */
export function buildLongestActiveStops(
  snapshot: LiveSnapshot,
  companyOfPlant: Map<string, string>,
  now: Date,
  limit: number,
  /**
   * True for a machine row this board is actually about.
   *
   * Must be the CENSUS scope - the machines behind the STOP figure on the KPI
   * strip - or the panel and the number above it disagree about how many
   * machines are down.
   */
  inScope: (m: MachineObservation) => boolean,
): Alert[] {
  const nowMs = now.getTime();

  const stopped: { plant: string; machine: string; zone: string | null; company: string; statusStartTime: number; durationSec: number }[] =
    [];

  for (const observations of Object.values(snapshot.machines)) {
    for (const obs of observations) {
      if (obs.status !== 'Stop' || obs.statusStartTime === null) continue;
      // Before the company lookup, because a machine outside the scope is not a
      // provenance question - it is simply not on this board.
      if (!inScope(obs)) continue;

      const company = companyOfPlant.get(obs.plant);
      // Same rule the %OA roll-up follows for orphan plants (BACKEND-HANDOVER
      // §4.3a): a plant master data has never heard of cannot be attributed to
      // a company, so it cannot appear on this list either.
      if (!company) continue;

      stopped.push({
        plant: obs.plant,
        machine: obs.machine,
        zone: obs.zone,
        company,
        statusStartTime: obs.statusStartTime,
        // Negative would mean a clock disagreement between the poller and
        // InfluxDB, not a real duration - clamped rather than shown as such.
        durationSec: Math.max(0, Math.round((nowMs - obs.statusStartTime) / 1000)),
      });
    }
  }

  stopped.sort((a, b) => b.durationSec - a.durationSec);

  return stopped.slice(0, limit).map((s) => ({
    id: `${s.plant}/${s.machine}/${s.statusStartTime}`,
    company: s.company,
    plant: s.plant,
    zone: s.zone,
    machine: s.machine,
    reason_code: 'stop.unspecified',
    reason: 'Stop',
    severity: severityForStopDuration(s.durationSec),
    category: 'other',
    started_at: new Date(s.statusStartTime).toISOString(),
    duration_sec: s.durationSec,
    production_order: null,
    part_name: null,
    owner: null,
    grafana_url: null,
  }));
}
