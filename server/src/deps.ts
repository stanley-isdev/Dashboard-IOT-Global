import type { Env } from './config/env.ts';
import type { SnapshotPoller } from './services/liveSnapshot.ts';

/**
 * What route modules need from the app. Passed explicitly through
 * `register(routes, { prefix, deps })` rather than kept as module-level
 * mutable state, so two apps built in the same test process (as
 * test/*.test.ts do) cannot see each other's poller.
 */
export interface Deps {
  env: Env;
  poller: SnapshotPoller;
}
