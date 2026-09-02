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
});
