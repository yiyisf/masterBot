import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/server/test/**/*.integration.test.ts'],
    // Integration files share one production-like dispatch queue; serialize files to avoid stealing each other's Leases.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    conditions: ['development'],
  },
});
