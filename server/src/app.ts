import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Env } from './config/env.ts';
import { COMPANIES } from './config/masterData.ts';
import type { Deps } from './deps.ts';
import { createInfluxClient } from './influx/client.ts';
import authPlugin from './plugins/auth.ts';
import staticSitePlugin from './plugins/staticSite.ts';
import globalOverviewRoutes from './routes/globalOverview.ts';
import scopeRoutes from './routes/scope.ts';
import healthRoutes from './routes/health.ts';
import metaRoutes from './routes/meta.ts';
import { createSnapshotPoller } from './services/liveSnapshot.ts';
import { createWindowStore } from './services/windowedSnapshot.ts';

/**
 * Returns an unbound Fastify instance (not listening on a port) so tests can
 * use `.inject()` without a live socket. Route modules register under the
 * /api/v1 prefix to match runtime-config.json's apiBaseUrl convention on the
 * frontend; only /healthz sits outside it.
 *
 * The snapshot poller is owned here, not by a module singleton: it is created
 * per app, handed to routes through `deps`, and stopped on close. Without
 * credentials it never starts a timer, which keeps `.inject()` tests hermetic
 * and offline.
 */
export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // One client for both readers: the poller's timer and the window store's
  // per-request fetches share its timeout and its identifier-quoting guard.
  const client = createInfluxClient(env);

  const poller = createSnapshotPoller({
    client,
    intervalMs: env.SNAPSHOT_INTERVAL_MS,
    oaIntervalMs: env.OA_REFRESH_MS,
    trendIntervalMs: env.TREND_REFRESH_MS,
    // Every plant in master data, not just the `live` companies': whether a
    // site has ever reported is exactly what we must not take from config.
    plantCodes: COMPANIES.flatMap((c) => c.plants.map((p) => p.code)),
    log: app.log,
  });
  const windows = createWindowStore({ client, ttlMs: env.WINDOW_CACHE_MS, log: app.log });
  const deps: Deps = { env, poller, windows };

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true, // the frontend's httpAdapter sends credentials: 'include'
  });

  await app.register(authPlugin);
  await app.register(healthRoutes);

  await app.register(metaRoutes, { prefix: '/api/v1', deps });
  await app.register(globalOverviewRoutes, { prefix: '/api/v1', deps });
  /* The two drill-downs the board links into. Same prefix, same deps - see
     routes/scope.ts for why they take fewer parameters than the board does. */
  await app.register(scopeRoutes, { prefix: '/api/v1', deps });

  /* Last, and only when configured: everything the API did not claim. The
     frontend's apiBaseUrl is a same-origin path, and this is what makes the
     origin one. Absent STATIC_DIR the server is API-only, which is what the
     `.inject()` tests below run against. */
  if (env.STATIC_DIR) {
    await app.register(staticSitePlugin, { root: env.STATIC_DIR });
  }

  app.addHook('onClose', async () => {
    poller.stop();
  });

  // Awaited: buildApp resolves with a snapshot already in hand, so the very
  // first request cannot see an empty one. Without credentials this is a no-op,
  // which keeps `.inject()` tests hermetic and offline.
  await poller.start();

  return app;
}
