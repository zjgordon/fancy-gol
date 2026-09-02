import { describe, expect, it } from 'vitest';
import { Mulberry32 } from '@engine/rng';
import { DEAD } from '@engine/types';
import { CHUNK_AREA, CHUNK_SIZE } from '@engine/grid/coords';
import {
  BORDER_E,
  BORDER_N,
  BORDER_NE,
  BORDER_NW,
  BORDER_S,
  BORDER_SE,
  BORDER_SW,
  BORDER_W,
  Chunk,
} from '@engine/grid/chunk';

function bruteForceCounts(data: Uint8Array): { population: number; perState: Uint32Array } {
  const perState = new Uint32Array(256);
  let population = 0;
  for (const state of data) {
    perState[state] = (perState[state] ?? 0) + 1;
    if (state !== DEAD) population += 1;
  }
  return { population, perState };
}

function bruteForceBorderMask(data: Uint8Array): number {
  const last = CHUNK_SIZE - 1;
  const rowHasLive = (row: number) =>
    Array.from({ length: CHUNK_SIZE }, (_, x) => data[row * CHUNK_SIZE + x]).some(
      (s) => s !== DEAD,
    );
  const colHasLive = (col: number) =>
    Array.from({ length: CHUNK_SIZE }, (_, y) => data[y * CHUNK_SIZE + col]).some(
      (s) => s !== DEAD,
    );
  let mask = 0;
  if (rowHasLive(0)) mask |= BORDER_N;
  if (rowHasLive(last)) mask |= BORDER_S;
  if (colHasLive(0)) mask |= BORDER_W;
  if (colHasLive(last)) mask |= BORDER_E;
  if (data[0] !== DEAD) mask |= BORDER_NW;
  if (data[last] !== DEAD) mask |= BORDER_NE;
  if (data[last * CHUNK_SIZE] !== DEAD) mask |= BORDER_SW;
  if (data[CHUNK_AREA - 1] !== DEAD) mask |= BORDER_SE;
  return mask;
}

describe('Chunk', () => {
  it('starts fully dead: population 0, perState[DEAD] === CHUNK_AREA', () => {
    const chunk = Chunk.acquire();
    expect(chunk.population).toBe(0);
    expect(chunk.perState[DEAD]).toBe(CHUNK_AREA);
    expect(chunk.borderMask).toBe(0);
  });

  it('counters after 10,000 random sets exactly match a brute-force recount', () => {
    const chunk = Chunk.acquire();
    const rng = new Mulberry32(0x1234);
    for (let i = 0; i < 10_000; i++) {
      const idx = rng.nextInt(CHUNK_AREA);
      const state = rng.nextInt(10);
      chunk.set(idx, state);
    }

    const expected = bruteForceCounts(chunk.data);
    expect(chunk.population).toBe(expected.population);
    for (let s = 0; s < 10; s++) {
      expect(chunk.perState[s]).toBe(expected.perState[s]);
    }
  });

  it('borderMask matches a brute-force edge scan across 1,000 random fillings', () => {
    for (let trial = 0; trial < 1000; trial++) {
      const chunk = Chunk.acquire();
      const rng = new Mulberry32(trial + 1);
      const writes = rng.nextInt(20) + 1;
      for (let i = 0; i < writes; i++) {
        chunk.set(rng.nextInt(CHUNK_AREA), rng.nextInt(3));
      }
      expect(chunk.borderMask).toBe(bruteForceBorderMask(chunk.data));
      Chunk.release(chunk);
    }
  });

  it('write() + rebuildBorderMask() matches set() for a burst of fills', () => {
    const rng = new Mulberry32(0x99);
    const viaSet = Chunk.acquire();
    const viaWrite = Chunk.acquire();
    for (let i = 0; i < 80; i++) {
      const idx = rng.nextInt(CHUNK_AREA);
      const state = rng.nextInt(3);
      viaSet.set(idx, state);
      viaWrite.write(idx, state);
    }
    viaWrite.rebuildBorderMask();
    expect(viaWrite.population).toBe(viaSet.population);
    expect(viaWrite.borderMask).toBe(viaSet.borderMask);
    expect(viaWrite.borderMask).toBe(bruteForceBorderMask(viaWrite.data));
    Chunk.release(viaSet);
    Chunk.release(viaWrite);
  });

  it('a no-op set (same state) does not touch counters or dirty', () => {
    const chunk = Chunk.acquire();
    chunk.set(5, 0);
    expect(chunk.dirty).toBe(false);
    expect(chunk.population).toBe(0);
  });

  it('a released-and-reacquired chunk is fully zeroed', () => {
    const chunk = Chunk.acquire();
    chunk.set(0, 1);
    chunk.set(CHUNK_AREA - 1, 2);
    expect(chunk.population).toBeGreaterThan(0);
    Chunk.release(chunk);

    const reused = Chunk.acquire();
    expect(reused.population).toBe(0);
    expect(reused.dirty).toBe(false);
    expect(reused.lastTick).toBe(0);
    expect(reused.borderMask).toBe(0);
    expect(reused.perState[DEAD]).toBe(CHUNK_AREA);
    for (const byte of reused.data) {
      expect(byte).toBe(DEAD);
    }
  });

  it('at() reads without mutating', () => {
    const chunk = Chunk.acquire();
    chunk.set(42, 7);
    expect(chunk.at(42)).toBe(7);
    expect(chunk.at(43)).toBe(DEAD);
  });

  it('load() copies a page and rebuilds counters to match a brute-force recount', () => {
    const src = Chunk.acquire();
    src.set(0, 1);
    src.set(31, 2);
    src.set(CHUNK_AREA - 1, 1);
    const dst = Chunk.acquire();
    dst.load(src.data);
    expect(dst.population).toBe(src.population);
    expect(dst.borderMask).toBe(src.borderMask);
    expect(dst.data).toEqual(src.data);
    expect(dst.perState[1]).toBe(2);
    expect(dst.perState[2]).toBe(1);
    expect(() => dst.load(new Uint8Array(8))).toThrow(/1024/);
    Chunk.release(src);
    Chunk.release(dst);
  });
});
