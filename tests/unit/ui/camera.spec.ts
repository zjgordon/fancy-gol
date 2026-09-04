import { describe, expect, it } from 'vitest';
import { Camera, EASE_OUT_CUBIC, MAX_CELL_SIZE, MIN_CELL_SIZE, type Clock, type FrameScheduler } from '@ui/camera';
import { Mulberry32 } from '@engine/rng';
import type { Rect } from '@shared/types';

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

  flushOne(): void {
    const fn = this.pending;
    this.pending = null;
    fn?.();
  }
}

describe('Camera', () => {
  describe('screenToWorld / worldToScreen', () => {
    it('round-trips within 1e-9 across 10k random cameras', () => {
      // Points are drawn from within each camera's own visible viewport (a random offset
      // measured in screen px, converted through that camera's cellSize) rather than from an
      // independent world-wide range. That is the domain these two functions actually see in
      // practice — every real caller starts from a pointer event inside the canvas — and it
      // keeps every intermediate value in this test at a realistic, bounded magnitude so a
      // correct implementation isn't penalised for plain double-precision rounding on inputs
      // no caller would ever produce (e.g. a coordinate 1e6 cells from the origin viewed at
      // the minimum cell size).
      const rng = new Mulberry32(0xc0ffee);
      for (let i = 0; i < 10_000; i++) {
        const widthPx = 200 + rng.next() * 2000;
        const heightPx = 200 + rng.next() * 2000;
        const cellSize = MIN_CELL_SIZE + rng.next() * (MAX_CELL_SIZE - MIN_CELL_SIZE);
        const camera = new Camera({
          widthPx,
          heightPx,
          originX: (rng.next() - 0.5) * 2000,
          originY: (rng.next() - 0.5) * 2000,
          cellSize,
        });

        const worldX = camera.originX + ((rng.next() - 0.5) * widthPx) / cellSize;
        const worldY = camera.originY + ((rng.next() - 0.5) * heightPx) / cellSize;

        const screen = camera.worldToScreen(worldX, worldY);
        const back = camera.screenToWorld(screen.px, screen.py);

        expect(Math.abs(back.x - worldX)).toBeLessThan(1e-9 * Math.max(1, Math.abs(worldX)));
        expect(Math.abs(back.y - worldY)).toBeLessThan(1e-9 * Math.max(1, Math.abs(worldY)));
      }
    });
  });

  describe('zoomAt', () => {
    it('keeps the world point under the cursor fixed to sub-pixel accuracy across 100 successive zooms', () => {
      const camera = new Camera({ widthPx: 1024, heightPx: 768, originX: 12.5, originY: -7.25, cellSize: 4 });
      const px0 = 640;
      const py0 = 300;
      const anchor = camera.screenToWorld(px0, py0);

      const rng = new Mulberry32(42);
      for (let i = 0; i < 100; i++) {
        const factor = 0.5 + rng.next() * 1.5; // exercises both zoom-in and zoom-out
        camera.zoomAt(px0, py0, factor);

        const world = camera.screenToWorld(px0, py0);
        const screenErrX = Math.abs(world.x - anchor.x) * camera.cellSize;
        const screenErrY = Math.abs(world.y - anchor.y) * camera.cellSize;
        expect(screenErrX).toBeLessThan(1);
        expect(screenErrY).toBeLessThan(1);
      }
    });

    it('clamps cellSize to [MIN_CELL_SIZE, MAX_CELL_SIZE]', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 1 });
      camera.zoomAt(0, 0, 1e-9);
      expect(camera.cellSize).toBe(MIN_CELL_SIZE);
      camera.zoomAt(0, 0, 1e9);
      expect(camera.cellSize).toBe(MAX_CELL_SIZE);
    });

    it('falls back to MIN_CELL_SIZE rather than propagate a non-finite cellSize', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: Infinity });
      expect(camera.cellSize).toBe(MIN_CELL_SIZE);
      camera.zoomAt(0, 0, Infinity);
      expect(camera.cellSize).toBe(MIN_CELL_SIZE);
    });
  });

  describe('fitTo', () => {
    it('frames a wide rect: width is the binding axis, height gets extra centred margin', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      const rect: Rect = { x: 10, y: 20, width: 400, height: 50 };
      const padding = 20;

      camera.fitTo(rect, padding);

      const topLeft = camera.worldToScreen(rect.x, rect.y);
      const bottomRight = camera.worldToScreen(rect.x + rect.width, rect.y + rect.height);

      expect(topLeft.px).toBeCloseTo(padding, 6);
      expect(bottomRight.px).toBeCloseTo(800 - padding, 6);

      const vMargin = topLeft.py;
      expect(vMargin).toBeGreaterThan(padding);
      expect(600 - bottomRight.py).toBeCloseTo(vMargin, 6);
    });

    it('frames a tall rect: height is the binding axis, width gets extra centred margin', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      const rect: Rect = { x: -5, y: 0, width: 50, height: 400 };
      const padding = 15;

      camera.fitTo(rect, padding);

      const topLeft = camera.worldToScreen(rect.x, rect.y);
      const bottomRight = camera.worldToScreen(rect.x + rect.width, rect.y + rect.height);

      expect(topLeft.py).toBeCloseTo(padding, 6);
      expect(bottomRight.py).toBeCloseTo(600 - padding, 6);

      const hMargin = topLeft.px;
      expect(hMargin).toBeGreaterThan(padding);
      expect(800 - bottomRight.px).toBeCloseTo(hMargin, 6);
    });

    it('never exceeds MAX_CELL_SIZE for a tiny rect', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      camera.fitTo({ x: 0, y: 0, width: 1, height: 1 }, 0);
      expect(camera.cellSize).toBe(MAX_CELL_SIZE);
    });

    it('treats a zero-width rect (a vertical line) as unconstrained on that axis', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      camera.fitTo({ x: 5, y: 5, width: 0, height: 100 }, 0);
      // Height alone is binding: cellSize = 600 / 100 = 6.
      expect(camera.cellSize).toBe(6);
    });

    it('falls back to cellSize 1 for a degenerate zero-area rect', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      camera.fitTo({ x: 5, y: 5, width: 0, height: 0 }, 0);
      expect(camera.cellSize).toBe(1);
    });
  });

  describe('dirty tracking', () => {
    it('starts dirty and clears on demand', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      expect(camera.dirty).toBe(true);
      camera.clearDirty();
      expect(camera.dirty).toBe(false);
    });

    it.each<[string, (c: Camera) => void]>([
      [
        'originX set',
        (c) => {
          c.originX = 5;
        },
      ],
      [
        'originY set',
        (c) => {
          c.originY = 5;
        },
      ],
      [
        'cellSize set',
        (c) => {
          c.cellSize = 8;
        },
      ],
      ['resize', (c) => c.resize(1024, 768)],
      ['panBy', (c) => c.panBy(10, 10)],
      ['zoomAt', (c) => c.zoomAt(0, 0, 1.1)],
      ['fitTo', (c) => c.fitTo({ x: 0, y: 0, width: 10, height: 10 })],
    ])('%s marks the camera dirty', (_name, mutate) => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      camera.clearDirty();
      mutate(camera);
      expect(camera.dirty).toBe(true);
    });

    it('does not mark dirty when a no-op assignment repeats the current value', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 3, originY: 4, cellSize: 2 });
      camera.clearDirty();
      camera.originX = 3;
      camera.originY = 4;
      camera.cellSize = 2;
      camera.resize(800, 600);
      expect(camera.dirty).toBe(false);
    });
  });

  describe('viewport size', () => {
    it('exposes the current widthPx/heightPx and updates them via resize', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600 });
      expect(camera.widthPx).toBe(800);
      expect(camera.heightPx).toBe(600);
      camera.resize(1024, 768);
      expect(camera.widthPx).toBe(1024);
      expect(camera.heightPx).toBe(768);
    });
  });

  describe('panBy', () => {
    it('moves the origin by the screen delta scaled by cellSize, independent of zoom', () => {
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 8 });
      camera.panBy(80, -40);
      expect(camera.originX).toBeCloseTo(-10, 9);
      expect(camera.originY).toBeCloseTo(5, 9);
    });
  });

  describe('animateTo', () => {
    it('tweens the requested fields from their current value to the target over the given duration', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });

      camera.animateTo({ originX: 100, cellSize: 8 }, 1000, EASE_OUT_CUBIC, { clock, scheduler });
      expect(camera.animating).toBe(true);
      expect(scheduler.hasPending).toBe(true);

      clock.advance(500);
      scheduler.flushOne();
      // Halfway through with EASE_OUT_CUBIC (front-loaded), more than half the distance is covered.
      expect(camera.originX).toBeGreaterThan(50);
      expect(camera.originX).toBeLessThan(100);
      expect(camera.animating).toBe(true);

      clock.advance(600); // past the full duration
      scheduler.flushOne();
      expect(camera.originX).toBe(100);
      expect(camera.cellSize).toBe(8);
      expect(camera.animating).toBe(false);
      expect(scheduler.hasPending).toBe(false);
    });

    it('leaves a field out of `target` untouched throughout', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 3, originY: 7, cellSize: 4 });

      camera.animateTo({ cellSize: 16 }, 200, EASE_OUT_CUBIC, { clock, scheduler });
      clock.advance(200);
      scheduler.flushOne();

      expect(camera.originX).toBe(3);
      expect(camera.originY).toBe(7);
      expect(camera.cellSize).toBe(16);
    });

    it('a new animateTo cancels one already in flight — the new target wins, not a blend', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });

      camera.animateTo({ originX: 1000 }, 1000, EASE_OUT_CUBIC, { clock, scheduler });
      clock.advance(100);
      scheduler.flushOne();
      const midway = camera.originX;
      expect(midway).toBeGreaterThan(0);

      camera.animateTo({ originX: 0 }, 200, EASE_OUT_CUBIC, { clock, scheduler });
      clock.advance(200);
      scheduler.flushOne();
      expect(camera.originX).toBe(0);
    });

    it('cancelAnimation stops the tween exactly where it stands, never snapping to the target', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });

      camera.animateTo({ originX: 1000 }, 1000, EASE_OUT_CUBIC, { clock, scheduler });
      clock.advance(100);
      scheduler.flushOne();
      const midway = camera.originX;
      expect(midway).toBeGreaterThan(0);
      expect(midway).toBeLessThan(1000);

      camera.cancelAnimation();
      expect(camera.animating).toBe(false);
      expect(scheduler.hasPending).toBe(false);
      expect(camera.originX).toBe(midway);
    });

    it('a non-positive duration resolves to the target on the very next scheduled frame', () => {
      const clock = new FakeClock();
      const scheduler = new FakeScheduler();
      const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });

      camera.animateTo({ originX: 42 }, 0, EASE_OUT_CUBIC, { clock, scheduler });
      scheduler.flushOne();
      expect(camera.originX).toBe(42);
      expect(camera.animating).toBe(false);
    });
  });
});
