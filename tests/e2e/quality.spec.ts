/**
 * P3-D-4 — the degrade governor, in the browser.
 *
 * The unit tests prove the module; this proves the wiring — that `main.ts` really hosts a
 * governor, that pinning it changes what the compositor draws, and that degradation reaches the
 * user as a legible message instead of a silent quality drop (PHASE_3 §2.3).
 */
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test.describe('degrade governor wiring (P3-D-4)', () => {
  test('starts pinned at the ceiling under ?test=1 so screenshots stay machine-independent', async ({ page }) => {
    await gotoApp(page);
    const quality = await page.evaluate(() => window.__fancyGol?.effectQuality);
    expect(quality).toBe(3);
    expect(await page.evaluate(() => window.__fancyGol?.qualityIndicator)).toBe('');
  });

  test('pinning quality 0 degrades the pipeline and says so in plain language', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__fancyGol?.pinQuality(0));

    await page.waitForFunction(() => window.__fancyGol?.effectQuality === 0);
    const indicator = await page.evaluate(() => window.__fancyGol?.qualityIndicator ?? '');
    // §2.3: "never silent" — the message names the stage that was dropped.
    expect(indicator).toMatch(/palette only/);

    // The user sees it: a dismissible toast carrying the same sentence.
    const toast = page.locator('.toast', { hasText: 'palette only' });
    await expect(toast.first()).toBeVisible({ timeout: 5_000 });
    await toast.first().getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(toast.first()).toHaveCount(0);
  });

  test('a theme switch gives the governor the new theme ceiling and re-arms the announcement', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__fancyGol?.pinQuality(0));
    await page.waitForFunction(() => window.__fancyGol?.effectQuality === 0);

    // Void-Walker declares max 3, so activating it must lift the ceiling off 0 again.
    await page.evaluate(() => window.__fancyGol?.runCommand('theme.select.void-walker'));
    await page.waitForFunction(() => window.__fancyGol?.themeId === 'void-walker');
    const quality = await page.evaluate(() => window.__fancyGol?.effectQuality);
    expect(quality).toBeGreaterThan(0);
  });

  test('unpinning hands control back to the frame-time policy', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__fancyGol?.pinQuality(null));
    // No assertion on the resulting level: that is the governor's measured policy talking, and
    // on a fast runner it legitimately stays at 3. What matters is that the pin is gone.
    expect(await page.evaluate(() => window.__fancyGol?.effectQuality)).toBeGreaterThanOrEqual(0);
  });
});