/**
 * P3-E-5 — measure what each effect pass costs in real Chromium, per theme at quality 3 with the
 * soup running. Run on demand (`PASS_COSTS=1`); it records numbers, it does not gate. The
 * `declaredCost` of every pass in `src/render/effects/*` is derived from this output.
 * CPU time to issue Canvas2D commands, not GPU time — the headless raster is software, so the
 * absolute numbers are an upper bound on a machine with a GPU.
 */
import { test } from '@playwright/test';
import { THEME_IDS, activateTheme, openApp, startSoup } from './helpers';

test.describe.configure({ mode: 'default' });
test.skip(!process.env['PASS_COSTS'], 'on-demand measurement');

for (const theme of THEME_IDS) {
  test(`pass costs: ${theme}`, async ({ page }) => {
    await openApp(page);
    await activateTheme(page, theme);
    await page.evaluate(() => {
      window.__fancyGol?.setEffectsReducedMotion(false);
      window.__fancyGol?.setPassTimingSync(true); // each pass's own cost, not the queue it drains
      window.__fancyGol?.pinQuality(3);
    });
    await startSoup(page);
    await page.waitForTimeout(6_000);
    const stats = await page.evaluate(() => window.__fancyGol?.renderStats());
    console.log(`PASSCOST ${theme} ${JSON.stringify(stats?.passMs)} stages ${JSON.stringify(stats?.stageMs)}`);
  });
}
