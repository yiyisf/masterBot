import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/server/src/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    conditions: ['development'],
  },
});
