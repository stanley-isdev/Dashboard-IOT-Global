import type { FastifyInstance } from 'fastify';
import { zMeta } from '@dashboard/contract';
import type { Deps } from '../deps.ts';
import { respondValidated } from '../lib/respondValidated.ts';
import { sourceHealthFrom } from '../lib/sourceHealth.ts';
import { buildMeta } from '../services/metaService.ts';

export default async function metaRoutes(fastify: FastifyInstance, opts: { deps: Deps }) {
  fastify.get('/meta', async () => {
    const sources = sourceHealthFrom(opts.deps.poller.current(), opts.deps.env);
    return respondValidated(zMeta, buildMeta(sources));
  });
}
