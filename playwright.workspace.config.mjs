import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3111',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'CMASTER_EMPLOYEE_WORKSPACE_ENABLED=true npx next dev apps/web -p 3111',
    url: 'http://localhost:3111/workspace',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
