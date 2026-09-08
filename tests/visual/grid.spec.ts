import { expect, test } from '@playwright/test';
import { frameGun, gotoVisual, hideChrome } from './helpers';

/** Three zoom levels: tile-adjacent, 100%, close-up. Vector path at 4+; 16 is Camera's default. */
const ZOOMS = [4, 16, 32] as const;
const SCHEMES = ['dark', 'light'] as const;

for (const scheme of SCHEMES) {
  test.describe(`Default ${scheme} grid`, () => {
    test.use({ colorScheme: scheme });

    for (const cellSize of ZOOMS) {
      test(`rendered grid at cellSize ${cellSize}`, async ({ page }) => {
        await gotoVisual(page);
        await frameGun(page, cellSize);
        await hideChrome(page);
        await expect(page.locator('#scene')).toHaveScreenshot(`grid-${scheme}-z${cellSize}.png`);
      });
    }
  });
}
