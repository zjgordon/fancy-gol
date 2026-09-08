import { expect, test } from '@playwright/test';
import { clickWorld, confirmClear, gotoApp, runCommand, viewportCenterCell, waitForCell, waitForHarness } from './helpers';

test.describe('theme persistence and share-link round trip', () => {
  test('theme id survives a reload', async ({ page }) => {
    await gotoApp(page);
    const themeId = await page.evaluate(() => window.__fancyGol?.themeId);
    expect(themeId).toBe('default');

    const stored = await page.evaluate(() => localStorage.getItem('gol.theme'));
    expect(stored).toBe('default');

    await page.reload();
    await waitForHarness(page);
    expect(await page.evaluate(() => window.__fancyGol?.themeId)).toBe('default');
    expect(await page.evaluate(() => localStorage.getItem('gol.theme'))).toBe('default');
  });

  test('a share link restores the painted grid on a fresh page', async ({ page, context }) => {
    await gotoApp(page);
    await confirmClear(page);
    await page.keyboard.press('b');
    const cell = await viewportCenterCell(page);
    await clickWorld(page, cell.x, cell.y);
    await waitForCell(page, cell.x, cell.y, 1);

    // Avoid ControlOrMeta+S — WebKit/CI treat it as the browser "Save Page" chord.
    await runCommand(page, 'session.save');
    await page.waitForFunction(() => Boolean(window.__fancyGol?.lastShareUrl), null, { timeout: 15_000 });
    const url = await page.evaluate(() => window.__fancyGol?.lastShareUrl);
    expect(url).toBeTruthy();
    expect(url!).toMatch(/#d:|#s:/);

    const parsed = new URL(url!);
    const next = await context.newPage();
    await next.goto(`${parsed.pathname}?test=1${parsed.hash}`);
    await waitForHarness(next);
    await waitForCell(next, cell.x, cell.y, 1);
    await next.close();
  });
});
