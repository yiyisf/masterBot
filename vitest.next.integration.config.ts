import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/server/src/**/*.integration.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    conditions: ['development'],
  },
});
