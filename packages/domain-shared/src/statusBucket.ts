import type { MachineStatus, SiteStatus, StatusBucket } from '@dashboard/contract';

/**
 * Machine-status → bucket mapping, ported verbatim from src/mocks/generate.ts.
 * D-21 is open: until it closes, `4M Change` sits in `other` with a neutral
 * tone. When it closes, this single mapping changes and nothing downstream
 * (SQL, services, UI) needs to move.
 */
export const BUCKET_OF: Record<MachineStatus, StatusBucket> = {
  'Mass Pro': 'running',
  Dandori: 'running',
  Stop: 'stopped',
  '4M Change': 'other',
  'No Plan': 'idle',
  'Order End': 'idle',
  Offline: 'no_data',
  // Real statuses the design doc never listed (BACKEND-HANDOVER 4.5). `other`
  // is the bucket that exists precisely for this: the raw label still shows,
  // the headline Running/Stop figures do not move on an unreviewed guess.
  // `Alarm` in particular reads like a stop, but calling it one would change
  // the STOP tile - that needs a decision, not an assumption.
  Pending: 'other',
  Alarm: 'other',
  Warning: 'other',
};

/** True when a site is contributing numbers, and so belongs in a denominator. */
export function isReporting(status: SiteStatus): boolean {
  return status === 'online' || status === 'stale' || status === 'degraded';
}

/**
 * True when a site should be ranked by performance. A stale site is still
 * ranked - it did report, and its last figure is real. It is excluded from
 * "needs attention" separately, because escalating on a number known to be
 * old wastes someone's morning.
 */
export function isRankable(status: SiteStatus): boolean {
  return isReporting(status);
}
