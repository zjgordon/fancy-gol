import { describe, expect, it } from 'vitest';
import { packChunk } from '@engine/grid/coords';
import { CHUNK_AREA, DEAD, localIndex } from '@shared/types';
import type { TransferredChunks } from '@shared/protocol';
import { FrameGridMirror } from '@worker/frame-view';

function onePageChunks(cx: number, cy: number, cells: ReadonlyArray<readonly [number, number, number]>): TransferredChunks {
  const data = new Uint8Array(CHUNK_AREA);
  const originX = cx * 32;
  const originY = cy * 32;
  for (const [x, y, state] of cells) data[localIndex(x - originX, y - originY)] = state;
  return { keys: new Int32Array([packChunk(cx, cy)]), data };
}

describe('FrameGridMirror', () => {
  it('starts empty: DEAD everywhere, no chunks, zero-size bounds', () => {
    const mirror = new FrameGridMirror();
    const view = mirror.view();
    expect(view.get(5, 5)).toBe(DEAD);
    expect(view.getChunk(0, 0)).toBeUndefined();
    expect(view.bounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    let visited = 0;
    view.forEachChunkInRect({ x: 0, y: 0, width: 64, height: 64 }, () => (visited += 1));
    expect(visited).toBe(0);
  });

  it('reflects an applied chunk: get(), getChunk(), forEachChunkInRect(), bounds()', () => {
    const mirror = new FrameGridMirror();
    mirror.applyChunks(
      onePageChunks(0, 0, [
        [3, 3, 1],
        [4, 3, 1],
      ]),
    );
    const view = mirror.view();

    expect(view.get(3, 3)).toBe(1);
    expect(view.get(4, 3)).toBe(1);
    expect(view.get(5, 3)).toBe(DEAD);
    expect(view.get(3, 3 + 32)).toBe(DEAD); // a different, never-applied chunk

    const chunk = view.getChunk(0, 0);
    expect(chunk?.cx).toBe(0);
    expect(chunk?.cy).toBe(0);
    expect(chunk?.population).toBe(2);
    expect(chunk?.at(localIndex(3, 3))).toBe(1);

    const visited: Array<readonly [number, number]> = [];
    view.forEachChunkInRect({ x: 0, y: 0, width: 64, height: 64 }, (c) => visited.push([c.cx, c.cy]));
    expect(visited).toEqual([[0, 0]]);

    expect(view.bounds()).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  describe('pageCount', () => {
    it('starts at zero and counts distinct chunk pages (P1-D-3\'s memory-estimate basis)', () => {
      const mirror = new FrameGridMirror();
      expect(mirror.pageCount).toBe(0);

      mirror.applyChunks(onePageChunks(0, 0, [[1, 1, 1]]));
      expect(mirror.pageCount).toBe(1);

      mirror.applyChunks(onePageChunks(1, 0, [[33, 1, 2]]));
      expect(mirror.pageCount).toBe(2);

      mirror.applyChunks(onePageChunks(0, 0, [[1, 1, 3]])); // same key again — not a new page
      expect(mirror.pageCount).toBe(2);

      mirror.reset();
      expect(mirror.pageCount).toBe(0);
    });
  });

  it('a later applyChunks() for the same key replaces that chunk, leaving others untouched', () => {
    const mirror = new FrameGridMirror();
    mirror.applyChunks(onePageChunks(0, 0, [[1, 1, 1]]));
    mirror.applyChunks(onePageChunks(1, 0, [[33, 1, 2]])); // a second, distinct chunk
    mirror.applyChunks(onePageChunks(0, 0, [[1, 1, 3]])); // replaces chunk (0,0)'s contents

    const view = mirror.view();
    expect(view.get(1, 1)).toBe(3); // updated
    expect(view.get(33, 1)).toBe(2); // untouched by the (0,0) update
    expect(view.bounds()).toEqual({ x: 0, y: 0, width: 64, height: 32 });
  });

  it('forEachChunkInRect only visits chunks that intersect the requested rect', () => {
    const mirror = new FrameGridMirror();
    mirror.applyChunks(onePageChunks(0, 0, [[1, 1, 1]]));
    mirror.applyChunks(onePageChunks(5, 5, [[161, 161, 1]]));

    const view = mirror.view();
    const visited: Array<readonly [number, number]> = [];
    view.forEachChunkInRect({ x: 0, y: 0, width: 32, height: 32 }, (c) => visited.push([c.cx, c.cy]));
    expect(visited).toEqual([[0, 0]]);
  });

  it('reset() discards every mirrored chunk, leaving the view back to its empty starting state', () => {
    const mirror = new FrameGridMirror();
    mirror.applyChunks(onePageChunks(0, 0, [[1, 1, 1]]));
    mirror.applyChunks(onePageChunks(5, 5, [[161, 161, 1]]));

    mirror.reset();

    const view = mirror.view();
    expect(view.get(1, 1)).toBe(DEAD);
    expect(view.getChunk(0, 0)).toBeUndefined();
    expect(view.bounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });

    // A frame applied after reset() starts from a clean slate, not merged with the discarded state.
    mirror.applyChunks(onePageChunks(2, 2, [[65, 65, 4]]));
    expect(view.get(65, 65)).toBe(4);
    expect(view.getChunk(0, 0)).toBeUndefined();
  });

  describe('per-chunk views (P3-E-8: the branches the render path takes every frame)', () => {
    it('reports age 0 for a chunk that arrived without an age page', () => {
      const mirror = new FrameGridMirror();
      mirror.applyChunks(onePageChunks(0, 0, [[3, 3, 1]]));
      const chunk = mirror.view().getChunk(0, 0)!;
      expect(chunk.age?.(localIndex(3, 3))).toBe(0);
    });

    it('returns the shipped ages when the frame carries them, and forgets them when a later frame does not', () => {
      const mirror = new FrameGridMirror();
      const withAges = onePageChunks(0, 0, [[3, 3, 1]]);
      const ages = new Uint16Array(CHUNK_AREA);
      ages[localIndex(3, 3)] = 42;
      mirror.applyChunks({ ...withAges, ages });
      expect(mirror.view().getChunk(0, 0)!.age?.(localIndex(3, 3))).toBe(42);

      mirror.applyChunks(onePageChunks(0, 0, [[3, 3, 1]])); // age tracking switched off
      expect(mirror.view().getChunk(0, 0)!.age?.(localIndex(3, 3))).toBe(0);
    });

    it('tracks the live extent in every direction, whichever cell is scanned first', () => {
      const mirror = new FrameGridMirror();
      // Scanned row-major: (15,3) first, then (10,20), (5,25), (8,28) — each pulls a different edge.
      mirror.applyChunks(
        onePageChunks(0, 0, [
          [15, 3, 1],
          [10, 20, 1],
          [5, 25, 1],
          [8, 28, 1],
        ]),
      );
      const chunk = mirror.view().getChunk(0, 0)!;
      expect(chunk.population).toBe(4);
      expect([chunk.liveMinX, chunk.liveMaxX, chunk.liveMinY, chunk.liveMaxY]).toEqual([5, 15, 3, 28]);
    });

    it('bounds span chunks lying in every direction from the first one applied', () => {
      const mirror = new FrameGridMirror();
      mirror.applyChunks(onePageChunks(1, 1, [[40, 40, 1]]));
      mirror.applyChunks(onePageChunks(-2, 3, [[-60, 100, 1]])); // further left and further down
      mirror.applyChunks(onePageChunks(3, -1, [[100, -20, 1]])); // further right and further up
      // chunks x -2..3 → 6 wide, y -1..3 → 5 tall, anchored at chunk (-2,-1) = world (-64,-32)
      expect(mirror.view().bounds()).toEqual({ x: -64, y: -32, width: 6 * 32, height: 5 * 32 });
    });
  });
});
