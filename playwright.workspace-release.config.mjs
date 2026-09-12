import { defineConfig, devices } from 'playwright/test';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the Workspace release Browser test');

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: 'workspace-release.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3114',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node tooling/workspace-release-provider.mjs',
      url: 'http://localhost:3112/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: [
        `DATABASE_URL=${databaseUrl}`,
        'CMASTER_SERVER_ROLE=all',
        'CMASTER_API_PORT=3113',
        'CMASTER_WEB_ORIGIN=http://localhost:3114',
        'CMASTER_RUNTIME_ENV=test',
        'NEXT_ARCHITECTURE_ENABLED=true',
        'CMASTER_DEVELOPMENT_IDENTITY_ENABLED=true',
        'CMASTER_AI_SDK_RUNTIME_ENABLED=true',
        'CMASTER_TOOL_RUNTIME_ENABLED=true',
        'CMASTER_CONTEXT_ARTIFACTS_ENABLED=true',
        'CMASTER_EMPLOYEE_WORKSPACE_ENABLED=true',
        'CMASTER_PRIMARY_MODEL_BASE_URL=http://localhost:3112/v1',
        'CMASTER_PRIMARY_MODEL_ID=release-model',
        'CMASTER_PRIMARY_MODEL_API_KEY=release-test-key',
        'CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS=65536',
        'CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS=4096',
        'CMASTER_FALLBACK_MODEL_BASE_URL=',
        'CMASTER_FALLBACK_MODEL_ID=',
        'CMASTER_FALLBACK_MODEL_API_KEY=',
        'CMASTER_WORKER_POLL_INTERVAL_MS=50',
        'CMASTER_WORKER_LEASE_TTL_MS=2000',
        'CMASTER_WORKER_CONCURRENCY=1',
        'CMASTER_ARTIFACT_STORAGE_ROOT=/tmp/cmaster-workspace-release-artifacts',
        'npm run next:server -- --role=all',
      ].join(' '),
      url: 'http://localhost:3113/health/ready',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'CMASTER_EMPLOYEE_WORKSPACE_ENABLED=true NEXT_PUBLIC_CMASTER_API_URL= CMASTER_API_ORIGIN=http://localhost:3113 npx next dev apps/web -p 3114',
      url: 'http://localhost:3114/workspace',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
