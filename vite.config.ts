import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Cuts the one CDN URL jsPDF carries out of the bundle.
 *
 * jsPDF's `output('pdfobjectnewwindow')` opens a preview window and loads
 * PDFObject from cdnjs to draw it. Nothing here calls that - the PDF export
 * uses `addImage` and `save`, which never touch it - so the URL ships as a dead
 * string in a branch that cannot be reached.
 *
 * Dead or not, it fails `npm run check:offline`, and it should: that check is a
 * plain scan of dist/ for public CDN hosts, and its whole value is that it does
 * not take anybody's word for whether a reference is reachable. Adding an
 * exception for this one would mean the next person to vendor a library gets to
 * argue their CDN reference is dead too.
 *
 * So the string goes instead of the check. Replaced rather than blanked, so
 * that if the unreachable branch ever does run it fails at a URL that obviously
 * was not meant to resolve, rather than at an empty string that reads like a
 * bug in jsPDF. See scripts/check-offline.mjs, which is where T-12 - no public
 * CDN on a plant network - is actually enforced.
 *
 * Sourcemaps are rewritten too, and not as an afterthought: this build ships
 * them (see `build.sourcemap` below), a `.map` carries the original source
 * verbatim in `sourcesContent`, and check-offline scans them for exactly that
 * reason. Doing both here in `generateBundle` rather than in `renderChunk`
 * keeps it one pass over what is actually about to be written.
 */
function stripJsPdfCdn(): Plugin {
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js';
  const SAFE = 'about:blank#pdfobject-not-vendored';
  return {
    name: 'strip-jspdf-cdn',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          if (file.code.includes(CDN)) file.code = file.code.replaceAll(CDN, SAFE);
          /* The map rollup hands back as an object, before it is serialised. */
          if (file.map?.sourcesContent) {
            file.map.sourcesContent = file.map.sourcesContent.map((s) =>
              s === null ? s : s.replaceAll(CDN, SAFE),
            );
          }
        } else if (typeof file.source === 'string' && file.source.includes(CDN)) {
          file.source = file.source.replaceAll(CDN, SAFE);
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stripJsPdfCdn()],

  /**
   * Set VITE_BASE_PATH when the app is served from a subpath, e.g.
   *   VITE_BASE_PATH=/dashboard/ npm run build
   * The same value feeds <BrowserRouter basename> via import.meta.env.BASE_URL,
   * so a subpath deploy is one variable rather than two places to keep in sync.
   */
  base: process.env.VITE_BASE_PATH ?? '/',

  server: {
    proxy: {
      /**
       * Keeps runtime-config.json's `apiBaseUrl` at `/api/v1` in dev as well as
       * production, so the committed file stays deploy-correct and nobody has
       * to remember to change it back before shipping. It also means the dev
       * server exercises the same same-origin path production uses.
       *
       * `127.0.0.1`, not `localhost`: on Windows `localhost` resolves to `::1`
       * first, while Fastify's `0.0.0.0` bind is IPv4-only. The mismatch shows
       * up as a connection refused that reads exactly like a dead backend.
       */
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Kept on deliberately. A small IS team debugging a production incident on
    // a wall-mounted TV needs a readable stack trace far more than it needs to
    // hide the source of a dashboard that is already internal-only.
    sourcemap: true,
  },

  define: {
    // Compared against runtime-config.json's buildId so a kiosk left running
    // for weeks notices a deploy and reloads itself.
    __BUILD_ID__: JSON.stringify(process.env.VITE_BUILD_ID ?? 'dev'),
  },
});
