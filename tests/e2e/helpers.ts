import type { Page } from '@playwright/test';
import type { FancyGolHarness } from '../../src/client/harness';

export async function gotoApp(page: Page, path = '/'): Promise<void> {
  const withFlag = path.includes('test=') ? path : path.includes('?') ? `${path}&test=1` : `${path}?test=1`;
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('gol.session');
    } catch {
      // private-mode / denied storage — boot still works, it just starts fresh
    }
  });
  await page.goto(withFlag);
  await waitForHarness(page);
}

export async function waitForHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__fancyGol?.ready === true, null, { timeout: 20_000 });
}

export async function getCell(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(({ cx, cy }) => {
    const api = window.__fancyGol;
    if (!api) throw new Error('window.__fancyGol is missing');
    return api.getCell(cx, cy);
  }, { cx: x, cy: y });
}

/** World cell under the canvas centre — clear of the floating chrome that covers the origin. */
export async function viewportCenterCell(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const api = window.__fancyGol;
    if (!api) throw new Error('window.__fancyGol is missing');
    const world = api.screenToWorld(api.widthPx / 2, api.heightPx / 2);
    return { x: Math.round(world.x), y: Math.round(world.y) };
  });
}

/** Confirm the Clear dialog. The toolbar also has a button named Clear — scope to the dialog. */
export async function confirmClear(page: Page): Promise<void> {
  await page.keyboard.press('c');
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
  await page.waitForFunction(() => window.__fancyGol?.population === 0);
}

export async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const point = await page.evaluate(
    ({ wx, wy }) => {
      const api = window.__fancyGol;
      const canvas = document.querySelector('#scene');
      if (!api || !(canvas instanceof HTMLCanvasElement)) {
        throw new Error('canvas or harness missing');
      }
      const rect = canvas.getBoundingClientRect();
      // Brush/status-bar use `Math.round`. The geometric centre of cell `n` is `n + 0.5`,
      // which rounds *up* to `n + 1` — so aim inside the cell, not at the far edge.
      const screen = api.worldToScreen(wx + 0.25, wy + 0.25);
      return { x: rect.left + screen.px, y: rect.top + screen.py };
    },
    { wx: x, wy: y },
  );
  await page.mouse.click(point.x, point.y);
}

export async function waitForCell(page: Page, x: number, y: number, state: number): Promise<void> {
  await page.waitForFunction(
    ({ cx, cy, expected }) => window.__fancyGol?.getCell(cx, cy) === expected,
    { cx: x, cy: y, expected: state },
    { timeout: 10_000 },
  );
}

export async function lastCommands(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__fancyGol?.lastCommands ?? [])]);
}

export async function dismissDialog(page: Page): Promise<void> {
  const overlay = page.locator('.dialog-overlay');
  if ((await overlay.count()) > 0) {
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
  }
}

declare global {
  interface Window {
    __fancyGol?: FancyGolHarness;
  }
}
