import { describe, expect, it } from 'vitest';
import type { Clock } from '@ui/input/gestures';
import type { GridView, PaintOp, StateId } from '@shared/types';
import type { ToolPoint } from '@ui/input/router';
import { DEFAULT_FILL_CAP, FillTool } from '@ui/tools/fill';
import type { ToolContext } from '@ui/tools/tool';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

function ctxAt(x: number, y: number, grid?: GridView): ToolContext {
  const point: ToolPoint = { x, y, pressure: 0.5, timeMs: 0 };
  return {
    event: {
      phase: 'move',
      pointerId: 1,
      pointerType: 'mouse',
      point,
      coalesced: [point],
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    },
    ...(grid ? { grid } : {}),
  };
}

/** A minimal GridView double — only `get()` is ever called by FillTool. */
function fakeGrid(get: (x: number, y: number) => StateId): GridView {
  return { boundary: 'infinite', get } as unknown as GridView;
}

function uniformGrid(state: StateId): GridView {
  return fakeGrid(() => state);
}

function sortOps(ops: readonly PaintOp[]): PaintOp[] {
  return [...ops].sort((a, b) => a.x - b.x || a.y - b.y);
}

describe('FillTool', () => {
  describe('connectivity', () => {
    it('fills a bounded same-state region and stops exactly at its border', () => {
      // A 5x5 block of state 0 (rows/cols 0..4) surrounded by state 2.
      const grid = fakeGrid((x, y) => (x >= 0 && x < 5 && y >= 0 && y < 5 ? 0 : 2));
      const fill = new FillTool({ state: 1 });
      fill.onDown(ctxAt(2, 2, grid));

      const expected: PaintOp[] = [];
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) expected.push({ x, y, state: 1 });
      expect(sortOps(fill.preview())).toEqual(sortOps(expected));
      expect(fill.capped).toBe(false);
    });

    it('does not leak across cells that only touch diagonally (4-connectivity only)', () => {
      // Two single-cell blobs of state 0 at (0,0) and (1,1), touching only at a corner,
      // separated everywhere else by state 2.
      const grid = fakeGrid((x, y) => {
        if ((x === 0 && y === 0) || (x === 1 && y === 1)) return 0;
        return 2;
      });
      const fill = new FillTool({ state: 1 });
      fill.onDown(ctxAt(0, 0, grid));
      expect(fill.preview()).toEqual([{ x: 0, y: 0, state: 1 }]); // (1,1) is not reached
    });

    it('is a no-op when the seed cell is already the target paint state', () => {
      const grid = uniformGrid(1);
      const fill = new FillTool({ state: 1 });
      fill.onDown(ctxAt(0, 0, grid));
      expect(fill.preview()).toHaveLength(0);
      expect(fill.capped).toBe(false);
    });

    it('is a no-op (and never throws) when no grid is supplied', () => {
      const fill = new FillTool({ state: 1 });
      expect(() => fill.onDown(ctxAt(0, 0))).not.toThrow();
      expect(fill.preview()).toHaveLength(0);
    });
  });

  describe('the 1,000,000-cell cap', () => {
    it('a bounded region of exactly 1,000,000 cells either fills completely or prompts, always in well under 500ms', () => {
      // The acceptance criterion is explicitly an "or": at this scale a Set-keyed scanline
      // fill's own dedup bookkeeping (not this algorithm's shape) costs enough that a slower or
      // noisier machine legitimately trips the wall-clock backstop before finishing — and that
      // is a *correct*, sanctioned outcome here, not a failure. What must always hold: it never
      // exceeds the cap, it never overshoots the time budget, and completing without capping
      // means it truly found every cell.
      const SIZE = 1000; // 1000 x 1000 = 1,000,000 cells
      const grid = fakeGrid((x, y) => (x >= 0 && x < SIZE && y >= 0 && y < SIZE ? 0 : 2));

      // Warm-up run, un-timed, so the measurement reflects steady-state cost.
      new FillTool({ state: 1 }).onDown(ctxAt(0, 0, grid));

      const fill = new FillTool({ state: 1 });
      const start = performance.now();
      fill.onDown(ctxAt(500, 500, grid));
      const elapsedMs = performance.now() - start;

      expect(fill.preview().length).toBeLessThanOrEqual(DEFAULT_FILL_CAP);
      if (fill.capped) {
        expect(fill.preview().length).toBeLessThan(SIZE * SIZE);
      } else {
        expect(fill.preview()).toHaveLength(SIZE * SIZE); // uncapped must mean truly complete
      }
      if (!UNDER_COVERAGE) expect(elapsedMs).toBeLessThan(500);
    });

    it('an unbounded same-state field is capped at DEFAULT_FILL_CAP and never blocks past it', () => {
      const grid = uniformGrid(0); // every cell is state 0, forever, in every direction

      new FillTool({ state: 1 }).onDown(ctxAt(0, 0, grid)); // warm-up

      const fill = new FillTool({ state: 1 });
      const start = performance.now();
      fill.onDown(ctxAt(0, 0, grid));
      const elapsedMs = performance.now() - start;

      expect(fill.capped).toBe(true);
      expect(fill.preview().length).toBeLessThanOrEqual(DEFAULT_FILL_CAP);
      expect(fill.preview().length).toBeGreaterThan(0);
      if (!UNDER_COVERAGE) expect(elapsedMs).toBeLessThan(500);
    });

    it('a custom (smaller) cap is honoured', () => {
      const grid = uniformGrid(0);
      const fill = new FillTool({ state: 1, cap: 500 });
      fill.onDown(ctxAt(0, 0, grid));
      expect(fill.capped).toBe(true);
      expect(fill.preview().length).toBeLessThanOrEqual(500);
    });

    it('the wall-clock backstop caps a fill on its own, deterministically, via an injected clock', () => {
      // A fake Clock that reports the deadline as already passed from the very first check —
      // proving the time backstop itself works, independent of how many cells a real timing
      // race would happen to reach first.
      let calls = 0;
      const clock: Clock = {
        now: () => {
          calls++;
          return calls === 1 ? 0 : 1_000_000; // deadline computed from call 1, blown by call 2
        },
      };
      const grid = uniformGrid(0);
      const fill = new FillTool({ state: 1, clock, timeoutMs: 10 });
      fill.onDown(ctxAt(0, 0, grid));
      expect(fill.capped).toBe(true);
      expect(fill.preview().length).toBeGreaterThan(0);
      expect(fill.preview().length).toBeLessThan(DEFAULT_FILL_CAP); // stopped well short of the cell cap
    });
  });

  describe('stroke lifecycle', () => {
    it('onMove does not change what would be filled (fill commits from the down-point only)', () => {
      const grid = fakeGrid((x, y) => (x >= 0 && x < 3 && y >= 0 && y < 3 ? 0 : 2));
      const fill = new FillTool({ state: 1 });
      fill.onDown(ctxAt(1, 1, grid));
      const before = fill.preview();
      fill.onMove();
      expect(fill.preview()).toEqual(before);
    });

    it('onUp returns the computed ops and resets for the next fill', () => {
      const grid = fakeGrid((x, y) => (x >= 0 && x < 3 && y >= 0 && y < 3 ? 0 : 2));
      const fill = new FillTool({ state: 1 });
      fill.onDown(ctxAt(1, 1, grid));
      const ops = fill.onUp();
      expect(ops).toHaveLength(9);
      expect(fill.preview()).toHaveLength(0);
    });

    it('onCancel discards the computed fill and clears capped, with no return value', () => {
      const grid = uniformGrid(0);
      const fill = new FillTool({ state: 1 });
      fill.onDown(ctxAt(0, 0, grid));
      expect(fill.capped).toBe(true);
      expect(fill.onCancel()).toBeUndefined();
      expect(fill.preview()).toHaveLength(0);
      expect(fill.capped).toBe(false);
    });
  });
});
