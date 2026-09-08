import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

interface AxeResults {
  readonly violations: readonly unknown[];
}

interface AxeWindow {
  axe: {
    run: (
      context: Element,
      options: { rules: Record<string, { enabled: boolean }> },
    ) => Promise<AxeResults>;
  };
}

test.describe('shell accessibility', () => {
  test('axe-core reports zero violations on the live chrome', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('#chrome-toolbar')).toBeVisible();
    await expect(page.locator('#chrome-transport')).toBeVisible();
    await expect(page.locator('#chrome-status')).toBeVisible();

    await page.addScriptTag({ path: AXE_PATH });

    const results = await page.evaluate(async () => {
      const { axe } = window as unknown as AxeWindow;
      const root = document.getElementById('chrome') ?? document.body;
      return axe.run(root, {
        // Canvas pixels are out of axe's reach; HUD colour-contrast is covered by the Default
        // theme token contract + visual baselines.
        rules: { 'color-contrast': { enabled: false } },
      });
    });

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
