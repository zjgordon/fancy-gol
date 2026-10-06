/**
 * P3-D-4 — per-theme frame rate, measured in a real browser.
 *
 * Why this file exists and why it is not a PR gate: the quality-3 frame budget (≥ 55 fps at
 * 1080p with ~100k visible cells) cannot be certified in Node. A software-raster harness
 * overstates the cell layer and the compositor blits by ~6× (measured floor 44.8 ms/frame for
 * a theme with *zero* effects), while the `CanvasRecorder` path every other browser-class bench
 * case uses cannot feed the post-process passes real pixels at all. A headless CI runner is not
 * the "reference machine" the acceptance criterion names either. So the criterion lives here,
 * on a Playwright project that only the nightly runs, and its stability accumulates in
 * `docs/gate-history/` as `browser-bench` (`planning/README.md` §3.10).
 *
 * The Node-side record of the same measurement — every theme's measured CPU effect cost at
 * 1080p, recorded in `bench-baseline.json` — is `tests/bench/themes.bench.ts`.
 *
 * Two honest labels, because a perf spec that oversells itself is worse than none:
 *  - **~100k visible cell slots**, not 100k live cells. The post-process passes are per-texel
 *    loops, so their cost is content-independent and this viewport is representative for the
 *    effect stack; the cell layer is GPU work in a real browser and is not what AC1 measures.
 *  - **Headless Chromium on a shared runner** is not a reference machine. Treat the numbers as
 *    the accumulating signal, not as a certificate.
 */
import { expect, test, type Page } from '@playwright/test';
import { THEME_IDS, activateTheme, openApp, startSoup } from './helpers';

const FRAME_SAMPLE_MS = 3_000;

/** Frames actually presented over {@link FRAME_SAMPLE_MS}, measured in-page with rAF. */
async function measureFps(page: Page): Promise<number> {
  return page.evaluate((ms) => {
    return new Promise<number>((resolve) => {
      let frames = 0;
      const t0 = Date.now();
      const tick = (): void => {
        frames += 1;
        const elapsed = Date.now() - t0;
        if (elapsed >= ms) resolve((frames * 1000) / elapsed);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, FRAME_SAMPLE_MS);
}

test.describe('theme frame rate at 1080p (P3-D-4 AC1/AC2)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    // `?test=1` boots paused. Without this the page is idle, no frame is ever drawn, and every
    // theme "holds 60 fps" — which is what this spec measured until P3-E-1 fixed it.
    await startSoup(page);
  });

  for (const theme of THEME_IDS) {
    test(`${theme} holds ≥ 55 fps at quality 3`, async ({ page }) => {
      await activateTheme(page, theme);
      // `?test=1` pins quality at the ceiling, so this is the theme's full stack, honestly.
      expect(await page.evaluate(() => window.__fancyGol?.effectQuality)).toBe(3);
      await measureFps(page); // warm: first seconds include JIT + first-touch allocation
      const fps = await measureFps(page);
      expect(fps, `${theme} at quality 3`).toBeGreaterThanOrEqual(55);
    });
  }

  for (const theme of THEME_IDS) {
    test(`${theme} holds ≥ 60 fps at quality 0 under a 4× CPU throttle`, async ({ page }) => {
      await activateTheme(page, theme);
      await page.evaluate(() => window.__fancyGol?.pinQuality(0));
      await page.waitForFunction(() => window.__fancyGol?.effectQuality === 0);
      // Chromium-only CDP throttle — a CPU-slowdown profile, exactly what the AC describes.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      try {
        await measureFps(page);
        const fps = await measureFps(page);
        expect(fps, `${theme} at quality 0 under 4× CPU throttle`).toBeGreaterThanOrEqual(60);
      } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.detach();
      }
    });
  }
});