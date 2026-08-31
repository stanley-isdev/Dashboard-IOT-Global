import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

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
