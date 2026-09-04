import { describe, expect, it } from 'vitest';
import { Mulberry32 } from '@engine/rng';
import { DEAD, type GridView, type PaintOp, type StateId } from '@shared/types';
import type { ToolPoint } from '@ui/input/router';
import {
  SelectTool,
  decodeRLE,
  encodeRLE,
  flipHorizontal,
  flipVertical,
  rotate90,
  type ClipboardPattern,
  type SystemClipboard,
} from '@ui/tools/select';
import type { ToolContext } from '@ui/tools/tool';

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

function fakeGrid(get: (x: number, y: number) => StateId): GridView {
  return { boundary: 'infinite', get } as unknown as GridView;
}

/** A GridView backed by a plain dense array, for tests that need a real, mutable-by-inspection grid. */
function denseGridView(width: number, height: number, cells: readonly StateId[]): GridView {
  return fakeGrid((x, y) => (x >= 0 && x < width && y >= 0 && y < height ? cells[y * width + x]! : DEAD));
}

function sortOps(ops: readonly PaintOp[]): PaintOp[] {
  return [...ops].sort((a, b) => a.x - b.x || a.y - b.y);
}

function applyOps(width: number, height: number, ops: readonly PaintOp[], originX = 0, originY = 0): StateId[] {
  const dense = new Array<StateId>(width * height).fill(DEAD);
  for (const op of ops) {
    const x = op.x - originX;
    const y = op.y - originY;
    if (x >= 0 && x < width && y >= 0 && y < height) dense[y * width + x] = op.state;
  }
  return dense;
}

