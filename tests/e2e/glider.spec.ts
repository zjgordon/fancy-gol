import { expect, test } from '@playwright/test';
import { clickWorld, confirmClear, getCell, gotoApp, viewportCenterCell, waitForCell } from './helpers';

/** Canonical glider (LifeWiki), painted at a chrome-clear origin then stepped 4 generations. */
const GLIDER: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

test.describe('draw a glider and verify it moves', () => {
  test('a hand-drawn glider translates by (1,1) after 4 steps', async ({ page }) => {
    await gotoApp(page);
    await confirmClear(page);
    await page.keyboard.press('b');

    const canvas = page.locator('#scene');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => (window.__fancyGol?.cellSize ?? 0) >= 8);

    const origin = await viewportCenterCell(page);

    for (const [dx, dy] of GLIDER) {
      await clickWorld(page, origin.x + dx, origin.y + dy);
      await waitForCell(page, origin.x + dx, origin.y + dy, 1);
    }

    expect(await getCell(page, origin.x, origin.y)).toBe(0);
    expect(await page.evaluate(() => window.__fancyGol?.population)).toBe(5);

    const tickBefore = await page.evaluate(() => window.__fancyGol?.tick ?? 0);
    for (let i = 0; i < 4; i++) {
      const tick = await page.evaluate(() => window.__fancyGol?.tick ?? 0);
      await page.getByRole('button', { name: 'Step', exact: true }).click();
      await page.waitForFunction((prev) => (window.__fancyGol?.tick ?? 0) > prev, tick);
    }

    expect(await page.evaluate(() => window.__fancyGol?.tick)).toBe(tickBefore + 4);
    expect(await page.evaluate(() => window.__fancyGol?.population)).toBe(5);
    for (const [dx, dy] of GLIDER) {
      expect(await getCell(page, origin.x + dx + 1, origin.y + dy + 1)).toBe(1);
    }
    // `[2, 1]` of the t=0 pattern is `[1, 0]` of the t=4 pattern — the one cell that stays
    // occupied across the translation. Every other t=0 cell must empty.
    const dest = new Set(GLIDER.map(([dx, dy]) => `${dx + 1},${dy + 1}`));
    for (const [dx, dy] of GLIDER) {
      if (!dest.has(`${dx},${dy}`)) {
        expect(await getCell(page, origin.x + dx, origin.y + dy)).toBe(0);
      }
    }
  });
});
