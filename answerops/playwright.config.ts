import { defineConfig, devices } from '@playwright/test';

/**
 * Real browser, real server, fresh database per run. Every user flow in the spec is driven
 * through the UI rather than through the API, because a flow that only works when a test
 * calls the service layer is not a flow a customer has.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4399',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'rm -f data/e2e.sqlite data/e2e.sqlite-wal data/e2e.sqlite-shm && PORT=4399 ANSWEROPS_DB=data/e2e.sqlite npx tsx src/main.ts',
    url: 'http://127.0.0.1:4399/healthz',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
