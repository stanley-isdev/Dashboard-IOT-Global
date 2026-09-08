import { relative, resolve, sep } from 'node:path';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export interface StaticSiteOptions {
  /** Absolute path to the built frontend - the `dist/` that `npm run build` writes. */
  root: string;
}

/**
 * Serves the built SPA from this same process, on this same port.
 *
 * The frontend ships `apiBaseUrl: "/api/v1"` (public/config/runtime-config.json),
 * so the browser only ever calls its own origin. Something has to make the page
 * and the API share one. A reverse proxy is the other way to do it; this is the
 * way that needs no second system to install, configure and keep in step, and
 * it is what the Grafana on the same host already does - one process serving
 * its own UI and its own API on its own port.
 *
 * Registered only when STATIC_DIR is set. Absent - which is every test in this
 * suite - the server is API-only and behaves exactly as it did before this
 * plugin existed. That is deliberate: it keeps `.inject()` tests hermetic
 * against a `dist/` that may or may not have been built.
 */
export default fp(async function staticSitePlugin(
  app: FastifyInstance,
  opts: StaticSiteOptions,
) {
  /* Resolved once: setHeaders runs per file served and must not re-resolve. */
  const root = resolve(opts.root);

  await app.register(fastifyStatic, {
    root,
    index: 'index.html',
    /*
     * `send` writes one Cache-Control for every file it serves. This build
     * needs three different ones (see cacheControlFor), so its writer is turned
     * off and setHeaders below becomes the only one.
     */
    cacheControl: false,
    setHeaders(reply, filePath) {
      reply.header('cache-control', cacheControlFor(relativeUrlPath(root, filePath)));
    },
  });

  /**
   * Client-side routing, and the two things it must not swallow.
   *
   * @fastify/static's wildcard route is what brings a miss here: Fastify's
   * router gives the explicitly registered /api/v1/... routes priority over it,
   * so a real endpoint never reaches this handler, but an unknown path under
   * /api does.
   */
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];

    /*
     * An unknown API path stays JSON. Answering it with the dashboard's own
     * HTML would hand httpAdapter a document to run through JSON.parse, and the
     * syntax error it raised would name the parser rather than the typo.
     */
    const isApi = pathname.startsWith('/api/');

    /*
     * A miss that names a file is a miss. Returning the shell for
     * /assets/index-<hash>.js - the shape of a deploy where index.html and the
     * bundle it names went out of step - gets the browser "Unexpected token '<'"
     * instead of a 404, which points at the bundle rather than at the deploy.
     */
    const namesAFile = (pathname.split('/').pop() ?? '').includes('.');

    const isNavigation = !isApi && !namesAFile && (request.method === 'GET' || request.method === 'HEAD');

    if (!isNavigation) {
      /* Fastify's own 404 shape, so nothing downstream sees a new one. */
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
      });
    }

    return reply.sendFile('index.html');
  });
});

/** The served file's path relative to the root, with forward slashes on Windows too. */
function relativeUrlPath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

/**
 * Three tiers, and the first one is the one that matters.
 *
 * runtime-config.json is edited in place on the server - it is how a site
 * points the board at its own Grafana - and index.html names the current hashed
 * bundles. Cache either and the edit or the deploy silently does not land: the
 * kiosk keeps rendering the old one and there is nothing to see in a log.
 *
 * Everything under assets/ carries a content hash in its filename, so a changed
 * file is a changed URL and a year is safe. The rest (favicons, the brand
 * marks, the Natural Earth geometry) is unhashed but changes about never, so it
 * gets an hour: long enough to stay off the wire on a wall of screens, short
 * enough that replacing a logo does not need a cache-clearing errand.
 */
function cacheControlFor(rel: string): string {
  if (rel === 'index.html' || rel === 'config/runtime-config.json') return 'no-cache';
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}
