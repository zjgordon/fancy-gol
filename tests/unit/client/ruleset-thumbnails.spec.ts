import { describe, expect, it, vi } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { SHELL_THEME } from '@client/shell-theme';
import { RAF_THUMBNAIL_SCHEDULER, RulesetThumbnailLoop } from '@client/ruleset-thumbnails';
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

function fakeScheduler(): { queued: Array<() => void>; scheduler: { request: (fn: () => void) => number; cancel: () => void } } {
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

describe('RulesetThumbnailLoop', () => {
  it('is a no-op until start, then steps a rotating batch and disposes on stop', async () => {
    rendererSpies.draws = 0;
    rendererSpies.disposed = 0;
    const { queued, scheduler } = fakeScheduler();
    const loop = new RulesetThumbnailLoop({
      getRuleset: (id) => (id === 'conway' ? CONWAY : undefined),
      themeFor: () => SHELL_THEME,
      scheduler,
    });
    loop.tick();
    expect(rendererSpies.draws).toBe(0);

    loop.register('missing', {} as HTMLCanvasElement);
    loop.register('conway', {} as HTMLCanvasElement);
    loop.start();
    await Promise.resolve();
    expect(queued).toHaveLength(1);

    for (let i = 0; i < THUMBNAIL_STEP_EVERY_N_FRAMES; i++) {
      const fn = queued.shift();
      fn?.();
    }
    expect(rendererSpies.draws).toBeGreaterThan(0);

    loop.stop();
    expect(rendererSpies.disposed).toBe(1);
    loop.tick();
  });

  it('does not re-enter when the scheduler fires synchronously', () => {
    let calls = 0;
    const loop = new RulesetThumbnailLoop({
      getRuleset: () => CONWAY,
      themeFor: () => SHELL_THEME,
      scheduler: {
        request: (fn) => {
          calls += 1;
          fn();
          return 1;
        },
        cancel: () => {},
      },
    });
    loop.start();
    expect(calls).toBe(1);
    loop.stop();
  });

  it('forgets registered canvases on clear', () => {
    rendererSpies.disposed = 0;
    const { scheduler } = fakeScheduler();
    const loop = new RulesetThumbnailLoop({
      getRuleset: () => CONWAY,
      themeFor: () => SHELL_THEME,
      scheduler,
    });
    loop.register('conway', {} as HTMLCanvasElement);
    loop.start();
    loop.clear();
    expect(rendererSpies.disposed).toBeGreaterThan(0);
    loop.start();
    loop.stop();
  });
});

describe('RAF_THUMBNAIL_SCHEDULER', () => {
  it('forwards to the platform animation-frame pair', () => {
    const prevRequest = globalThis.requestAnimationFrame;
    const prevCancel = globalThis.cancelAnimationFrame;
    const ran: number[] = [];
    globalThis.requestAnimationFrame = (fn: FrameRequestCallback) => {
      fn(0);
      return 7;
    };
    globalThis.cancelAnimationFrame = (handle: number) => {
      ran.push(handle);
    };
    try {
      expect(RAF_THUMBNAIL_SCHEDULER.request(() => {})).toBe(7);
      RAF_THUMBNAIL_SCHEDULER.cancel(7);
      expect(ran).toEqual([7]);
    } finally {
      globalThis.requestAnimationFrame = prevRequest;
      globalThis.cancelAnimationFrame = prevCancel;
    }
  });
});
