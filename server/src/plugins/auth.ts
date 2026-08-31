import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export interface AuthUser {
  id: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/**
 * No-op placeholder for D-08 (auth) / D-09 (authorization scope), both still
 * open decisions. Every route already reads `request.user`, currently always
 * null - when AD/SSO lands, only this plugin's internals change.
 */
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('user', null);
  fastify.addHook('preHandler', async (request) => {
    request.user = null;
  });
});
