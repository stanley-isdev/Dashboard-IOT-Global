import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zGlobalOverview, zPlainDate, zProcess, zRange } from '@dashboard/contract';
import { assertOrCollect, checkGlobalOverview } from '@dashboard/domain-shared';
import type { Deps } from '../deps.ts';
import { respondValidated } from '../lib/respondValidated.ts';
import { buildGlobalOverview } from '../services/globalOverviewService.ts';
import { RETENTION_DAYS } from '../influx/queries.ts';
import { describeGaps, resolveWindow } from '../services/windowedSnapshot.ts';
import { toPlainDate } from '@dashboard/domain-shared';

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
  /**
   * The Zone picker: `all`, `none`, or a comma-separated list of zone tags.
   * Intersects with `plant` the way `plant` intersects with `region`, and is
   * matched on the machine rather than on a site row - zone is a tag on the
   * machine and nothing above it carries one. See zoneMatcher in the contract's
   * region.ts for why the tags are not qualified by plant.
   */
  zone: z.string().default('all'),
  /**
   * The calendar's two ends, as plain days in the reference zone.
   *
   * Optional and independent of `range`, which stays required: `range` is what
   * the capsule prints and what the board falls back to when a pair is
   * unusable. Both must be present for either to count - one end of a range is
   * not a range, and guessing the other from `range` would answer a question
   * the reader did not ask.
   */
  from: zPlainDate.optional(),
  to: zPlainDate.optional(),
  /**
   * How many rows the longest-active-stops panel asks for - the Top-N picker
   * beside its title (T-11). Bounded at 50 so a hand-typed query cannot make
   * `buildLongestActiveStops` sort and slice an unbounded list.
   */
  alertsLimit: z.coerce.number().int().positive().max(50).default(10),
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

    const { env, poller, windows } = opts.deps;

    /*
     * The window, resolved before anything is read.
     *
     * `earliestDate` is the retention floor - the oldest day the instance still
     * answers for - so a pick reaching past it is clamped here rather than
     * turning into a spread of empty chunks. It is derived from RETENTION_DAYS
     * rather than probed per request: probing would cost a query on every
     * request to move a boundary that moves once a day.
     */
    const resolved = resolveWindow({
      request: query.data,
      now: new Date(),
      timeZone: env.REFERENCE_TIMEZONE,
      earliestDate: toPlainDate(
        new Date(Date.now() - RETENTION_DAYS * 86_400_000),
        env.REFERENCE_TIMEZONE,
      ),
    });

    /*
     * The default window comes out of the poller, exactly as it always has -
     * one background read serving every screen. Only a window the poller does
     * not hold reaches InfluxDB, and only then.
     */
    let snapshot = poller.current();
    let windowError: string | null = null;
    if (!resolved.isDefault) {
      try {
        /*
         * The window supplies the numbers; the poller supplies `everSeen`.
         * That ledger is a statement about all of history, so it does not
         * belong to any one window - and without this overlay, picking a
         * calendar range would drop a never-connected site back to `no_data`
         * purely because a different query answered it.
         */
        snapshot = { ...(await windows.get(resolved.window)), everSeen: poller.current().everSeen };
      } catch (err) {
        /*
         * The picked window could not be read. Serving the poller's 24 h under
         * the reader's chosen dates would be the exact lie this endpoint is
         * written against, so the board gets an empty census, a degraded
         * envelope and a warning naming the window - not yesterday's numbers
         * wearing last week's label.
         */
        windowError = err instanceof Error ? err.message : String(err);
        request.log.error({ err: windowError, window: resolved.window }, 'windowed fetch failed');
        snapshot = {
          ...snapshot,
          plants: {},
          machines: {},
          unknownStatuses: [],
          oa: [],
          trend: [],
          ok: false,
          error: windowError,
          oaOk: false,
          oaError: windowError,
          trendOk: false,
          trendError: windowError,
          /* Not a window with holes in it - a window that could not be read at
             all. `error` above is the whole story, and leaving gaps set would
             have the envelope report both at once. */
          gaps: [],
        };
      }
    }

    /*
     * What the window actually cost, not what it was planned to cost: a chunk
     * the instance refuses is retried in narrower slices, so the plan the
     * picker showed can be an undercount. `chunks` is the reader's own cost and
     * is on the payload to be answerable - reporting the pre-retry number would
     * make the slowest windows the ones that look cheapest.
     */
    const served =
      snapshot.chunksQueried && snapshot.chunksQueried !== resolved.served.chunks
        ? { ...resolved.served, chunks: snapshot.chunksQueried }
        : resolved.served;

    const payload = buildGlobalOverview({
      snapshot,
      filters: query.data,
      window: served,
      env,
    });

    /* Said on the envelope, not swallowed: each of these is a case where what
       the reader asked for and what the board is showing them differ. */
    if (resolved.rejection) payload.meta.warnings.push(resolved.rejection);
    if (resolved.served.clamped) {
      payload.meta.warnings.push(
        `the picked window reaches further back than this InfluxDB instance holds; ` +
          `showing ${Math.round(resolved.served.hours)} h from ${resolved.served.from}`,
      );
    }
    if (windowError) {
      payload.meta.warnings.push(
        `could not read ${resolved.served.from} .. ${resolved.served.to} from InfluxDB (${windowError})`,
      );
    }
    const gapWarning = describeGaps(snapshot.gaps ?? []);
    if (gapWarning) payload.meta.warnings.push(gapWarning);

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
