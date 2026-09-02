import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ChunkView, GridView, StateId } from '@engine/types';
import { DEAD } from '@engine/types';
import { CHUNK_SIZE, packChunk } from '@engine/grid/coords';
import { ChunkedGrid } from '@engine/grid/chunked-grid';

describe('ChunkedGrid — get/set', () => {
  it('reads back what was written, lazily allocating chunks', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    expect(grid.chunkCount).toBe(0);
    grid.set(5, 5, 1);
    expect(grid.chunkCount).toBe(1);
    expect(grid.get(5, 5)).toBe(1);
    expect(grid.get(6, 6)).toBe(DEAD);
  });

  it('does not allocate a chunk to write DEAD into empty space', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    grid.set(100, 100, DEAD);
    expect(grid.chunkCount).toBe(0);
  });

  it('bounded: writes outside [0,width)x[0,height) are dropped, reads return DEAD', () => {
    const grid = new ChunkedGrid({ boundary: 'bounded', width: 8, height: 8 });
    grid.set(-1, 0, 1);
    grid.set(8, 0, 1);
    expect(grid.chunkCount).toBe(0);
    expect(grid.get(-1, 0)).toBe(DEAD);
    expect(grid.get(8, 0)).toBe(DEAD);

    grid.set(7, 7, 2);
    expect(grid.get(7, 7)).toBe(2);
  });

  it('toroidal: a write at a wrapped coordinate reads back at the wrapped position', () => {
    const grid = new ChunkedGrid({ boundary: 'toroidal', width: 8, height: 8 });
    grid.set(-1, -1, 3);
    expect(grid.get(7, 7)).toBe(3);
  });

  it('a cell surviving as its own written state across a chunk span reads correctly', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    grid.set(0, 0, 1);
    grid.set(CHUNK_SIZE, 0, 2); // adjacent chunk
    grid.set(-1, -1, 3); // chunk to the northwest
    expect(grid.get(0, 0)).toBe(1);
    expect(grid.get(CHUNK_SIZE, 0)).toBe(2);
    expect(grid.get(-1, -1)).toBe(3);
    expect(grid.chunkCount).toBe(3);
  });
});

describe('ChunkedGrid — activeChunks', () => {
  it('marks the touched chunk and its 8 neighbours active', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    grid.set(0, 0, 1); // chunk (0,0)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(grid.activeChunks.has(packChunk(dx, dy))).toBe(true);
      }
    }
    expect(grid.activeChunks.size).toBe(9);
  });
});

describe('ChunkedGrid — empty-chunk reclamation with hysteresis', () => {
  it('fills 10k chunks, clears them, and returns map size to 0 after the hysteresis window', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite', emptyChunkHysteresis: 4 });

    for (let i = 0; i < 10_000; i++) {
      grid.set(i * CHUNK_SIZE, 0, 1);
    }
    expect(grid.chunkCount).toBe(10_000);

    grid.reclaim(0);
    for (let i = 0; i < 10_000; i++) {
      grid.set(i * CHUNK_SIZE, 0, DEAD);
    }
    expect(grid.chunkCount).toBe(10_000); // still allocated, just empty

    // Hysteresis: not freed before the window elapses.
    grid.reclaim(1);
    grid.reclaim(2);
    grid.reclaim(3);
    expect(grid.chunkCount).toBe(10_000);

    // Freed once `tick - since >= hysteresis`.
    const freed = grid.reclaim(4);
    expect(freed).toBe(10_000);
    expect(grid.chunkCount).toBe(0);
  });

  it('does not free a chunk that became live again during the hysteresis window', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite', emptyChunkHysteresis: 4 });
    grid.reclaim(0);
    grid.set(0, 0, 1);
    grid.set(0, 0, DEAD); // empty again, timestamped at tick 0
    grid.reclaim(2);
    grid.set(0, 0, 1); // alive again before the hysteresis window elapsed
    grid.reclaim(10);
    expect(grid.chunkCount).toBe(1);
    expect(grid.get(0, 0)).toBe(1);
  });
});

describe('ChunkedGrid — GridView', () => {
  it('view().get matches grid.get', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    grid.set(1, 1, 5);
    const view = grid.view();
    expect(view.get(1, 1)).toBe(5);
    expect(view.boundary).toBe('infinite');
  });

  it('getChunk / forEachChunkInRect see only allocated chunks in range, with correct population', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    grid.set(0, 0, 1);
    grid.set(1, 0, 1);
    grid.set(CHUNK_SIZE * 5, 0, 1); // far outside the rect below

    const view = grid.view();
    expect(view.getChunk(0, 0)?.population).toBe(2);
    expect(view.getChunk(5, 5)).toBeUndefined();

    const seen: Array<[number, number]> = [];
    view.forEachChunkInRect({ x: 0, y: 0, width: CHUNK_SIZE, height: CHUNK_SIZE }, (chunk) => {
      seen.push([chunk.cx, chunk.cy]);
    });
    expect(seen).toEqual([[0, 0]]);
  });

  it('bounds() covers all live chunks at chunk granularity, and is empty for an empty grid', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    expect(grid.view().bounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });

    grid.set(0, 0, 1);
    grid.set(CHUNK_SIZE, CHUNK_SIZE, 1);
    const b = grid.view().bounds();
    expect(b).toEqual({ x: 0, y: 0, width: CHUNK_SIZE * 2, height: CHUNK_SIZE * 2 });
  });

  it('the ChunkedGrid.view() return type structurally satisfies GridView', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    expectTypeOf(grid.view()).toEqualTypeOf<GridView>();
  });

  it('no GridView/ChunkView method or property exposes a mutable typed-array reference', () => {
    expectTypeOf<ChunkView['at']>().returns.toEqualTypeOf<StateId>();
    expectTypeOf<ReturnType<GridView['getChunk']>>().not.toEqualTypeOf<Uint8Array>();
  });

  it('clear() releases every chunk and leaves the grid empty', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    grid.set(0, 0, 1);
    grid.set(100, 100, 1);
    expect(grid.chunkCount).toBe(2);
    grid.clear();
    expect(grid.chunkCount).toBe(0);
    expect(grid.get(0, 0)).toBe(DEAD);
    expect(grid.activeChunks.size).toBe(0);
  });
});
