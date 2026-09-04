import { describe, expect, it, vi } from 'vitest';
import { Camera } from '@ui/camera';
import {
  attachGestures,
  RAF_FRAME_SCHEDULER,
  REAL_CLOCK,
  SYSTEM_REDUCED_MOTION,
  type Clock,
  type FrameScheduler,
} from '@ui/input/gestures';

/**
 * A minimal but functionally real `GestureSurface` double — real add/remove bookkeeping and
 * dispatch, no dependency on jsdom's (incomplete) `PointerEvent`/`WheelEvent` constructors.
 * Same "functional double" discipline as `tests/unit/render/canvas2d.spec.ts`'s `FakeContext`.
 */
class FakeSurface {
  private readonly handlers = new Map<string, Set<(event: never) => void>>();

  addEventListener(type: string, listener: (event: never) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.handlers.get(type)?.delete(listener);
  }

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }

  dispatch(type: string, event: object): void {
    for (const fn of this.handlers.get(type) ?? []) fn(event as never);
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

class FakeClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

class FakeScheduler implements FrameScheduler {
  private pending: (() => void) | null = null;
  private nextHandle = 1;

  request(fn: () => void): number {
    this.pending = fn;
    return this.nextHandle++;
  }

  cancel(handle: number): void {
    void handle;
    this.pending = null;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Invoke the pending frame callback, if any, exactly once. */
  flushOne(): void {
    const fn = this.pending;
    this.pending = null;
    fn?.();
  }
}

function noPreventDefault() {
  return { preventDefault: () => {} };
}

describe('attachGestures', () => {
  describe('wheel', () => {
    it('zooms about the cursor on a plain (line-mode) wheel notch', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 10 });
      const surface = new FakeSurface();
      attachGestures(camera, surface, { reducedMotion: () => false });

      const before = camera.screenToWorld(300, 200);
      surface.dispatch('wheel', {
        ...noPreventDefault(),
        clientX: 300,
        clientY: 200,
        deltaX: 0,
        deltaY: -100, // scroll "up" — zoom in
        deltaMode: 1, // DOM_DELTA_LINE
        ctrlKey: false,
        shiftKey: false,
      });

      expect(camera.cellSize).toBeCloseTo(11, 9); // one notch: 10 * 1.1
      const after = camera.screenToWorld(300, 200);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    });

    it('zooms continuously with ctrl+wheel (trackpad-pinch-as-wheel)', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 10 });
      const surface = new FakeSurface();
      attachGestures(camera, surface, { reducedMotion: () => false });

      surface.dispatch('wheel', {
        ...noPreventDefault(),
        clientX: 100,
        clientY: 100,
        deltaX: 0,
        deltaY: -50,
        deltaMode: 0,
        ctrlKey: true,
        shiftKey: false,
      });

      expect(camera.cellSize).toBeCloseTo(10 * Math.exp(50 * 0.01), 9);
    });

    it('pans horizontally with shift+wheel, leaving cellSize untouched', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      attachGestures(camera, surface, { reducedMotion: () => false });

      surface.dispatch('wheel', {
        ...noPreventDefault(),
        clientX: 0,
        clientY: 0,
        deltaX: 0,
        deltaY: 40,
        deltaMode: 1,
        ctrlKey: false,
        shiftKey: true,
      });

      expect(camera.cellSize).toBe(4);
      expect(camera.originY).toBe(0);
      expect(camera.originX).not.toBe(0);
    });

    it('pans both axes for a pixel-mode wheel with no modifiers (trackpad two-finger pan)', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      attachGestures(camera, surface, { reducedMotion: () => false });

      surface.dispatch('wheel', {
        ...noPreventDefault(),
        clientX: 0,
        clientY: 0,
        deltaX: 20,
        deltaY: 10,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
      });

      expect(camera.cellSize).toBe(4);
      expect(camera.originX).not.toBe(0);
      expect(camera.originY).not.toBe(0);
    });
  });

  describe('middle-drag pan and inertia', () => {
    it('pans by the drag delta while the middle button is held', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, {
        reducedMotion: () => true, // isolate the drag itself from any inertia
      });

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      expect(controller.panning).toBe(true);

      surface.dispatch('pointermove', { pointerId: 1, clientX: 130, clientY: 90 });
      expect(camera.originX).toBeCloseTo(-30 / 4, 9);
      expect(camera.originY).toBeCloseTo(10 / 4, 9);

      surface.dispatch('pointerup', { pointerId: 1 });
      expect(controller.panning).toBe(false);
    });

    it('ignores a keyup for a non-Space key, and a pointerup for an unrelated pointer', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, { reducedMotion: () => true });

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      surface.dispatch('keyup', { code: 'ShiftLeft' });
      expect(controller.panning).toBe(true); // unrelated key, drag unaffected

      surface.dispatch('pointerup', { pointerId: 99 }); // a stray event for a pointer we never tracked
      expect(controller.panning).toBe(true);

      surface.dispatch('pointerup', { pointerId: 1 });
      expect(controller.panning).toBe(false);
    });

    it('releasing Space during a middle-drag (not a Space-drag) does not end the pan', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, { reducedMotion: () => true });

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      surface.dispatch('keydown', { code: 'Space', preventDefault: () => {} });
      surface.dispatch('keyup', { code: 'Space' });
      expect(controller.panning).toBe(true); // this drag started from the middle button, not Space

      surface.dispatch('pointerup', { pointerId: 1 });
      expect(controller.panning).toBe(false);
    });

    it('ignores a plain left-button drag (no Space, not middle)', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface);

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      expect(controller.panning).toBe(false);
      surface.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 200 });
      expect(camera.originX).toBe(0);
      expect(camera.originY).toBe(0);
    });

    it('pans via Space+left-drag, and releasing Space mid-drag ends the pan', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, {
        reducedMotion: () => true,
      });

      surface.dispatch('keydown', { code: 'Space', preventDefault: () => {} });
      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 0, pointerId: 5, clientX: 50, clientY: 50 });
      expect(controller.panning).toBe(true);

      surface.dispatch('pointermove', { pointerId: 5, clientX: 60, clientY: 50 });
      expect(camera.originX).toBeCloseTo(-10 / 4, 9);

      surface.dispatch('keyup', { code: 'Space' });
      expect(controller.panning).toBe(false);
    });

    it('coasts after release and comes to rest within 800ms, never producing a non-finite camera state', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, {
        clock,
        scheduler,
        reducedMotion: () => false,
      });

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      clock.advance(16);
      surface.dispatch('pointermove', { pointerId: 1, clientX: 120, clientY: 100 });
      clock.advance(16);
      surface.dispatch('pointermove', { pointerId: 1, clientX: 140, clientY: 100 });
      surface.dispatch('pointerup', { pointerId: 1 });

      expect(controller.coasting).toBe(true);

      let elapsedMs = 0;
      const FRAME_MS = 16;
      while (controller.coasting && elapsedMs < 2000) {
        clock.advance(FRAME_MS);
        elapsedMs += FRAME_MS;
        scheduler.flushOne();
        expect(Number.isFinite(camera.originX)).toBe(true);
        expect(Number.isFinite(camera.originY)).toBe(true);
      }

      expect(controller.coasting).toBe(false);
      expect(elapsedMs).toBeLessThanOrEqual(800 + FRAME_MS);
      expect(camera.cellSize).toBe(4); // inertia only ever pans
    });

    it('with reduced motion, pan stops the instant the pointer does — no coast at all', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, {
        clock,
        scheduler,
        reducedMotion: () => true,
      });

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      clock.advance(16);
      surface.dispatch('pointermove', { pointerId: 1, clientX: 140, clientY: 100 });
      surface.dispatch('pointerup', { pointerId: 1 });

      expect(controller.coasting).toBe(false);
      expect(scheduler.hasPending).toBe(false);
      const originXAfterRelease = camera.originX;
      clock.advance(1000);
      scheduler.flushOne(); // no-op: nothing was ever scheduled
      expect(camera.originX).toBe(originXAfterRelease);
    });

    it('a new wheel gesture cancels an in-flight inertia coast', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, {
        clock,
        scheduler,
        reducedMotion: () => false,
      });

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      clock.advance(16);
      surface.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
      surface.dispatch('pointerup', { pointerId: 1 });
      expect(controller.coasting).toBe(true);

      surface.dispatch('wheel', {
        ...noPreventDefault(),
        clientX: 0,
        clientY: 0,
        deltaX: 0,
        deltaY: -1,
        deltaMode: 1,
        ctrlKey: false,
        shiftKey: false,
      });
      expect(controller.coasting).toBe(false);
      expect(scheduler.hasPending).toBe(false);
    });
  });

  describe('pinch-zoom', () => {
    it('zooms about the pinch midpoint: the world point under the midpoint stays fixed', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 5, originY: -3, cellSize: 6 });
      const surface = new FakeSurface();
      attachGestures(camera, surface, { reducedMotion: () => false });

      const anchor = camera.screenToWorld(400, 300);

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'touch', pointerId: 1, clientX: 300, clientY: 300 });
      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'touch', pointerId: 2, clientX: 500, clientY: 300 });

      // Symmetric pinch-out: both fingers move away from the same midpoint (400, 300).
      surface.dispatch('pointermove', { pointerId: 1, clientX: 250, clientY: 300 });
      surface.dispatch('pointermove', { pointerId: 2, clientX: 550, clientY: 300 });

      const after = camera.screenToWorld(400, 300);
      expect(after.x).toBeCloseTo(anchor.x, 6);
      expect(after.y).toBeCloseTo(anchor.y, 6);
      expect(camera.cellSize).toBeCloseTo(6 * 1.5, 9); // distance 200 -> 300

      surface.dispatch('pointerup', { pointerId: 1 });
      surface.dispatch('pointerup', { pointerId: 2 });
    });

    it('does not confuse a single touch with a pinch, and never starts a mouse-drag pan for it', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface);

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });
      surface.dispatch('pointermove', { pointerId: 1, clientX: 150, clientY: 100 });

      expect(controller.panning).toBe(false);
      expect(camera.cellSize).toBe(4);
    });
  });

  describe('dispose', () => {
    it('removes every listener so subsequent events are inert', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, { reducedMotion: () => false });

      controller.dispose();

      for (const type of ['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'keyup']) {
        expect(surface.listenerCount(type)).toBe(0);
      }

      surface.dispatch('wheel', {
        ...noPreventDefault(),
        clientX: 0,
        clientY: 0,
        deltaX: 0,
        deltaY: -100,
        deltaMode: 1,
        ctrlKey: false,
        shiftKey: false,
      });
      expect(camera.cellSize).toBe(4);
    });

    it('cancels an in-flight inertia coast', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 4 });
      const surface = new FakeSurface();
      const controller = attachGestures(camera, surface, {
        clock,
        scheduler,
        reducedMotion: () => false,
      });

      surface.dispatch('pointerdown', { ...noPreventDefault(), pointerType: 'mouse', button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      clock.advance(16);
      surface.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
      surface.dispatch('pointerup', { pointerId: 1 });
      expect(controller.coasting).toBe(true);

      controller.dispose();
      expect(scheduler.hasPending).toBe(false);
    });
  });
});

describe('real (browser-backed) defaults', () => {
  it('REAL_CLOCK.now() reports performance.now() directly (milliseconds, not converted)', () => {
    const spy = vi.spyOn(performance, 'now').mockReturnValue(12.5);
    expect(REAL_CLOCK.now()).toBe(12.5);
    spy.mockRestore();
  });

  it('RAF_FRAME_SCHEDULER delegates to requestAnimationFrame/cancelAnimationFrame', () => {
    const requestSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(7);
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const fn = () => {};

    expect(RAF_FRAME_SCHEDULER.request(fn)).toBe(7);
    expect(requestSpy).toHaveBeenCalledWith(fn);

    RAF_FRAME_SCHEDULER.cancel(7);
    expect(cancelSpy).toHaveBeenCalledWith(7);

    requestSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('SYSTEM_REDUCED_MOTION reflects matchMedia when present, and is false when it is not (this jsdom)', () => {
    expect(typeof matchMedia).toBe('undefined');
    expect(SYSTEM_REDUCED_MOTION()).toBe(false);

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    expect(SYSTEM_REDUCED_MOTION()).toBe(true);

    vi.unstubAllGlobals();
  });
});
