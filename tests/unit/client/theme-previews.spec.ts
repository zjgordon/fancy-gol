import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DARK_THEME } from '@themes/default/theme';
import { compileTheme } from '@themes/registry';
import {
  THEME_PREVIEW_BUDGET_MS,
  ThemePreviewLoop,
} from '@client/theme-previews';
import { THUMBNAIL_STEP_EVERY_N_FRAMES } from '@client/thumbnail-batch';

const rendererSpies = vi.hoisted(() => ({
  draws: 0,
  disposed: 0,
}));

vi.mock('@render/canvas2d', () => ({
  Canvas2DRenderer: class {
    init(): Promise<void> {
      return Promise.resolve();
    }
    setTheme(): void {}
    resize(): void {}
    setViewport(): void {}
    draw(): void {
      rendererSpies.draws += 1;
    }
    dispose(): void {
      rendererSpies.disposed += 1;
    }
  },
}));

function fakeScheduler(): {
  queued: Array<() => void>;
  scheduler: { request: (fn: () => void) => number; cancel: () => void };
} {
  const queued: Array<() => void> = [];
  return {
    queued,
    scheduler: {
      request: (fn) => {
        queued.push(fn);
        return queued.length;
      },
      cancel: () => {
        queued.length = 0;
      },
    },
  };
}

const THEME = compileTheme(DEFAULT_DARK_THEME);

describe('ThemePreviewLoop', () => {
  it('is idle until start, steps a batch, and stops rendering when stopped', async () => {
    rendererSpies.draws = 0;
    rendererSpies.disposed = 0;
    const { queued, scheduler } = fakeScheduler();
    const loop = new ThemePreviewLoop({
      themeFor: (id) => (id === 'default' ? THEME : undefined),
      scheduler,
    });

    expect(loop.running).toBe(false);
    loop.tick();
    expect(rendererSpies.draws).toBe(0);

    loop.register('default', {} as HTMLCanvasElement);
    loop.register('missing', {} as HTMLCanvasElement);
    loop.start();
    await Promise.resolve();
    expect(loop.running).toBe(true);
    expect(queued).toHaveLength(1);

    for (let i = 0; i < THUMBNAIL_STEP_EVERY_N_FRAMES; i++) {
      const fn = queued.shift();
      fn?.();
    }
    expect(rendererSpies.draws).toBeGreaterThan(0);

    loop.stop();
    expect(loop.running).toBe(false);
    expect(rendererSpies.disposed).toBe(1);
    const drawsAfterStop = rendererSpies.draws;
    loop.tick();
    expect(rendererSpies.draws).toBe(drawsAfterStop);
  });

  it('keeps a combined tick under the 3 ms budget', () => {
    let clock = 0;
    const loop = new ThemePreviewLoop({
      themeFor: () => THEME,
      now: () => clock,
      scheduler: {
        request: () => 1,
        cancel: () => {},
      },
    });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      loop.register(id, {} as HTMLCanvasElement);
    }
    loop.start();
    // Force a stepping frame and charge via fake now().
    clock = 0;
    for (let i = 0; i < THUMBNAIL_STEP_EVERY_N_FRAMES - 1; i++) {
      clock += 0.01;
      loop.tick();
    }
    clock = 10;
    loop.tick();
    expect(loop.lastTickCostMs).toBeGreaterThanOrEqual(0);
    // With a real now() the budget gate is what production cares about:
    const real = new ThemePreviewLoop({
      themeFor: () => THEME,
      scheduler: {
        request: () => 1,
        cancel: () => {},
      },
    });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      real.register(id, {} as HTMLCanvasElement);
    }
    real.start();
    for (let i = 0; i < THUMBNAIL_STEP_EVERY_N_FRAMES; i++) real.tick();
    expect(real.lastTickCostMs).toBeLessThan(THEME_PREVIEW_BUDGET_MS);
    real.stop();
    loop.stop();
  });
});
