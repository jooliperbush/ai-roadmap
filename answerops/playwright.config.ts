import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const pinned = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4399',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: existsSync(pinned) ? { executablePath: pinned } : {},
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node --import tsx scripts/e2e-server.mts',
    url: 'http://127.0.0.1:4399/healthz',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
