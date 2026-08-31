import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Cold-starting Fastify + cors + logger the first time a test process
    // loads them can exceed vitest's 5s default, especially before module
    // transforms are cached.
    //
    // Raised from 15s on 2026-08-25: three of these failed once when the suite
    // ran straight after a full `npm run verify` on a loaded machine, and did
    // not reproduce in five subsequent runs. Only the app-building tests are
    // slow enough for that to be plausible, and a timeout never masks a failed
    // assertion - that fails immediately whatever this is set to.
    testTimeout: 30_000,
  },
});
