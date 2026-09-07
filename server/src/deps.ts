import type { Env } from './config/env.ts';
import type { SnapshotPoller } from './services/liveSnapshot.ts';
import type { WindowStore } from './services/windowedSnapshot.ts';

/**
 * What route modules need from the app. Passed explicitly through
 * `register(routes, { prefix, deps })` rather than kept as module-level
 * mutable state, so two apps built in the same test process (as
 * test/*.test.ts do) cannot see each other's poller.
 */
export interface Deps {
  env: Env;
  poller: SnapshotPoller;
  /**
   * Windows the poller does not hold - anything but a `now`-anchored 24 h.
   *
   * Beside the poller rather than replacing it: the poller is what keeps
   * InfluxDB load flat as screens are added, and the overwhelming majority of
   * requests still come out of it untouched. This is the escape hatch for a
   * reader who has picked a window of their own.
   */
  windows: WindowStore;
}
