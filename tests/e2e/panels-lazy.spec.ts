/**
 * P3-E-10 — the heavy panels load on first open.
 *
 * Statistics (with its charts), Library and Ruleset Studio are a large share of the entry chunk and
 * a session may never open one. The unit tests prove the lazy-panel mechanism; this proves the
 * wiring in a real browser over a real network: nothing is fetched at boot, opening a panel fetches
 * exactly its chunk, the panel arrives with the app's *current* state, and a failed fetch leaves a
 * message in the body instead of an empty panel.
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from './helpers';

const PANEL_CHUNK = /\/assets\/panel-([a-z-]+)-[\w-]+\.js$/;
const BENCH_WORKER = /\/assets\/bench\.worker-[\w-]+\.js$/;

/** Names of panel chunks fetched so far (`library`, `ruleset-studio`, `statistics`, `statistics-charts`). */
function watchChunks(page: Page): { panels: string[]; benchWorker: () => boolean } {
  const panels: string[] = [];
  let bench = false;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    const match = PANEL_CHUNK.exec(path);
    if (match) panels.push(match[1]!);
    if (BENCH_WORKER.test(path)) bench = true;
  });
  return { panels, benchWorker: () => bench };
}

async function openTab(page: Page, title: string): Promise<void> {
  await page.getByRole('tab', { name: title }).click();
}

test.describe('lazy panels (P3-E-10)', () => {
  test('boots without fetching any panel chunk or the bench worker', async ({ page }) => {
    const seen = watchChunks(page);
    await gotoApp(page);
    // Let anything that was going to be prefetched happen.
    await page.waitForTimeout(500);
    expect(seen.panels).toEqual([]);
    expect(seen.benchWorker()).toBe(false);
  });

  test('opening Library fetches its chunk, and the real panel replaces the placeholder', async ({ page }) => {
    await gotoApp(page);
    const seen = watchChunks(page);
    await openTab(page, 'Library');
    await expect.poll(() => seen.panels.includes('library'), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('.panel-lazy-message')).toHaveCount(0);
    await expect(page.locator('.panel-host-body').first()).not.toBeEmpty();
    // Only Library's chunk: the other two panels are untouched.
    expect(seen.panels).not.toContain('ruleset-studio');
    expect(seen.panels).not.toContain('statistics');
  });

  test('opening Ruleset Studio shows the current ruleset, not an empty editor', async ({ page }) => {
    await gotoApp(page);
    const seen = watchChunks(page);
    await openTab(page, 'Ruleset Studio');
    await expect.poll(() => seen.panels.includes('ruleset-studio'), { timeout: 10_000 }).toBe(true);
    const rulesetId = await page.evaluate(() => window.__fancyGol?.rulesetId);
    const editor = page.locator('.panel-host-body textarea').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(editor).toHaveValue(new RegExp(`"id":\\s*"${rulesetId}"`));
  });

  test('opening Statistics fetches the panel and its charts, and live numbers arrive', async ({ page }) => {
    await gotoApp(page);
    const seen = watchChunks(page);
    await openTab(page, 'Statistics');
    await expect.poll(() => seen.panels.includes('statistics') && seen.panels.includes('statistics-charts'), {
      timeout: 10_000,
    }).toBe(true);
    await expect(page.locator('.panel-lazy-message')).toHaveCount(0);
    await expect(page.locator('.stats-hero').first()).toBeVisible();
  });

  test('hovering the Library button starts the fetch before any click', async ({ page }) => {
    await gotoApp(page);
    const seen = watchChunks(page);
    await page.getByRole('button', { name: 'Open pattern library' }).hover();
    await expect.poll(() => seen.panels.includes('library'), { timeout: 10_000 }).toBe(true);
    // Fetching is not opening: no panel is on screen yet.
    await expect(page.locator('.panel-host-body').first()).toBeEmpty();
  });

  test('a failed load leaves a message in the panel, and the panel can still be closed', async ({ page }) => {
    await gotoApp(page);
    await page.route(/\/assets\/panel-library-[\w-]+\.js$/, (route) => route.abort());
    await openTab(page, 'Library');
    const alert = page.locator('.panel-lazy-message[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText('Reload the page');
    // Not an empty panel, and not a trap: another tab still opens.
    await openTab(page, 'Themes');
    await expect(page.locator('.panel-lazy-message[role="alert"]')).toHaveCount(0);
  });
});
