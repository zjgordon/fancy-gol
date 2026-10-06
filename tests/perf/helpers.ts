/**
 * P3-E-1 — shared page-side instrumentation for the two browser perf projects
 * (`browser-floor`, the blocking CI tier, and `browser-bench`, the reference certificate).
 *
 * Everything here runs against the real app in real Chromium. That is the point: ADR-012 rule 3
 * says pixel and cost criteria are proven in the browser, because `SoftwareSurface` returned
 * pixels where the browser returned zeros and every unit test passed anyway.
 */
import type { Page } from '@playwright/test';
import { runCommand } from '../e2e/helpers';

export const THEME_IDS = ['default', 'chiba-city', 'flatline', 'sids-place', 'void-walker', 'synthwave'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** ~100k visible cell slots in a 1080p viewport: 1920/4.55 × 1080/4.55 ≈ 422 × 237 (render.bench.ts). */
export const CELL_SIZE = 4.55;

declare global {
  interface Window {
    /** Test-only: freeze or release `performance.now` so time-driven passes redraw identically. */
    __floorFreezeClock?: (frozen: boolean) => void;
    __floorShots?: Map<string, Uint8ClampedArray>;
  }
}

/**
 * Install before navigation. `performance.now` is frozen on demand so a redraw at quality 3 and a
 * redraw at quality 2 see the same `frameTime` — otherwise a time-driven pass (`textRain`) differs
 * between the two captures and makes a dead post stage look alive.
 */
export async function installFloorInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = performance.now.bind(performance);
    let frozenAt: number | null = null;
    performance.now = () => frozenAt ?? real();
    window.__floorFreezeClock = (frozen) => {
      frozenAt = frozen ? real() : null;
    };
    window.__floorShots = new Map();
    try {
      localStorage.removeItem('gol.session');
    } catch {
      /* private mode — boot still starts fresh */
    }
  });
}

export async function openApp(page: Page): Promise<void> {
  await installFloorInstrumentation(page);
  await page.goto('/?test=1');
  await page.waitForFunction(() => window.__fancyGol?.ready === true, null, { timeout: 20_000 });
  await page.evaluate((cellSize) => window.__fancyGol?.setCamera({ cellSize }), CELL_SIZE);
}

export async function activateTheme(page: Page, theme: ThemeId): Promise<void> {
  await runCommand(page, `theme.select.${theme}`);
  await page.waitForFunction((id) => window.__fancyGol?.themeId === id, theme, { timeout: 10_000 });
}

/**
 * Seed a soup and run the sim. `?test=1` boots **paused**, so a frame-rate or allocation
 * measurement taken without this measures an idle page (the P3-D-4 fps spec did exactly that
 * until P3-E-1): draws only happen when the worker posts a frame.
 */
export async function startSoup(page: Page): Promise<void> {
  await runCommand(page, 'sim.randomSoup');
  const running = await page.evaluate(() => window.__fancyGol?.running === true);
  if (!running) await runCommand(page, 'sim.toggleRun');
  await page.waitForFunction(() => (window.__fancyGol?.tick ?? 0) > 2, null, { timeout: 10_000 });
}

export async function pauseSim(page: Page): Promise<void> {
  const running = await page.evaluate(() => window.__fancyGol?.running === true);
  if (running) await runCommand(page, 'sim.toggleRun');
}

