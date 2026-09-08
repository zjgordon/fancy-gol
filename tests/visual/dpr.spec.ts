import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { frameGun, gotoVisual, hideChrome } from './helpers';

const VISUAL_ORIGIN = `http://127.0.0.1:${process.env['E2E_PORT'] ?? 8080}`;

async function openGrid(browser: Browser, dpr: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: dpr,
    colorScheme: 'dark',
    baseURL: VISUAL_ORIGIN,
  });
  const page = await context.newPage();
  await gotoVisual(page);
  await frameGun(page, 16);
  await hideChrome(page);
  return page;
}

/**
 * Relocated from P0-H-2: a real Chromium raster at deviceScaleFactor 1 and 2, same CSS
 * viewport. Compare the canvas backing store (not a compositor screenshot — those include the
 * HUD). dpr 2 is averaged 2×2 into CSS pixels and must match dpr 1 within 0.1%.
 */
test('grid raster is pixel-identical at dpr 1 and 2 modulo scale', async ({ browser }) => {
  const page1 = await openGrid(browser, 1);
  const dpr1Png = await page1.evaluate(() => {
    const canvas = document.querySelector('#scene');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
    return { png: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  });
  await page1.context().close();

  expect(dpr1Png.width).toBe(1280);
  expect(dpr1Png.height).toBe(720);

  const page2 = await openGrid(browser, 2);
  const result = await page2.evaluate(async (dpr1) => {
    const canvas = document.querySelector('#scene');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    if (canvas.width !== 2560 || canvas.height !== 1440) {
      throw new Error(`dpr2 backing store ${canvas.width}×${canvas.height}, expected 2560×1440`);
    }

    const img = new Image();
    img.src = dpr1.png;
    await img.decode();
    const off = document.createElement('canvas');
    off.width = dpr1.width;
    off.height = dpr1.height;
    const octx = off.getContext('2d');
    if (!octx) throw new Error('no offscreen 2d context');
    octx.drawImage(img, 0, 0);
    const low = octx.getImageData(0, 0, dpr1.width, dpr1.height).data;
    const high = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let different = 0;
    const total = dpr1.width * dpr1.height;
    for (let y = 0; y < dpr1.height; y++) {
      for (let x = 0; x < dpr1.width; x++) {
        const o = (y * dpr1.width + x) * 4;
        const i00 = ((y * 2) * canvas.width + x * 2) * 4;
        const i10 = i00 + 4;
        const i01 = ((y * 2 + 1) * canvas.width + x * 2) * 4;
        const i11 = i01 + 4;
        let mismatch = false;
        for (let c = 0; c < 4; c++) {
          const avg = Math.round((high[i00 + c]! + high[i10 + c]! + high[i01 + c]! + high[i11 + c]!) / 4);
          if (avg !== low[o + c]) {
            mismatch = true;
            break;
          }
        }
        if (mismatch) different += 1;
      }
    }
    return { different, total, ratio: different / total };
  }, dpr1Png);
  await page2.context().close();

  expect(
    result.ratio,
    `dpr 1 vs downsampled dpr 2 differed in ${result.different}/${result.total} pixels (${(result.ratio * 100).toFixed(3)}%)`,
  ).toBeLessThanOrEqual(0.001);
});
