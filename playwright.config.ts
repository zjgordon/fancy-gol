import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 8080);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Launch options shared by the two browser perf projects (P3-E-1).
 *  - `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points at a Chromium Playwright did not install itself, e.g.
 *    a sandbox that ships a different revision (SANDBOX-PLAYWRIGHT-INSTALL.md). Unset in CI.
 *  - `--enable-precise-memory-info` stops `performance.memory` being bucketed, which the
 *    allocation check reads. Without it a heap-span gate would measure the quantisation.
 */
const chromiumExecutable = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
  ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] }
  : {};
const perfLaunchOptions = {
  ...chromiumExecutable,
  args: ['--enable-precise-memory-info'],
};

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
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumExecutable },
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
      name: 'a11y',
      testMatch: 'a11y/**/*.spec.ts',
      timeout: 60_000,
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumExecutable },
    },
    {
      name: 'visual',
      testMatch: 'visual/**/*.spec.ts',
      timeout: 45_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        launchOptions: chromiumExecutable,
      },
    },
    {
      // P3-E-1 — the CI-floor tier of the two-tier theme frame gate (planning/README.md §3.6, D6).
      // Blocking: effect liveness, per-frame allocation and a same-runner ratio against Default.
      // Chromium only (usedJSHeapSize, CDP). Headless software raster is acceptable here because
      // every assertion is a relative one; the absolute ≥ 55 fps lives in `browser-bench`.
      name: 'browser-floor',
      testMatch: 'perf/themes-liveness.spec.ts',
      timeout: 120_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        launchOptions: perfLaunchOptions,
      },
    },
    {
      // P3-D-4 — per-theme frame rate in a real browser at 1080p. Chromium only (the 4× CPU
      // throttle is CDP), deliberately outside the blocking CI jobs: a headless runner is not the
      // "reference machine" the acceptance criterion names, so this accumulates in
      // docs/gate-history/ as `browser-bench` — the reference-certificate tier (§3.6, D6).
      name: 'browser-bench',
      testMatch: 'perf/themes-fps.spec.ts',
      timeout: 120_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        launchOptions: perfLaunchOptions,
      },
    },
  ],
});