/** Median rAF-to-rAF interval in ms over `durationMs` — what the user feels as frame time. */
export async function medianFrameMs(page: Page, durationMs: number): Promise<number> {
  return page.evaluate((ms) => {
    return new Promise<number>((resolve) => {
      const intervals: number[] = [];
      // Use the unfrozen wall clock: rAF timestamps are the browser's, not `performance.now`'s.
      let last: number | null = null;
      const start = Date.now();
      const tick = (t: number): void => {
        if (last !== null) intervals.push(t - last);
        last = t;
        if (Date.now() - start >= ms) {
          intervals.sort((a, b) => a - b);
          resolve(intervals[Math.floor(intervals.length / 2)] ?? Number.POSITIVE_INFINITY);
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, durationMs);
}

/**
 * Peak-minus-trough of `usedJSHeapSize` across `frames` animation frames. A pass that allocates
 * ~25 MB per frame shows a span of hundreds of MB between collections; a pass that allocates
 * nothing shows only the small steady churn of the app itself. Chromium-only and a proxy for
 * per-frame allocation, not a byte count — both facts belong on any gate built on it.
 */
export async function heapSpanBytes(page: Page, frames: number): Promise<number> {
  return page.evaluate((n) => {
    return new Promise<number>((resolve, reject) => {
      const api = window.__fancyGol;
      if (!api) return reject(new Error('window.__fancyGol is missing'));
      let lo = Number.POSITIVE_INFINITY;
      let hi = 0;
      let seen = 0;
      const tick = (): void => {
        const h = api.heapBytes();
        if (h === null) return reject(new Error('performance.memory is unavailable — Chromium only'));
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        if (++seen >= n) resolve(hi - lo);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, frames);
}

/**
 * Force a full redraw of the paused scene at the given pinned quality, then store the display
 * canvas under `label`. The camera is nudged and restored (a camera change is what makes the app
 * redraw while paused); the clock is frozen so time-driven passes repeat exactly.
 */
export async function snapAtQuality(page: Page, quality: number, label: string): Promise<void> {
  await page.evaluate(
    async ({ q, name }) => {
      const api = window.__fancyGol;
      if (!api) throw new Error('window.__fancyGol is missing');
      const frames = (n: number) =>
        new Promise<void>((resolve) => {
          const step = (): void => (n-- <= 0 ? resolve() : void requestAnimationFrame(step));
          step();
        });
      window.__floorFreezeClock?.(true);
      api.pinQuality(q);
      const { originX, originY } = api;
      api.setCamera({ originX: originX + 0.5 });
      await frames(3);
      api.setCamera({ originX, originY });
      await frames(4);
      const canvas = document.querySelector<HTMLCanvasElement>('#scene');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) throw new Error('#scene has no 2d context');
      window.__floorShots?.set(name, ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      window.__floorFreezeClock?.(false);
    },
    { q: quality, name: label },
  );
}

/** Number of pixels whose RGB differs between two stored snapshots. */
export async function diffPixels(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ({ x, y }) => {
      const sa = window.__floorShots?.get(x);
      const sb = window.__floorShots?.get(y);
      if (!sa || !sb) throw new Error(`missing snapshot ${!sa ? x : y}`);
      if (sa.length !== sb.length) throw new Error('snapshots differ in size');
      let n = 0;
      for (let i = 0; i < sa.length; i += 4) {
        if (sa[i] !== sb[i] || sa[i + 1] !== sb[i + 1] || sa[i + 2] !== sb[i + 2]) n++;
      }
      return n;
    },
    { x: a, y: b },
  );
}

/**
 * Like {@link snapAtQuality}, for effects that only draw in reaction to a generation (Chiba's birth
 * flash): reset to the seed, take one step at the pinned quality, and store the canvas the step's
 * own draw produced. Reset makes both qualities see the identical generation, so any pixel
 * difference is the effects stage and not the cells.
 */
export async function snapAfterStep(page: Page, quality: number, label: string): Promise<void> {
  await page.evaluate((q) => {
    window.__floorFreezeClock?.(true);
    window.__fancyGol?.pinQuality(q);
  }, quality);
  await runCommand(page, 'sim.reset');
  const before = await page.evaluate(() => window.__fancyGol?.tick ?? 0);
  await runCommand(page, 'sim.step');
  await page.waitForFunction((t) => (window.__fancyGol?.tick ?? 0) > t, before, { timeout: 10_000 });
  await page.evaluate(async (name) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = document.querySelector<HTMLCanvasElement>('#scene');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('#scene has no 2d context');
    window.__floorShots?.set(name, ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    window.__floorFreezeClock?.(false);
  }, label);
}
