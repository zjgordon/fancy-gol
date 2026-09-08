import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

test.describe('shell accessibility', () => {
  test('axe-core reports zero violations on the live chrome', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('#chrome-toolbar')).toBeVisible();
    await expect(page.locator('#chrome-transport')).toBeVisible();
    await expect(page.locator('#chrome-status')).toBeVisible();

    await page.addScriptTag({ path: AXE_PATH });

    const results = await page.evaluate(async () => {
      // axe is injected via addScriptTag above
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axe = (window as any).axe as {
        run: (
          context: Element,
          options: { rules: Record<string, { enabled: boolean }> },
        ) => Promise<{ violations: unknown[] }>;
      };
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
