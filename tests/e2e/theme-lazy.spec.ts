/**
 * P3-E-7 — theme chunks load on demand (decision D4).
 *
 * The unit tests prove the registry and the loader. This proves the wiring in a real browser over a
 * real network: nothing theme-shaped is fetched at boot, a switch fetches exactly what that theme
 * needs, hovering a card starts the fetch early, and a failed fetch leaves the current theme on
 * screen with a message and can be retried.
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoApp, runCommand, waitForHarness } from './helpers';

const THEME_CHUNK = /\/assets\/theme-([a-z-]+)-[\w-]+\.js$/;

/** Names of theme chunks fetched so far, e.g. `chiba-city`, `effects`. */
function watchThemeChunks(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const match = THEME_CHUNK.exec(new URL(request.url()).pathname);
    if (match) seen.push(match[1]!);
  });
  return seen;
}

test.describe('lazy theme chunks (P3-E-7)', () => {
  test('boots on Default without fetching any theme chunk', async ({ page }) => {
    const chunks = watchThemeChunks(page);
    await gotoApp(page);
    expect(await page.evaluate(() => window.__fancyGol?.themeId)).toMatch(/^default/);
    expect(chunks).toEqual([]);
  });

  test('switching fetches that theme and the shared passes, and nothing else', async ({ page }) => {
    await gotoApp(page);
    const chunks = watchThemeChunks(page);
    await runCommand(page, 'theme.select.chiba-city');
    await page.waitForFunction(() => window.__fancyGol?.themeId === 'chiba-city');
    expect(new Set(chunks)).toEqual(new Set(['chiba-city', 'effects']));

    // A second theme reuses the shared passes: only its own small chunk is new.
    await runCommand(page, 'theme.select.flatline');
    await page.waitForFunction(() => window.__fancyGol?.themeId === 'flatline');
    expect(chunks.filter((c) => c === 'effects')).toHaveLength(1);
    expect(chunks).toContain('flatline');
    expect(chunks).not.toContain('synthwave');
  });

  test('hovering a theme card starts its fetch before any click', async ({ page }) => {
    await gotoApp(page);
    const chunks = watchThemeChunks(page);
    await page.getByRole('button', { name: 'Open themes' }).click();
    const card = page.locator('[data-theme-id="synthwave"]');
    await card.hover();
    await expect.poll(() => chunks.includes('synthwave'), { timeout: 10_000 }).toBe(true);
    // Fetching is not choosing: the active theme has not changed.
    expect(await page.evaluate(() => window.__fancyGol?.themeId)).toMatch(/^default/);
  });

  test('a failed load keeps the current theme and says so; a reload recovers', async ({ page }) => {
    await gotoApp(page);
    await page.route(/\/assets\/theme-void-walker-[\w-]+\.js$/, (route) => route.abort());

    await runCommand(page, 'theme.select.void-walker');
    const toast = page.locator('.toast', { hasText: "Couldn't load the Void-Walker theme" });
    await expect(toast.first()).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => window.__fancyGol?.themeId)).toMatch(/^default/);

    // The message says "reload", and it has to: a browser caches a failed dynamic import() of the
    // same URL for the page's lifetime, so retrying in place can never work.
    await expect(toast.first()).toContainText('Reload the page');
    await page.unroute(/\/assets\/theme-void-walker-[\w-]+\.js$/);
    await page.reload();
    await waitForHarness(page);
    await runCommand(page, 'theme.select.void-walker');
    await page.waitForFunction(() => window.__fancyGol?.themeId === 'void-walker', null, { timeout: 10_000 });
  });

  test('a saved non-Default theme is loaded before first paint, not painted over Default', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('gol.theme', 'sids-place');
      } catch {
        /* private mode — the test will fail visibly rather than pass vacuously */
      }
    });
    const chunks = watchThemeChunks(page);
    await gotoApp(page);
    expect(await page.evaluate(() => window.__fancyGol?.themeId)).toBe('sids-place');
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('sids-place');
    expect(chunks).toContain('sids-place');
  });

  test('a saved theme whose chunk cannot load falls back to Default with a message', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('gol.theme', 'synthwave');
      } catch {
        /* see above */
      }
    });
    await page.route(/\/assets\/theme-synthwave-[\w-]+\.js$/, (route) => route.abort());
    await gotoApp(page);
    expect(await page.evaluate(() => window.__fancyGol?.themeId)).toMatch(/^default/);
    await expect(page.locator('.toast', { hasText: "Couldn't load your saved theme" }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
