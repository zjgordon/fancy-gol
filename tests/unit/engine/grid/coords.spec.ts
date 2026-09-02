import { describe, expect, it } from 'vitest';
import { Mulberry32 } from '@engine/rng';
import {
  CHUNK_SIZE,
  WORLD_LIMIT,
  chunkToWorld,
  localIndex,
  normalize,
  packCell,
  packChunk,
  unpackCellX,
  unpackCellY,
  unpackChunkX,
  unpackChunkY,
  worldToChunk,
} from '@engine/grid/coords';

describe('packCell / unpackCell', () => {
  it('round-trips 100k random coordinates, including negatives', () => {
    const rng = new Mulberry32(0xabc123);
    for (let i = 0; i < 100_000; i++) {
      const x = rng.nextInt(65536) - 32768;
      const y = rng.nextInt(65536) - 32768;
      const packed = packCell(x, y);
      expect(unpackCellX(packed)).toBe(x);
      expect(unpackCellY(packed)).toBe(y);
    }
  });

  it('packs known values in the documented layout', () => {
    expect(unpackCellX(packCell(1, -1))).toBe(1);
    expect(unpackCellY(packCell(1, -1))).toBe(-1);
  });
});

describe('packChunk / unpackChunk', () => {
  it('round-trips 100k random chunk coordinates, including negatives', () => {
    const rng = new Mulberry32(0x5eed);
    for (let i = 0; i < 100_000; i++) {
      const cx = rng.nextInt(65536) - 32768;
      const cy = rng.nextInt(65536) - 32768;
      const key = packChunk(cx, cy);
      expect(unpackChunkX(key)).toBe(cx);
      expect(unpackChunkY(key)).toBe(cy);
    }
  });
});

describe('worldToChunk / chunkToWorld / localIndex', () => {
  it('floors toward -Infinity for negative cell coordinates', () => {
    expect(worldToChunk(-1, -1)).toEqual([-1, -1]);
    expect(worldToChunk(-33, 0)).toEqual([-2, 0]);
    expect(worldToChunk(31, 32)).toEqual([0, 1]);
  });

  it('chunkToWorld gives the chunk top-left cell', () => {
    expect(chunkToWorld(1, -1)).toEqual([CHUNK_SIZE, -CHUNK_SIZE]);
  });

  it('localIndex wraps into the chunk-local 32x32 grid', () => {
    expect(localIndex(0, 0)).toBe(0);
    expect(localIndex(31, 31)).toBe(1023);
    expect(localIndex(32, 32)).toBe(0); // wraps: (32 & 31) === 0
    expect(localIndex(-1, 0)).toBe(31); // (-1 & 31) === 31
  });
});

describe('normalize', () => {
  it('toroidal wraps negative coordinates correctly', () => {
    expect(normalize(-1, -1, 'toroidal', 32, 32)).toEqual([31, 31]);
  });

  it('toroidal wraps coordinates beyond the far edge', () => {
    expect(normalize(32, 32, 'toroidal', 32, 32)).toEqual([0, 0]);
  });

  it('bounded returns null outside [0, width) x [0, height)', () => {
    expect(normalize(-1, 0, 'bounded', 32, 32)).toBeNull();
    expect(normalize(32, 0, 'bounded', 32, 32)).toBeNull();
    expect(normalize(0, 0, 'bounded', 32, 32)).toEqual([0, 0]);
    expect(normalize(31, 31, 'bounded', 32, 32)).toEqual([31, 31]);
  });

  it('infinite returns the coordinate unchanged within the world limit', () => {
    expect(normalize(WORLD_LIMIT, -WORLD_LIMIT, 'infinite', 0, 0)).toEqual([
      WORLD_LIMIT,
      -WORLD_LIMIT,
    ]);
  });

  it('infinite throws, naming the limit, once WORLD_LIMIT is exceeded', () => {
    expect(() => normalize(WORLD_LIMIT + 1, 0, 'infinite', 0, 0)).toThrow(
      new RegExp(String(WORLD_LIMIT)),
    );
    expect(() => normalize(0, -(WORLD_LIMIT + 1), 'infinite', 0, 0)).toThrow(RangeError);
  });
});
