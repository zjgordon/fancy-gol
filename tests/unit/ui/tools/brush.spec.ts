import { describe, expect, it } from 'vitest';
import { BRIANS_BRAIN } from '@engine/rules/builtin';
import type { PaintOp } from '@shared/types';
import type { ToolPoint } from '@ui/input/router';
import { Brush, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '@ui/tools/brush';
import type { ToolContext } from '@ui/tools/tool';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

function point(x: number, y: number): ToolPoint {
  return { x, y, pressure: 0.5, timeMs: 0 };
}

function ctxAt(x: number, y: number, coalesced?: readonly ToolPoint[]): ToolContext {
  const p = point(x, y);
  return {
    event: {
      phase: 'move',
      pointerId: 1,
      pointerType: 'mouse',
      point: p,
      coalesced: coalesced ?? [p],
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    },
  };
}

function sortOps(ops: readonly PaintOp[]): PaintOp[] {
  return [...ops].sort((a, b) => a.x - b.x || a.y - b.y);
}

describe('Brush', () => {
  describe('shape and size', () => {
    it('clamps size to [MIN_BRUSH_SIZE, MAX_BRUSH_SIZE]', () => {
      const tooSmall = new Brush({ size: -5 });
      expect(tooSmall.size).toBe(MIN_BRUSH_SIZE);
      const tooBig = new Brush({ size: 1000 });
      expect(tooBig.size).toBe(MAX_BRUSH_SIZE);
    });

    it('a size-1 brush paints exactly the single cell under the cursor', () => {
      const brush = new Brush({ size: 1, shape: 'square' });
      brush.onDown(ctxAt(4, 7));
      expect(brush.preview()).toEqual([{ x: 4, y: 7, state: 1 }]);
    });

    it('a square brush fills the full footprint; a circle brush trims the corners', () => {
      const square = new Brush({ size: 5, shape: 'square', state: 1 });
      square.onDown(ctxAt(0, 0));
      // r = 2.5: every |dx|,|dy| <= 2 qualifies -> a full 5x5 = 25 cells.
      expect(square.preview()).toHaveLength(25);

      const circle = new Brush({ size: 5, shape: 'circle', state: 1 });
      circle.onDown(ctxAt(0, 0));
      // The corner (2,2) has distance sqrt(8) ~= 2.83 > 2.5 -> excluded, unlike the square.
      expect(circle.preview().length).toBeLessThan(25);
      expect(circle.preview().some((o) => o.x === 2 && o.y === 2)).toBe(false);
      expect(circle.preview().some((o) => o.x === 2 && o.y === 0)).toBe(true);
    });

    it('a diamond brush uses taxicab distance', () => {
      const diamond = new Brush({ size: 5, shape: 'diamond', state: 1 });
      diamond.onDown(ctxAt(0, 0));
      expect(diamond.preview().some((o) => o.x === 2 && o.y === 0)).toBe(true); // |2|+|0| = 2 < 2.5
      expect(diamond.preview().some((o) => o.x === 2 && o.y === 1)).toBe(false); // |2|+|1| = 3 >= 2.5
    });
  });

  describe('state selection (multi-state rules)', () => {
    it('paints state 2 in Brian\'s Brain purely by setting a property — no typing required', () => {
      const dyingState = BRIANS_BRAIN.states.find((s) => s.id === 2);
      expect(dyingState).toBeDefined(); // sanity: Brian's Brain really does have a state id 2

      const brush = new Brush({ size: 1, state: 2 });
      brush.onDown(ctxAt(0, 0));
      const [op] = brush.onUp(ctxAt(0, 0));
      expect(op).toEqual({ x: 0, y: 0, state: 2 });
    });
  });

  describe('gap-free strokes (Bresenham)', () => {
    it('a single very sparse coalesced sample still paints every intermediate cell, not just endpoints', () => {
      const brush = new Brush({ size: 1, shape: 'square' });
      brush.onDown(ctxAt(0, 0));
      brush.onMove(ctxAt(100, 0));
      const xs = brush.preview().map((o) => o.x).sort((a, b) => a - b);
      expect(xs).toEqual(Array.from({ length: 101 }, (_, i) => i)); // 0..100, none skipped
    });

    it('is gap-free for a diagonal jump too, not just horizontal', () => {
      const brush = new Brush({ size: 1, shape: 'square' });
      brush.onDown(ctxAt(0, 0));
      brush.onMove(ctxAt(10, 30)); // steep: y dominates, exercising Bresenham's y-step branch
      const cells = brush.preview().map((o) => `${o.x},${o.y}`);
      expect(cells).toHaveLength(31); // one cell per step of the dominant (y) axis
      // 8-connected: every consecutive pair of painted cells is adjacent, nothing skipped.
      const byY = [...brush.preview()].sort((a, b) => a.y - b.y);
      for (let i = 1; i < byY.length; i++) {
        expect(Math.abs(byY[i]!.x - byY[i - 1]!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(byY[i]!.y - byY[i - 1]!.y)).toBe(1);
      }
    });

    it('a drag sampled at 2000 px/s (60fps, cellSize 8) leaves a solid, unbroken horizontal stroke', () => {
      const cellSize = 8;
      const pxPerSecond = 2000;
      const worldUnitsPerFrame = pxPerSecond / 60 / cellSize; // ~4.17 world units/frame
      const FRAMES = 40;

      const brush = new Brush({ size: 1, shape: 'square' });
      brush.onDown(ctxAt(0, 0));
      for (let frame = 1; frame <= FRAMES; frame++) {
        const x = frame * worldUnitsPerFrame;
        brush.onMove(ctxAt(x, 0));
      }

      const xs = brush.preview().map((o) => o.x).sort((a, b) => a - b);
      const expectedLength = Math.round(FRAMES * worldUnitsPerFrame) + 1;
      // Every consecutive painted x differs by exactly 1 cell: a solid line, no gap anywhere.
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!).toBe(1);
      }
      expect(xs).toHaveLength(expectedLength);
    });
  });

  describe('symmetry', () => {
    it('rotate-8 produces exactly 8 distinct ops for a point off every axis', () => {
      const brush = new Brush({ size: 1, symmetry: 'rotate-8', state: 1 });
      brush.onDown(ctxAt(3, 2)); // dx=3, dy=2: not on an axis, dx != dy
      const ops = sortOps(brush.preview());
      expect(ops).toHaveLength(8);
      expect(new Set(ops.map((o) => `${o.x},${o.y}`)).size).toBe(8); // truly distinct, not just 8 entries
      expect(ops).toEqual(
        sortOps([
          { x: 3, y: 2, state: 1 },
          { x: -3, y: 2, state: 1 },
          { x: 3, y: -2, state: 1 },
          { x: -3, y: -2, state: 1 },
          { x: 2, y: 3, state: 1 },
          { x: -2, y: 3, state: 1 },
          { x: 2, y: -3, state: 1 },
          { x: -2, y: -3, state: 1 },
        ]),
      );
    });

    it('rotate-8 deduplicates a point sitting on the x-axis down to 4 unique ops', () => {
      const brush = new Brush({ size: 1, symmetry: 'rotate-8', state: 1 });
      brush.onDown(ctxAt(5, 0)); // dy=0: several of the 8 transforms coincide
      const ops = sortOps(brush.preview());
      expect(ops).toEqual(
        sortOps([
          { x: 5, y: 0, state: 1 },
          { x: -5, y: 0, state: 1 },
          { x: 0, y: 5, state: 1 },
          { x: 0, y: -5, state: 1 },
        ]),
      );
    });

    it('rotate-8 collapses the origin itself (on every axis at once) to a single op', () => {
      const brush = new Brush({ size: 1, symmetry: 'rotate-8', state: 1 });
      brush.onDown(ctxAt(0, 0));
      expect(brush.preview()).toEqual([{ x: 0, y: 0, state: 1 }]);
    });

    it('rotate-4 rotates around the centre in 90-degree steps', () => {
      const brush = new Brush({ size: 1, symmetry: 'rotate-4', state: 1 });
      brush.onDown(ctxAt(4, 1));
      expect(sortOps(brush.preview())).toEqual(
        sortOps([
          { x: 4, y: 1, state: 1 },
          { x: -1, y: 4, state: 1 },
          { x: -4, y: -1, state: 1 },
          { x: 1, y: -4, state: 1 },
        ]),
      );
    });

    it('mirror-x reflects across the horizontal axis only', () => {
      const brush = new Brush({ size: 1, symmetry: 'mirror-x', state: 1 });
      brush.onDown(ctxAt(4, 3));
      expect(sortOps(brush.preview())).toEqual(
        sortOps([
          { x: 4, y: 3, state: 1 },
          { x: 4, y: -3, state: 1 },
        ]),
      );
    });

    it('quad mirrors across both axes', () => {
      const brush = new Brush({ size: 1, symmetry: 'quad', state: 1 });
      brush.onDown(ctxAt(4, 3));
      expect(sortOps(brush.preview())).toEqual(
        sortOps([
          { x: 4, y: 3, state: 1 },
          { x: -4, y: 3, state: 1 },
          { x: 4, y: -3, state: 1 },
          { x: -4, y: -3, state: 1 },
        ]),
      );
    });

    it('symmetry is relative to a configurable centre, not always the world origin', () => {
      const brush = new Brush({ size: 1, symmetry: 'mirror-y', state: 1, center: { x: 10, y: 0 } });
      brush.onDown(ctxAt(13, 0)); // 3 cells right of centre
      expect(sortOps(brush.preview())).toEqual(
        sortOps([
          { x: 13, y: 0, state: 1 },
          { x: 7, y: 0, state: 1 }, // mirrored 3 cells left of centre
        ]),
      );
    });
  });

  describe('density (spray)', () => {
    it('density 1 (default) always paints every footprint cell', () => {
      const brush = new Brush({ size: 5, shape: 'square', density: 1 });
      brush.onDown(ctxAt(0, 0));
      expect(brush.preview()).toHaveLength(25);
    });

    it('density < 1 paints a strict subset, deterministically for a given seed', () => {
      const a = new Brush({ size: 9, shape: 'square', density: 0.5, seed: 42 });
      const b = new Brush({ size: 9, shape: 'square', density: 0.5, seed: 42 });
      a.onDown(ctxAt(0, 0));
      b.onDown(ctxAt(0, 0));
      expect(sortOps(a.preview())).toEqual(sortOps(b.preview()));
      expect(a.preview().length).toBeGreaterThan(0);
      expect(a.preview().length).toBeLessThan(81); // 9x9 full footprint
    });

    it('a different seed produces a different speckle pattern', () => {
      const a = new Brush({ size: 9, shape: 'square', density: 0.5, seed: 1 });
      const b = new Brush({ size: 9, shape: 'square', density: 0.5, seed: 2 });
      a.onDown(ctxAt(0, 0));
      b.onDown(ctxAt(0, 0));
      expect(sortOps(a.preview())).not.toEqual(sortOps(b.preview()));
    });
  });

  describe('stroke lifecycle', () => {
    it('onUp returns the accumulated ops and resets state for the next stroke', () => {
      const brush = new Brush({ size: 1 });
      brush.onDown(ctxAt(0, 0));
      brush.onMove(ctxAt(1, 0));
      const ops = brush.onUp(ctxAt(1, 0));
      expect(ops).toHaveLength(2);
      expect(brush.preview()).toHaveLength(0);

      brush.onDown(ctxAt(9, 9));
      expect(brush.preview()).toEqual([{ x: 9, y: 9, state: 1 }]); // fresh stroke, no leftover state
    });

    it('onCancel discards the in-progress stroke with no return value', () => {
      const brush = new Brush({ size: 1 });
      brush.onDown(ctxAt(0, 0));
      brush.onMove(ctxAt(5, 0));
      expect(brush.preview().length).toBeGreaterThan(0);

      expect(brush.onCancel()).toBeUndefined();
      expect(brush.preview()).toHaveLength(0);
    });

    it('onMove before any onDown is a no-op (no active stroke to extend)', () => {
      const brush = new Brush({ size: 1 });
      brush.onMove(ctxAt(5, 5));
      expect(brush.preview()).toHaveLength(0);
    });
  });

  describe('performance', () => {
    it('a single coalesced-move batch that paints 5,000+ cells completes in well under one 60fps frame', () => {
      const coalesced = Array.from({ length: 5000 }, (_, i) => point(i + 1, 0));

      // Warm up the JIT first: an un-timed identical run so the measurement reflects steady-
      // state cost, not one-time V8 compilation of these functions on their very first call.
      const warm = new Brush({ size: 1, shape: 'square' });
      warm.onDown(ctxAt(0, 0));
      warm.onMove(ctxAt(5000, 0, coalesced));

      const brush = new Brush({ size: 1, shape: 'square' });
      brush.onDown(ctxAt(0, 0));
      const start = performance.now();
      brush.onMove(ctxAt(5000, 0, coalesced));
      const elapsedMs = performance.now() - start;

      expect(brush.preview().length).toBeGreaterThanOrEqual(5000);
      if (!UNDER_COVERAGE) expect(elapsedMs).toBeLessThan(16.6);
    });
  });
});
