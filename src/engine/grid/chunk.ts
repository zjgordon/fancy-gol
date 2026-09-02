/**
 * `Chunk` — one 32x32 page of the grid (ADR-010). Owns its own summary counters so the grid,
 * the stats collector and the Phase 5 density LOD never recount by scanning.
 */
import { DEAD, type StateId } from '../types';
import { CHUNK_AREA, CHUNK_SIZE } from './coords';

/** Bits of `Chunk.borderMask`: does this edge/corner hold at least one live cell? */
export const BORDER_N = 1 << 0;
export const BORDER_S = 1 << 1;
export const BORDER_E = 1 << 2;
export const BORDER_W = 1 << 3;
export const BORDER_NE = 1 << 4;
export const BORDER_NW = 1 << 5;
export const BORDER_SE = 1 << 6;
export const BORDER_SW = 1 << 7;

const LAST = CHUNK_SIZE - 1;

const pool: Chunk[] = [];

export class Chunk {
  readonly data = new Uint8Array(CHUNK_AREA);
  /** Count of cells per byte value 0..255 — a `StateId` is a grid byte, so 256 always fits. */
  readonly perState = new Uint32Array(256);
  /** Count of cells whose state is not {@link DEAD}. */
  population = 0;
  dirty = false;
  lastTick = 0;
  /** See the `BORDER_*` flags above. */
  borderMask = 0;

  private constructor() {
    this.reset();
  }

  /** Take a chunk from the free list, or allocate one. Always fully zeroed. */
  static acquire(): Chunk {
    return pool.pop() ?? new Chunk();
  }

  /** Return a chunk to the free list. It is zeroed immediately — no state leaks forward. */
  static release(chunk: Chunk): void {
    chunk.reset();
    pool.push(chunk);
  }

  /** Write one cell, keeping `population`, `perState` and `borderMask` correct incrementally. */
  set(localIndex: number, state: StateId): void {
    if (!this.write(localIndex, state)) return;
    const lx = localIndex & LAST;
    const ly = (localIndex >>> 5) & LAST;
    if (lx === 0 || lx === LAST || ly === 0 || ly === LAST) {
      this.refreshBorder(lx, ly);
    }
  }

  /**
   * Write one cell, updating population counters but not `borderMask`.
   * After a burst of writes, call {@link rebuildBorderMask} once.
   * Returns whether the stored byte changed.
   */
  write(localIndex: number, state: StateId): boolean {
    const old = this.data[localIndex] as StateId;
    if (old === state) return false;

    this.perState[old] = (this.perState[old] ?? 0) - 1;
    this.perState[state] = (this.perState[state] ?? 0) + 1;
    if (old === DEAD && state !== DEAD) this.population += 1;
    else if (old !== DEAD && state === DEAD) this.population -= 1;

    this.data[localIndex] = state;
    this.dirty = true;
    return true;
  }

  /** Recompute `borderMask` from the current page. O(edges), not O(writes). */
  rebuildBorderMask(): void {
    this.borderMask = 0;
    if (this.scanRow(0)) {
      this.borderMask |= BORDER_N;
      if (this.data[0] !== DEAD) this.borderMask |= BORDER_NW;
      if (this.data[LAST] !== DEAD) this.borderMask |= BORDER_NE;
    }
    if (this.scanRow(LAST)) {
      this.borderMask |= BORDER_S;
      if (this.data[LAST * CHUNK_SIZE] !== DEAD) this.borderMask |= BORDER_SW;
      if (this.data[CHUNK_AREA - 1] !== DEAD) this.borderMask |= BORDER_SE;
    }
    if (this.scanCol(0)) this.borderMask |= BORDER_W;
    if (this.scanCol(LAST)) this.borderMask |= BORDER_E;
  }

  /**
   * Replace the whole page from a snapshot slice. Rebuilds population, per-state
   * counts and the border mask in one pass — restore must not walk cells through `set`.
   */
  load(bytes: Uint8Array): void {
    if (bytes.length !== CHUNK_AREA) {
      throw new RangeError(`Chunk.load expected ${CHUNK_AREA} bytes, got ${bytes.length}`);
    }
    this.data.set(bytes);
    this.perState.fill(0);
    this.population = 0;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const s = this.data[i]!;
      this.perState[s] = (this.perState[s] ?? 0) + 1;
      if (s !== DEAD) this.population += 1;
    }
    this.dirty = true;
    this.rebuildBorderMask();
  }

  /** Read one cell without going through the grid. */
  at(localIndex: number): StateId {
    return this.data[localIndex] as StateId;
  }

  private reset(): void {
    this.data.fill(DEAD);
    this.perState.fill(0);
    this.perState[DEAD] = CHUNK_AREA;
    this.population = 0;
    this.dirty = false;
    this.lastTick = 0;
    this.borderMask = 0;
  }

  private refreshBorder(lx: number, ly: number): void {
    if (ly === 0) this.setFlag(BORDER_N, this.scanRow(0));
    if (ly === LAST) this.setFlag(BORDER_S, this.scanRow(LAST));
    if (lx === 0) this.setFlag(BORDER_W, this.scanCol(0));
    if (lx === LAST) this.setFlag(BORDER_E, this.scanCol(LAST));
    if (lx === 0 && ly === 0) this.setFlag(BORDER_NW, this.data[0] !== DEAD);
    if (lx === LAST && ly === 0) this.setFlag(BORDER_NE, this.data[LAST] !== DEAD);
    if (lx === 0 && ly === LAST) this.setFlag(BORDER_SW, this.data[LAST * CHUNK_SIZE] !== DEAD);
    if (lx === LAST && ly === LAST) {
      this.setFlag(BORDER_SE, this.data[CHUNK_AREA - 1] !== DEAD);
    }
  }

  private scanRow(row: number): boolean {
    const base = row * CHUNK_SIZE;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      if (this.data[base + x] !== DEAD) return true;
    }
    return false;
  }

  private scanCol(col: number): boolean {
    for (let y = 0; y < CHUNK_SIZE; y++) {
      if (this.data[y * CHUNK_SIZE + col] !== DEAD) return true;
    }
    return false;
  }

  private setFlag(flag: number, on: boolean): void {
    this.borderMask = on ? this.borderMask | flag : this.borderMask & ~flag;
  }
}
