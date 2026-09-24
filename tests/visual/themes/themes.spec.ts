/**
 * P3-D-2 — per-theme visual regression.
 *
 * Six themes × {shell, library, statistics, themes, dialog, grid at 3 zooms}
 * = 48 baselines. Animations frozen via `?test=1`; fps/ms masked.
 *
 * Gate-history (`visual-nonflake ≥ 3` on official/main) is still unmet by
 * construction until Phase 3 merges and nightlies accumulate — see the interim
 * note on the phase-doc criterion.
 */
import { expect, test } from '@playwright/test';
import { frameGun, hideChrome, volatileMask, waitForPaint } from '../helpers';
import {
  THEME_IDS,
  gotoThemeVisual,
  openPanelTab,
  panelBody,
  snapshotName,
  type ThemeId,
} from './helpers';

test.describe.configure({ mode: 'serial' });

for (const theme of THEME_IDS) {
  test.describe(`theme ${theme}`, () => {
    // Adaptive Default follows prefers-color-scheme; pin dark so the registration
    // id `default` resolves to the dark variant every run.
    test.use({ colorScheme: 'dark' });

    test('shell', async ({ page }) => {
      await gotoThemeVisual(page, theme);
      await expect(page).toHaveScreenshot(snapshotName(theme, 'shell'), {
        mask: volatileMask(page),
      });
    });

    test('library panel', async ({ page }) => {
      await gotoThemeVisual(page, theme);
      await openPanelTab(page, 'Library');
      // Bundled catalogue may still be loading — wait for at least the empty/offline chrome.
      await page.locator('.lib-panel, .lib-offline').first().waitFor();
      await waitForPaint(page);
      await expect(panelBody(page)).toHaveScreenshot(snapshotName(theme, 'library'), {
        mask: volatileMask(page),
      });
    });

    test('statistics panel', async ({ page }) => {
      await gotoThemeVisual(page, theme);
      await openPanelTab(page, 'Statistics');
      await page.locator('.stats-panel').waitFor();
      await waitForPaint(page);
      await expect(panelBody(page)).toHaveScreenshot(snapshotName(theme, 'statistics'), {
        mask: volatileMask(page),
      });
    });

    test('themes panel', async ({ page }) => {
      await gotoThemeVisual(page, theme);
      await openPanelTab(page, 'Themes');
      await page.locator('.themes-panel').waitFor();
      // Preview canvases animate; mask them so only chrome/layout is gated.
      const previewMask = page.locator('.themes-preview');
      await waitForPaint(page);
      await expect(panelBody(page)).toHaveScreenshot(snapshotName(theme, 'themes'), {
        mask: [...volatileMask(page), previewMask],
      });
    });

    test('dialog', async ({ page }) => {
      await gotoThemeVisual(page, theme);
      await page.keyboard.press('c');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveScreenshot(snapshotName(theme, 'dialog'));
    });

    for (const cellSize of [4, 16, 32] as const) {
      const surface = `grid-z${cellSize}` as const;
      test(`grid at cellSize ${cellSize}`, async ({ page }) => {
        await gotoThemeVisual(page, theme);
        await frameGun(page, cellSize);
        await hideChrome(page);
        await expect(page.locator('#scene')).toHaveScreenshot(snapshotName(theme, surface));
      });
    }
  });
}

test.describe('theme baseline isolation', () => {
  test.use({ colorScheme: 'dark' });

  test('a deliberate token change fails only that theme’s shell baseline', async ({ page }) => {
    const theme: ThemeId = 'chiba-city';
    await gotoThemeVisual(page, theme);
    const before = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: volatileMask(page),
    });

    await page.addStyleTag({
      content: 'html[data-theme="chiba-city"] { --gol-color-accent: #ff00ff !important; }',
    });
    await waitForPaint(page);
    const after = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: volatileMask(page),
    });
    expect(after.equals(before), 'accent token change must alter the chiba-city shell shot').toBe(
      false,
    );

    // A different theme’s tokens are untouched — switching away restores the old accent path.
    await gotoThemeVisual(page, 'flatline');
    const flatline = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: volatileMask(page),
    });
    await page.addStyleTag({
      content: 'html[data-theme="chiba-city"] { --gol-color-accent: #ff00ff !important; }',
    });
    await waitForPaint(page);
    const flatlineAgain = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: volatileMask(page),
    });
    expect(
      flatlineAgain.equals(flatline),
      'chiba-city token override must not change the flatline shell',
    ).toBe(true);
  });
});
