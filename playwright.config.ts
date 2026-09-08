import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 8080);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * P1-H-1 — Chromium + Firefox + WebKit against the production server (the same origin that
 * serves `/live` and `/api/sessions`). Determinism lives in the app (`?test=1`), not in
 * Playwright's clock: faking timers would stall the worker. Trace on the first retry so a
 * flake, if one ever appears, is a recording rather than a guess.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
  webServer: {
    command: process.env['E2E_SKIP_BUILD'] ? 'node dist/server/index.js' : 'npm run build && node dist/server/index.js',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    env: {
      ...process.env,
      PORT: String(PORT),
      ENABLE_LIVE: '1',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
