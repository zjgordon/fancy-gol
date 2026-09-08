import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test.describe('pan and zoom', () => {
  test('ctrl+wheel zooms about the cursor and middle-drag pans', async ({ page }) => {
    await gotoApp(page);

    const before = await page.evaluate(() => {
      const api = window.__fancyGol!;
      return { cellSize: api.cellSize, originX: api.originX, originY: api.originY };
    });

    const canvas = page.locator('#scene');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');

    const afterZoom = await page.evaluate(() => {
      const api = window.__fancyGol!;
      return { cellSize: api.cellSize, originX: api.originX, originY: api.originY };
    });
    expect(afterZoom.cellSize).toBeGreaterThan(before.cellSize);

    // Chromium's middle-click autoscroll swallows Playwright's mouse middle-drag. Drive the
    // same `button === 1` path gestures.ts actually listens for, via Pointer Events on the canvas.
    await page.evaluate(({ fromX, fromY, toX, toY }) => {
      const canvas = document.querySelector('#scene');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
      const fire = (type: string, x: number, y: number, buttons: number): void => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: 'mouse',
            button: 1,
            buttons,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      };
      fire('pointerdown', fromX, fromY, 4);
      fire('pointermove', toX, toY, 4);
      fire('pointerup', toX, toY, 0);
    }, { fromX: cx, fromY: cy, toX: cx + 80, toY: cy + 40 });

    const afterPan = await page.evaluate(() => {
      const api = window.__fancyGol!;
      return { originX: api.originX, originY: api.originY };
    });
    expect(afterPan.originX).not.toBeCloseTo(afterZoom.originX, 5);
    expect(afterPan.originY).not.toBeCloseTo(afterZoom.originY, 5);
  });

  test('pinch-zoom on a touch session zooms about the pinch midpoint', async ({ page }) => {
    await gotoApp(page);

    const before = await page.evaluate(() => {
      const api = window.__fancyGol!;
      const canvas = document.querySelector('#scene')!;
      const rect = canvas.getBoundingClientRect();
      const midX = rect.width / 2;
      const midY = rect.height / 2;
      const world = api.screenToWorld(midX, midY);
      return { world, cellSize: api.cellSize, midX, midY };
    });

    await page.evaluate(({ midX, midY }) => {
      const canvas = document.querySelector('#scene');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + midX;
      const cy = rect.top + midY;

      const fire = (type: string, id: number, x: number, y: number): void => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      };

      fire('pointerdown', 1, cx - 40, cy);
      fire('pointerdown', 2, cx + 40, cy);
      fire('pointermove', 1, cx - 80, cy);
      fire('pointermove', 2, cx + 80, cy);
      fire('pointerup', 1, cx - 80, cy);
      fire('pointerup', 2, cx + 80, cy);
    }, { midX: before.midX, midY: before.midY });

    const after = await page.evaluate(({ midX, midY }) => {
      const api = window.__fancyGol!;
      return { world: api.screenToWorld(midX, midY), cellSize: api.cellSize };
    }, { midX: before.midX, midY: before.midY });

    expect(after.cellSize).toBeGreaterThan(before.cellSize);
    expect(after.world.x).toBeCloseTo(before.world.x, 3);
    expect(after.world.y).toBeCloseTo(before.world.y, 3);
  });
});