describe('SelectTool', () => {
  describe('marquee selection', () => {
    it('drags out a normalised rectangle regardless of drag direction, and captures its contents on release', () => {
      const grid = fakeGrid((x, y) => (x === 2 && y === 3 ? 1 : DEAD));
      const select = new SelectTool();

      select.onDown(ctxAt(5, 5, grid));
      select.onMove(ctxAt(1, 2, grid)); // dragging up-and-left
      expect(select.marqueeRect).toEqual({ x: 1, y: 2, width: 5, height: 4 });
      expect(select.preview()).toHaveLength(0); // a marquee never paints anything

      const ops = select.onUp(ctxAt(1, 2, grid));
      expect(ops).toHaveLength(0);
      expect(select.marqueeRect).toBeNull();
      expect(select.selectedRect).toEqual({ x: 1, y: 2, width: 5, height: 4 });
    });

    it('does not finalise a selection when no grid is supplied (nothing to capture)', () => {
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0));
      select.onUp(ctxAt(2, 2));
      expect(select.selectedRect).toBeNull();
    });

    it('a new marquee replaces the previous finalised selection only once it completes, not on down', () => {
      const grid = fakeGrid(() => 1);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(1, 1, grid));
      const first = select.selectedRect;
      expect(first).not.toBeNull();

      select.onDown(ctxAt(5, 5, grid));
      expect(select.selectedRect).toEqual(first); // still visible mid-drag, not pre-emptively cleared

      select.onUp(ctxAt(6, 6, grid));
      expect(select.selectedRect).toEqual({ x: 5, y: 5, width: 2, height: 2 }); // now replaced
    });

    it('onCancel discards an in-progress marquee but preserves a prior finalised selection', () => {
      const grid = fakeGrid(() => 1);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(1, 1, grid));
      const preserved = select.selectedRect;

      select.onDown(ctxAt(5, 5, grid));
      select.onMove(ctxAt(8, 8, grid));
      expect(select.onCancel()).toBeUndefined();
      expect(select.marqueeRect).toBeNull();
      expect(select.selectedRect).toEqual(preserved);
    });
  });

  describe('copy / cut / delete', () => {
    it('copy populates the buffer without altering the grid', () => {
      const grid = fakeGrid((x, y) => (x === 0 && y === 0 ? 2 : DEAD));
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(1, 1, grid));
      select.copy();

      select.paste();
      const ops = select.preview();
      expect(ops.some((o) => o.state === 2)).toBe(true);
    });

    it('cut returns ops that clear the selection and also populates the buffer', () => {
      const grid = fakeGrid(() => 1);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(1, 1, grid)); // 2x2 selection

      const clearing = select.cut();
      expect(sortOps(clearing)).toEqual(
        sortOps([
          { x: 0, y: 0, state: DEAD },
          { x: 1, y: 0, state: DEAD },
          { x: 0, y: 1, state: DEAD },
          { x: 1, y: 1, state: DEAD },
        ]),
      );

      select.paste();
      expect(select.preview().every((o) => o.state === 1)).toBe(true);
    });

    it('delete clears the selection without touching the buffer', () => {
      const grid = fakeGrid(() => 3);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(0, 0, grid));
      select.copy(); // buffer now holds state 3

      const clearing = select.delete();
      expect(clearing).toEqual([{ x: 0, y: 0, state: DEAD }]);

      select.paste();
      expect(select.preview()).toEqual([{ x: 0, y: 0, state: 3 }]); // buffer untouched by delete
    });

    it('copy/cut/delete are safe no-ops with nothing selected', () => {
      const select = new SelectTool();
      expect(select.cut()).toEqual([]);
      expect(select.delete()).toEqual([]);
      expect(() => select.copy()).not.toThrow();
      select.paste(); // no buffer either -> stays idle
      expect(select.preview()).toHaveLength(0);
    });
  });

  describe('paste placement', () => {
    it('placement overwrites the full bounding box, dead gaps included, not just the live cells', () => {
      // A single live cell in a 2x2 selection; the other three must be explicitly cleared.
      const grid = fakeGrid((x, y) => (x === 0 && y === 0 ? 1 : DEAD));
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(1, 1, grid));
      select.copy();
      select.paste();

      select.onDown(ctxAt(10, 10)); // click to place
      const ops = select.onUp(ctxAt(10, 10));
      expect(sortOps(ops)).toEqual(
        sortOps([
          { x: 10, y: 10, state: 1 },
          { x: 11, y: 10, state: DEAD },
          { x: 10, y: 11, state: DEAD },
          { x: 11, y: 11, state: DEAD },
        ]),
      );
      expect(select.preview()).toHaveLength(0); // placement finalised, ghost cleared
    });

    it('the ghost preview follows onMove while placing, and locks to the click position on placement', () => {
      const grid = fakeGrid(() => 1);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(0, 0, grid));
      select.copy();
      select.paste();

      select.onMove(ctxAt(20, 20));
      expect(select.preview()).toEqual([{ x: 20, y: 20, state: 1 }]);

      select.onDown(ctxAt(30, 30));
      expect(select.preview()).toEqual([{ x: 30, y: 30, state: 1 }]); // locked to the click, not the last hover
    });

    it('onCancel while placing discards the pending placement with no return value', () => {
      const grid = fakeGrid(() => 1);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(0, 0, grid));
      select.copy();
      select.paste();
      select.onDown(ctxAt(5, 5));

      expect(select.onCancel()).toBeUndefined();
      expect(select.preview()).toHaveLength(0);
    });

    it('move cuts the selection and re-enters placement with the cut content', () => {
      const grid = fakeGrid(() => 2);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(0, 0, grid));

      const clearing = select.move();
      expect(clearing).toEqual([{ x: 0, y: 0, state: DEAD }]);
      expect(select.preview()).toEqual([{ x: 0, y: 0, state: 2 }]); // placement anchor defaults to the old rect
    });
  });

  describe('rotate / flip', () => {
    it('rotate90, flipHorizontal, and flipVertical are pure geometric transforms (unit shapes)', () => {
      const p: ClipboardPattern = { width: 2, height: 3, cells: [{ x: 0, y: 0, state: 1 }] }; // top-left corner
      expect(rotate90(p)).toEqual({ width: 3, height: 2, cells: [{ x: 2, y: 0, state: 1 }] }); // -> top-right
      expect(flipHorizontal(p)).toEqual({ width: 2, height: 3, cells: [{ x: 1, y: 0, state: 1 }] });
      expect(flipVertical(p)).toEqual({ width: 2, height: 3, cells: [{ x: 0, y: 2, state: 1 }] });
    });

    it('rotate/flip on the tool transform the buffer in place, and are safe no-ops with an empty buffer', () => {
      const grid = fakeGrid((x, y) => (x === 0 && y === 0 ? 1 : DEAD));
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(1, 0, grid)); // 2x1 selection, live cell at local (0,0)
      select.copy();

      select.rotate();
      select.paste();
      // 2x1 rotated -> 1x2; the live corner cell rotates to (0,0) in the new shape too here.
      expect(select.preview()).toEqual([
        { x: 0, y: 0, state: 1 },
        { x: 0, y: 1, state: DEAD },
      ]);

      const empty = new SelectTool();
      expect(() => {
        empty.rotate();
        empty.flipHorizontally();
        empty.flipVertically();
      }).not.toThrow();
    });
  });

  describe('the RLE codec', () => {
    it('round-trips a hand-built multi-state pattern with dead gaps and a fully blank row', () => {
      const pattern: ClipboardPattern = {
        width: 4,
        height: 3,
        cells: [
          { x: 0, y: 0, state: 1 },
          { x: 2, y: 0, state: 1 },
          { x: 1, y: 2, state: 3 }, // exercises the 'A'-'X' multi-state range (state 3 -> 'B')
        ],
      };
      const rle = encodeRLE(pattern);
      expect(decodeRLE(rle)).toEqual(pattern);
    });

    it('round-trips an empty (all-dead) pattern', () => {
      const pattern: ClipboardPattern = { width: 3, height: 2, cells: [] };
      expect(decodeRLE(encodeRLE(pattern))).toEqual(pattern);
    });

    it('rejects a state outside the 0-24 range with a clear error, not silent corruption', () => {
      const pattern: ClipboardPattern = { width: 1, height: 1, cells: [{ x: 0, y: 0, state: 99 }] };
      expect(() => encodeRLE(pattern)).toThrow(/0-24/);
    });
  });

  describe('the system clipboard (Ctrl/Cmd+C)', () => {
    it('writes valid RLE to the system clipboard, and pasting that RLE back reproduces the pattern', async () => {
      const grid = fakeGrid((x, y) => {
        if (x === 0 && y === 0) return 1;
        if (x === 3 && y === 1) return 1;
        if (x === 1 && y === 2) return 2;
        return DEAD;
      });
      let written: string | undefined;
      const clipboard: SystemClipboard = { writeText: (text) => Promise.resolve(void (written = text)) };
      const select = new SelectTool({ clipboard });

      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(3, 2, grid)); // 4x3 selection covering all three live cells
      await select.writeSystemClipboard();

      expect(written).toBeDefined();
      expect(written).toMatch(/^x = 4, y = 3/);

      select.pasteFromRLE(written!);
      select.onDown(ctxAt(100, 100));
      const ops = select.onUp(ctxAt(100, 100));
      const placed = new Map(ops.map((o) => [`${o.x - 100},${o.y - 100}`, o.state]));
      expect(placed.get('0,0')).toBe(1);
      expect(placed.get('3,1')).toBe(1);
      expect(placed.get('1,2')).toBe(2);
    });

    it('is a no-op with nothing selected, even without a clipboard available', async () => {
      // No `clipboard` option given, and jsdom provides no `navigator.clipboard` of its own —
      // this exercises the same "no clipboard in this environment" path a Node/jsdom test
      // naturally lands in, without needing to fight `exactOptionalPropertyTypes` to say so.
      const select = new SelectTool();
      await expect(select.writeSystemClipboard()).resolves.toBeUndefined();
    });

    it('throws a clear error when a selection exists but no system clipboard is available', async () => {
      const grid = fakeGrid(() => 1);
      const select = new SelectTool();
      select.onDown(ctxAt(0, 0, grid));
      select.onUp(ctxAt(0, 0, grid));
      await expect(select.writeSystemClipboard()).rejects.toThrow(/clipboard/i);
    });
  });

  describe('property: copy -> rotate -> paste is exact for random asymmetric 16x16 blocks', () => {
    it('matches an independently-computed 90-degree rotation, over 200 random patterns', () => {
      const SIZE = 16;
      const rng = new Mulberry32(0x51ec7ed0);

      for (let trial = 0; trial < 200; trial++) {
        const source = new Array<StateId>(SIZE * SIZE).fill(DEAD);
        for (let i = 0; i < source.length; i++) {
          // Sparse-ish random fill (30% live) across 4 possible states -> almost certainly
          // asymmetric, and exercises more than just a single on/off state.
          if (rng.next() < 0.3) source[i] = 1 + Math.floor(rng.next() * 3); // states 1..3
        }

        // Independently rotate the dense source 90deg clockwise (a fresh nested loop, not a
        // reuse of select.ts's own rotate90 — a genuine cross-check on the geometry).
        const expected = new Array<StateId>(SIZE * SIZE).fill(DEAD);
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            const nx = SIZE - 1 - y;
            const ny = x;
            expected[ny * SIZE + nx] = source[y * SIZE + x]!;
          }
        }

        const grid = denseGridView(SIZE, SIZE, source);
        const select = new SelectTool();
        select.onDown(ctxAt(0, 0, grid));
        select.onUp(ctxAt(SIZE - 1, SIZE - 1, grid));
        select.copy();
        select.rotate();
        select.paste();

        const ORIGIN = 1000; // place far from the source region, unambiguous coordinates
        select.onDown(ctxAt(ORIGIN, ORIGIN));
        const ops = select.onUp(ctxAt(ORIGIN, ORIGIN));
        const placed = applyOps(SIZE, SIZE, ops, ORIGIN, ORIGIN);

        expect(placed).toEqual(expected);
      }
    });
  });
});
