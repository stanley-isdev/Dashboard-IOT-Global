import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The shift and bucket tests assert on wall-clock boundaries in Asia/Tokyo
    // and Asia/Bangkok. Pinning the process zone keeps them honest whether they
    // run on a Thai workstation or a UTC build agent.
    env: { TZ: 'UTC' },
  },
});
