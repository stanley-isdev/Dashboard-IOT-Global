import type { FastifyInstance } from 'fastify';

/**
 * Liveness probe - unprefixed (not under /api/v1), for load balancers /
 * container orchestrators. Not part of the DashboardApi contract.
 */
export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/healthz', async () => ({
    status: 'ok',
    now: new Date().toISOString(),
  }));
}
