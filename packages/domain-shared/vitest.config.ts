import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The shift tests assert on wall-clock boundaries in Asia/Tokyo and
    // Asia/Bangkok. Pinning the process zone keeps them honest regardless of
    // where they run - mirrors the root vitest.config.ts's rationale exactly.
    env: { TZ: 'UTC' },
  },
});
