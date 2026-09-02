import { describe, expect, it } from 'vitest';
import { Mulberry32 } from '@engine/rng';
import { DirtyAccumulator, mergeDirtyRects, unionToRects } from '@render/dirty';
import type { Rect } from '@shared/types';

function randomRect(rng: Mulberry32, maxCoord: number, maxSize: number): Rect {
  return {
    x: rng.nextInt(maxCoord),
    y: rng.nextInt(maxCoord),
    width: 1 + rng.nextInt(maxSize),
    height: 1 + rng.nextInt(maxSize),
  };
}

/** Marks every cell any rect covers, clamped to a `size × size` grid. */
function rasterize(rects: readonly Rect[], size: number): Uint8Array {
  const grid = new Uint8Array(size * size);
  for (const r of rects) {
    const x0 = Math.max(0, r.x);
    const x1 = Math.min(size, r.x + r.width);
    const y0 = Math.max(0, r.y);
    const y1 = Math.min(size, r.y + r.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) grid[y * size + x] = 1;
    }
  }
  return grid;
}

describe('unionToRects: merge correctness property (P0-H-1 acceptance)', () => {
  it('covers exactly the same cell set as the input, for 10,000 random inputs', { timeout: 30_000 }, () => {
    const rng = new Mulberry32(0xd177_face);
    const SIZE = 24;
    for (let trial = 0; trial < 10_000; trial++) {
      const count = 1 + rng.nextInt(8);
      const rects: Rect[] = [];
      for (let i = 0; i < count; i++) rects.push(randomRect(rng, SIZE - 4, 5));

      const merged = unionToRects(rects);
      const before = rasterize(rects, SIZE);
      const after = rasterize(merged, SIZE);
      // Manual comparison so the (expensive) assertion machinery only runs on an actual
      // mismatch — 10,000 vitest deep-equal calls dominate this test's runtime otherwise.
      let same = before.length === after.length;
      for (let i = 0; same && i < before.length; i++) same = before[i] === after[i];
      if (!same) {
        expect(after, `trial ${trial}: rects=${JSON.stringify(rects)}, merged=${JSON.stringify(merged)}`).toEqual(before);
      }
    }
  });

  it('an empty input merges to an empty (not null) list', () => {
    expect(unionToRects([])).toEqual([]);
  });

  it('zero-area rects contribute nothing', () => {
    expect(unionToRects([{ x: 0, y: 0, width: 0, height: 5 }])).toEqual([]);
  });

  it('merges two edge-adjacent rects into one', () => {
    const merged = unionToRects([
      { x: 0, y: 0, width: 32, height: 32 },
      { x: 32, y: 0, width: 32, height: 32 },
    ]);
    expect(merged).toEqual([{ x: 0, y: 0, width: 64, height: 32 }]);
  });

  it('merges an overlapping pair without double-covering the overlap', () => {
    const merged = unionToRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 0, width: 10, height: 10 },
    ]);
    const before = rasterize(
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 0, width: 10, height: 10 },
      ],
      20,
    );
    expect(rasterize(merged, 20)).toEqual(before);
  });

  it('leaves two disjoint, non-adjacent rects separate', () => {
    const merged = unionToRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100, y: 100, width: 10, height: 10 },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('mergeDirtyRects: full-repaint fallback (P0-H-1 acceptance)', () => {
  it('returns a merged list when combined area is just under the ~60% threshold', () => {
    const viewport: Rect = { x: 0, y: 0, width: 100, height: 100 }; // area 10,000
    const result = mergeDirtyRects([{ x: 0, y: 0, width: 100, height: 59 }], { viewport }); // 5,900 = 59%
    expect(result).not.toBeNull();
    expect(result).toEqual([{ x: 0, y: 0, width: 100, height: 59 }]);
  });

  it('gives up and returns null once combined area exceeds the ~60% threshold', () => {
    const viewport: Rect = { x: 0, y: 0, width: 100, height: 100 }; // area 10,000
    const result = mergeDirtyRects([{ x: 0, y: 0, width: 100, height: 61 }], { viewport }); // 6,100 = 61%
    expect(result).toBeNull();
  });

  it('the threshold is configurable via giveUpFraction', () => {
    const viewport: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const rects = [{ x: 0, y: 0, width: 100, height: 30 }]; // 30%
    expect(mergeDirtyRects(rects, { viewport })).not.toBeNull(); // under the 60% default
    expect(mergeDirtyRects(rects, { viewport, giveUpFraction: 0.2 })).toBeNull(); // over a 20% cap
  });

  it('gives up when there are simply too many rects, regardless of area', () => {
    const viewport: Rect = { x: 0, y: 0, width: 1_000_000, height: 1_000_000 }; // area fraction is negligible
    const rects: Rect[] = Array.from({ length: 4097 }, (_, i) => ({ x: i, y: 0, width: 1, height: 1 }));
    expect(mergeDirtyRects(rects, { viewport })).toBeNull();
  });

  it('an empty input merges to an empty list, never null', () => {
    const viewport: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(mergeDirtyRects([], { viewport })).toEqual([]);
  });
});

describe('DirtyAccumulator', () => {
  it('accumulates across multiple add() calls, merging only at take()', () => {
    const acc = new DirtyAccumulator({ x: 0, y: 0, width: 1000, height: 1000 });
    acc.add([{ x: 0, y: 0, width: 10, height: 10 }]);
    acc.add([{ x: 10, y: 0, width: 10, height: 10 }]);
    expect(acc.take()).toEqual([{ x: 0, y: 0, width: 20, height: 10 }]);
  });

  it('clears the accumulated set after take()', () => {
    const acc = new DirtyAccumulator({ x: 0, y: 0, width: 1000, height: 1000 });
    acc.add([{ x: 0, y: 0, width: 10, height: 10 }]);
    acc.take();
    expect(acc.take()).toEqual([]);
  });

  it('setViewport changes the basis the give-up heuristic compares against', () => {
    const acc = new DirtyAccumulator({ x: 0, y: 0, width: 10, height: 10 }); // area 100
    acc.add([{ x: 0, y: 0, width: 10, height: 7 }]); // area 70 = 70% > 60%
    expect(acc.take()).toBeNull();

    acc.setViewport({ x: 0, y: 0, width: 1000, height: 1000 });
    acc.add([{ x: 0, y: 0, width: 10, height: 7 }]); // now a negligible fraction
    expect(acc.take()).not.toBeNull();
  });
});
