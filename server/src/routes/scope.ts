import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zCompanyDetail, zPlantDetail, zProcess, zRange } from '@dashboard/contract';
import type { Deps } from '../deps.ts';
import { respondValidated } from '../lib/respondValidated.ts';
import { buildCompanyDetail, buildPlantDetail } from '../services/scopeService.ts';
import { RETENTION_DAYS } from '../influx/queries.ts';
import { describeGaps, resolveWindow } from '../services/windowedSnapshot.ts';
import type { WindowGap } from '../services/liveSnapshot.ts';
import { toPlainDate } from '@dashboard/domain-shared';

/**
 * The two drill-downs the board links into.
 *
 * They existed in the contract and in the frontend adapter from the start, and
 * until now only the mock adapter answered them - so the two pages worked in a
 * demo build and 404'd against a real server. That is the gap this closes.
 *
 * ## Deliberately fewer parameters than the board
 *
 * `ScopeQuery` and `PlantQuery` in the frontend's DashboardApi carry `range`,
 * `process` and (for a plant) `shift`, and nothing else. Region, Lamp and Zone
 * are the global board's controls: a drill-down has already been narrowed to
 * one company or one plant by its own path, and re-applying the row above it
 * would let a reader open THS and be shown nothing because a filter left over
 * from the map excluded it. The schema below is therefore the whole contract -
 * an unknown parameter is ignored rather than honoured.
 *
 * The absolute window is absent for the same reason it is absent from those two
 * interfaces: the calendar is a global-board control, and `range` is what these
 * pages send. They still resolve a window through `resolveWindow`, so a quick
 * range longer than the poller's own read reaches InfluxDB exactly as the board
 * does rather than quietly serving 24 h under a 7-day label.
 */

const zScopeQuery = z.object({
  range: zRange.default('24h'),
  process: z.union([zProcess, z.literal('all')]).default('all'),
});

const zPlantQuery = zScopeQuery.extend({
  /**
   * `current` or an explicit shift code.
   *
   * Accepted and echoed on `filters_applied`, and only `current` changes
   * anything today: the shift breakdown and the hourly output are both built
   * from the shift in force. An explicit code is not rejected - the frontend
   * sends `current` and a future picker will send others - but it is reported
   * back rather than silently applied, which is the same rule the board follows
   * for a `process` it cannot honour.
   */
  shift: z.string().default('current'),
});

/** One place for the window resolution both handlers do identically. */
function resolveFor(range: string, timeZone: string) {
  return resolveWindow({
    request: { range: range as never, from: undefined, to: undefined },
    now: new Date(),
    timeZone,
    earliestDate: toPlainDate(new Date(Date.now() - RETENTION_DAYS * 86_400_000), timeZone),
  });
}

export default async function scopeRoutes(fastify: FastifyInstance, opts: { deps: Deps }) {
  const { env, poller, windows } = opts.deps;

  /**
   * Reads the window the request asks for, falling back to the poller's.
   *
   * Identical in shape to the board's, and identical for the same reason: the
   * default window comes out of one background read serving every screen, and
   * only a window the poller does not hold reaches InfluxDB. A failed windowed
   * read empties the census rather than serving the poller's 24 h under the
   * reader's chosen dates - see the same branch in globalOverview.ts.
   */
  async function snapshotFor(range: string, log: FastifyInstance['log']) {
    const resolved = resolveFor(range, env.REFERENCE_TIMEZONE);
    let snapshot = poller.current();
    let windowError: string | null = null;

    if (!resolved.isDefault) {
      try {
        snapshot = await windows.get(resolved.window);
      } catch (err) {
        windowError = err instanceof Error ? err.message : String(err);
        log.error({ err: windowError, window: resolved.window }, 'windowed fetch failed');
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
          /* A window that could not be read at all, not one with holes in it -
             see the same branch in globalOverview.ts. */
          gaps: [],
        };
      }
    }

    /* What the window cost, not what it was planned to cost: a chunk the
       instance refuses is retried in narrower slices. Same reasoning as the
       board's - see globalOverview.ts. */
    const served =
      snapshot.chunksQueried && snapshot.chunksQueried !== resolved.served.chunks
        ? { ...resolved.served, chunks: snapshot.chunksQueried }
        : resolved.served;

    return { snapshot, resolved, served, windowError };
  }

  /** The warnings both payloads carry when what was asked for was not served. */
  function annotate(
    warnings: string[],
    resolved: ReturnType<typeof resolveFor>,
    windowError: string | null,
    gaps: readonly WindowGap[],
  ) {
    if (resolved.rejection) warnings.push(resolved.rejection);
    if (resolved.served.clamped) {
      warnings.push(
        `the picked window reaches further back than this InfluxDB instance holds; ` +
          `showing ${Math.round(resolved.served.hours)} h from ${resolved.served.from}`,
      );
    }
    if (windowError) {
      warnings.push(
        `could not read ${resolved.served.from} .. ${resolved.served.to} from InfluxDB (${windowError})`,
      );
    }
    const gapWarning = describeGaps(gaps);
    if (gapWarning) warnings.push(gapWarning);
  }

  fastify.get('/companies/:company', async (request, reply) => {
    const params = z.object({ company: z.string().min(1) }).safeParse(request.params);
    const query = zScopeQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({
        error: 'invalid request',
        detail: z.prettifyError((params.success ? query : params).error as z.ZodError),
      });
    }

    const { snapshot, resolved, served, windowError } = await snapshotFor(
      query.data.range,
      request.log,
    );

    const payload = buildCompanyDetail({
      company: params.data.company,
      snapshot,
      filters: query.data,
      window: served,
      env,
    });

    /* A code master data has never heard of. 404 rather than an empty company:
       "this base has no machines reporting" and "this base does not exist" are
       different answers and the UI draws different screens for them. */
    if (!payload) {
      return reply.status(404).send({ error: 'no such company', detail: params.data.company });
    }

    annotate(payload.meta.warnings, resolved, windowError, snapshot.gaps ?? []);
    return respondValidated(zCompanyDetail, payload);
  });

  fastify.get('/companies/:company/plants/:plant', async (request, reply) => {
    const params = z
      .object({ company: z.string().min(1), plant: z.string().min(1) })
      .safeParse(request.params);
    const query = zPlantQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({
        error: 'invalid request',
        detail: z.prettifyError((params.success ? query : params).error as z.ZodError),
      });
    }

    const { snapshot, resolved, served, windowError } = await snapshotFor(
      query.data.range,
      request.log,
    );

    const payload = buildPlantDetail({
      company: params.data.company,
      plant: params.data.plant,
      shift: query.data.shift,
      snapshot,
      filters: query.data,
      window: served,
      env,
    });

    if (!payload) {
      return reply.status(404).send({
        error: 'no such plant',
        detail: `${params.data.company}/${params.data.plant}`,
      });
    }

    annotate(payload.meta.warnings, resolved, windowError, snapshot.gaps ?? []);
    return respondValidated(zPlantDetail, payload);
  });
}
