import { expect, test } from '@playwright/test';
import { clickWorld, confirmClear, gotoApp, runCommand, viewportCenterCell, waitForCell } from './helpers';

test.describe('undo, redo, and ruleset switch', () => {
  test('undo restores a painted cell and redo puts it back', async ({ page }) => {
    await gotoApp(page);
    await confirmClear(page);
    await page.keyboard.press('b');
    const cell = await viewportCenterCell(page);
    await clickWorld(page, cell.x, cell.y);
    await waitForCell(page, cell.x, cell.y, 1);

    await runCommand(page, 'edit.undo');
    await waitForCell(page, cell.x, cell.y, 0);
    expect(await page.evaluate(() => window.__fancyGol?.canRedo)).toBe(true);

    await runCommand(page, 'edit.redo');
    await waitForCell(page, cell.x, cell.y, 1);
  });

  test('the ruleset picker switches the live ruleset to HighLife', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.ruleset-toggle').click();
    await page.locator('#ruleset-option-highlife').click();
    await page.waitForFunction(() => window.__fancyGol?.rulesetId === 'highlife');
    expect(await page.evaluate(() => window.__fancyGol?.rulesetId)).toBe('highlife');
  });
});
