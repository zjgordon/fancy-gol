/**
 * P3-D-2 helpers — activate a theme and open panel-host tabs under `?test=1`
 * (frozen motion, seeded PRNG, paused sim).
 */
import type { Page } from '@playwright/test';
import { runCommand } from '../../e2e/helpers';
import { gotoVisual, waitForPaint } from '../helpers';

/** Registration ids a theme picker lists (adaptive Default resolves via colorScheme). */
export const THEME_IDS = [
  'default',
  'chiba-city',
  'flatline',
  'sids-place',
  'void-walker',
  'synthwave',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/**
 * Eight surfaces × six themes = 48 baselines (P3-D-2 AC).
 * Themes panel is the Phase 3 surface that brings the documented set to 48.
 */
export const THEME_SURFACES = [
  'shell',
  'library',
  'statistics',
  'themes',
  'dialog',
  'grid-z4',
  'grid-z16',
  'grid-z32',
] as const;

export type ThemeSurface = (typeof THEME_SURFACES)[number];

export function snapshotName(theme: ThemeId, surface: ThemeSurface): string {
  return `${theme}-${surface}.png`;
}

export async function gotoThemeVisual(page: Page, theme: ThemeId): Promise<void> {
  // Seed the theme before first paint so boot activates it — avoids a mid-session pass
  // hot-swap racing the first composite (and keeps screenshots deterministic).
  await page.addInitScript((id) => {
    try {
      localStorage.setItem('gol.theme', id);
      localStorage.removeItem('gol.session');
    } catch {
      // private-mode / denied storage
    }
  }, theme);
  await gotoVisual(page);
  const current = await page.evaluate(() => window.__fancyGol?.themeId);
  if (current !== theme) {
    await runCommand(page, `theme.select.${theme}`);
    await page.waitForFunction((id) => window.__fancyGol?.themeId === id, theme, {
      timeout: 10_000,
    });
  }
  await waitForPaint(page);
  await page.locator('#chrome-toolbar').hover();
  await waitForPaint(page);
}

export async function openPanelTab(page: Page, title: string): Promise<void> {
  const tab = page.getByRole('tab', { name: title });
  await tab.click();
  await expectPanelOpen(page, title);
  await waitForPaint(page);
}

async function expectPanelOpen(page: Page, title: string): Promise<void> {
  await page.waitForFunction((expected) => {
    const host = document.querySelector('.panel-host');
    if (!host || host.classList.contains('panel-host-collapsed')) return false;
    const titleEl = host.querySelector('.panel-host-title');
    return titleEl?.textContent === expected;
  }, title);
}

export function panelBody(page: Page) {
  return page.locator('.panel-host-panel');
}
