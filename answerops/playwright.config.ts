import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Real browser, real server, fresh database per run. Every user flow in the spec is driven
 * through the UI rather than through the API, because a flow that only works when a test
 * calls the service layer is not a flow a customer has.
 */

// The build container ships a pinned Chromium at a fixed path. Anywhere else — a developer
// machine, a different image — fall back to whichever browser Playwright installed itself,
// rather than failing every flow on a path that does not exist.
const PINNED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {};

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
    launchOptions,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // A fixed database filename made two suites run back to back share a file: the previous
    // server can still hold handles to data/e2e.sqlite while this one deletes and recreates it,
    // which showed up once as an unreproducible failure in flow 9. Each run now gets its own
    // file, and sweeps any left by a crashed run. `retries` stays at 0 — a flow that needs a
    // second attempt is a flow that is telling us something.
    command: 'rm -f data/e2e-*.sqlite data/e2e-*.sqlite-wal data/e2e-*.sqlite-shm && PORT=4399 MISCITED_DB=data/e2e-$$.sqlite MISCITED_NO_SCHEDULER=1 MISCITED_DEMO_FETCH=1 npx tsx src/main.ts',
    url: 'http://127.0.0.1:4399/healthz',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
