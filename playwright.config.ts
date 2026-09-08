import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 8080);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * P1-H-1 / P1-H-2 — Chromium + Firefox + WebKit against the production server. Visual
 * baselines (P1-H-2) run on Chromium only: Firefox/WebKit antialiasing would fork the
 * snapshot set without adding a Phase 1 claim. Determinism lives in the app (`?test=1`),
 * not in Playwright's clock. Trace on the first retry. Screenshot tolerance is the phase
 * doc's ≤ 0.1% pixels (`maxDiffPixelRatio: 0.001`).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
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
    {
      name: 'chromium',
      testMatch: 'e2e/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: 'e2e/**/*.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: 'e2e/**/*.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'visual',
      testMatch: 'visual/**/*.spec.ts',
      timeout: 45_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
