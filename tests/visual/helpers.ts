import type { Locator, Page } from '@playwright/test';
import { gotoApp } from '../e2e/helpers';

/** Pin chrome to fonts this host and ubuntu-latest both ship, so baselines aren't a font lottery. */
const VISUAL_FONTS = `
:root {
  --gol-font-mono: "DejaVu Sans Mono", "Liberation Mono", monospace !important;
  --gol-font-family: "DejaVu Sans", "Liberation Sans", "Noto Sans", sans-serif !important;
  --gol-font-family-mono: "DejaVu Sans Mono", "Liberation Mono", monospace !important;
}
html, body, button, input, #chrome {
  font-family: "DejaVu Sans Mono", "Liberation Mono", monospace !important;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`;

export async function gotoVisual(page: Page): Promise<void> {
  await gotoApp(page);
  await page.addStyleTag({ content: VISUAL_FONTS });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Park the pointer on the toolbar so the canvas fires pointerleave and the cursor readout
  // settles on "—" rather than whatever cell the last move happened to hit.
  await page.locator('#chrome-toolbar').hover();
  await waitForPaint(page);
}

export function volatileMask(page: Page): Locator[] {
  return [page.locator('[data-mask="volatile"]')];
}

export async function setCamera(
  page: Page,
  pose: { originX?: number; originY?: number; cellSize?: number },
): Promise<void> {
  await page.evaluate((next) => {
    const api = window.__fancyGol;
    if (!api) throw new Error('window.__fancyGol is missing');
    api.setCamera(next);
  }, pose);
  if (pose.cellSize !== undefined) {
    const expected = pose.cellSize;
    await page.waitForFunction((size) => {
      const api = window.__fancyGol;
      return Boolean(api && Math.abs(api.cellSize - size) < 1e-6);
    }, expected);
  }
  await waitForPaint(page);
}

/** Frame the Gosper gun (painted at 20,20) at a known cell size. */
export async function frameGun(page: Page, cellSize: number): Promise<void> {
  const pose = await page.evaluate((size) => {
    const api = window.__fancyGol;
    if (!api) throw new Error('window.__fancyGol is missing');
    return {
      cellSize: size,
      originX: Math.round(38 - api.widthPx / 2 / size),
      originY: Math.round(24 - api.heightPx / 2 / size),
    };
  }, cellSize);
  await setCamera(page, pose);
}

export async function hideChrome(page: Page): Promise<void> {
  const hidden = await page.evaluate(() => document.querySelector('#chrome')?.classList.contains('chrome-hidden') === true);
  if (!hidden) await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('#chrome')?.classList.contains('chrome-hidden') === true);
  await waitForPaint(page);
}

export async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}
