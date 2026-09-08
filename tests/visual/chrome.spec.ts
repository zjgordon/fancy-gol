import { expect, test } from '@playwright/test';
import { gotoVisual, volatileMask } from './helpers';

const SCHEMES = ['dark', 'light'] as const;

for (const scheme of SCHEMES) {
  test.describe(`Default ${scheme} chrome`, () => {
    test.use({ colorScheme: scheme });

    test('shell', async ({ page }) => {
      await gotoVisual(page);
      await expect(page).toHaveScreenshot(`shell-${scheme}.png`, { mask: volatileMask(page) });
    });

    test('toolbar', async ({ page }) => {
      await gotoVisual(page);
      await expect(page.locator('#chrome-toolbar')).toHaveScreenshot(`toolbar-${scheme}.png`);
    });

    test('transport', async ({ page }) => {
      await gotoVisual(page);
      await expect(page.locator('#chrome-transport')).toHaveScreenshot(`transport-${scheme}.png`, {
        mask: volatileMask(page),
      });
    });

    test('status bar', async ({ page }) => {
      await gotoVisual(page);
      await expect(page.locator('#chrome-status')).toHaveScreenshot(`status-${scheme}.png`, {
        mask: volatileMask(page),
      });
    });

    test('dialog', async ({ page }) => {
      await gotoVisual(page);
      await page.keyboard.press('c');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveScreenshot(`dialog-${scheme}.png`);
    });
  });
}
