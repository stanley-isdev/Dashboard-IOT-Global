import type { FastifyInstance } from 'fastify';
import { zMeta } from '@dashboard/contract';
import type { Deps } from '../deps.ts';
import { respondValidated } from '../lib/respondValidated.ts';
import { sourceHealthFrom } from '../lib/sourceHealth.ts';
import { buildMeta } from '../services/metaService.ts';

export default async function metaRoutes(fastify: FastifyInstance, opts: { deps: Deps }) {
  fastify.get('/meta', async () => {
    // One read of the poller for both: the health block and the per-plant zone
    // lists have to describe the same instant, and two `current()` calls could
    // straddle a poll.
    const snapshot = opts.deps.poller.current();
    const sources = sourceHealthFrom(snapshot, opts.deps.env);
    return respondValidated(
      zMeta,
      buildMeta(sources, snapshot, opts.deps.env.REFERENCE_TIMEZONE),
    );
  });
}
