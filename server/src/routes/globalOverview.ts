import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zGlobalOverview, zProcess, zRange } from '@dashboard/contract';
import { assertOrCollect, checkGlobalOverview } from '@dashboard/domain-shared';
import type { Deps } from '../deps.ts';
import { respondValidated } from '../lib/respondValidated.ts';
import { buildGlobalOverview } from '../services/globalOverviewService.ts';

/**
 * Query defaults mirror what the frontend's httpAdapter always sends, so the
 * endpoint is also usable by hand (`curl .../global-overview`) during a spike.
 */
const zQuery = z.object({
  range: zRange.default('24h'),
  /**
   * Defaults to `all`, and `all` is currently the only value the backend can
   * honour - no query filters by `process` (config/policy.ts). It defaulted to
   * `Injection` until 2026-08-27, which meant every response advertised a scope
   * it did not apply: `filters_applied.process` read `Injection` while the
   * census counted THS's `Surface` machines too. A narrower value is still
   * accepted, and `buildGlobalOverview` says on the envelope that it was not
   * applied rather than quietly reporting it as though it had been.
   */
  process: z.union([zProcess, z.literal('all')]).default('all'),
  /**
   * `all`, or a comma-separated list of ISO country codes and company codes -
   * `TH,STJ` scopes the board to both Thai bases and the Japanese one. The
   * encoding and the matcher both sides use live in the contract's region.ts.
   */
  region: z.string().default('all'),
  /**
   * The Lamp picker: `all`, `none`, or a comma-separated list of plant codes.
   * Intersects with `region` rather than replacing it - see plantMatcher in the
   * contract's region.ts for why this is a separate filter and not a submenu.
   */
  plant: z.string().default('all'),
});

export default async function globalOverviewRoutes(
  fastify: FastifyInstance,
  opts: { deps: Deps },
) {
  fastify.get('/global-overview', async (request, reply) => {
    const query = zQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: 'invalid query parameters',
        detail: z.prettifyError(query.error),
      });
    }

    const payload = buildGlobalOverview({
      snapshot: opts.deps.poller.current(),
      filters: query.data,
      env: opts.deps.env,
    });

    // zod proves the shape; these prove it makes sense - that the census adds
    // up and an unconnected site contributes nothing to any denominator. The
    // design doc asks for a one-off reconciliation before go-live; running it
    // on every response is cheaper and does not decay.
    const violations = assertOrCollect(
      checkGlobalOverview(payload),
      'GET /global-overview',
      process.env.NODE_ENV !== 'production',
    );
    if (violations.length > 0) {
      request.log.error({ violations }, 'global-overview failed its integrity checks');
    }

    return respondValidated(zGlobalOverview, payload);
  });
}
