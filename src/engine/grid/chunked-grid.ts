/**
 * `ChunkedGrid` — a sparse `Map<number, Chunk>` keyed by packed chunk coordinates (ADR-010).
 * Chunks are allocated lazily and freed (with hysteresis, to avoid churn on a blinking cell)
 * once they have been empty for long enough.
 *
 * Double buffering (front/back chunk maps, so a step never mutates what the renderer is
 * reading) is introduced in `simulation.ts` (P0-E-1) alongside the step function that
 * actually needs it — this grid is the single-buffered storage step() reads from and writes
 * through.
 */
import { DEAD, type ChunkView, type GridView, type Rect, type StateId } from '../types';
import { Chunk } from './chunk';
import {
  CHUNK_SIZE,
  localIndex,
  normalize,
  packChunk,
  unpackChunkX,
  unpackChunkY,
  worldToChunk,
} from './coords';

export interface ChunkedGridOptions {
  readonly boundary: 'bounded' | 'toroidal' | 'infinite';
  /** Required for `bounded`/`toroidal`; ignored for `infinite`. */
  readonly width?: number;
  readonly height?: number;
  /** Ticks a chunk must stay at population 0 before it is freed. Default 4. */
  readonly emptyChunkHysteresis?: number;
}

const DEFAULT_HYSTERESIS = 4;

export class ChunkedGrid {
  readonly boundary: 'bounded' | 'toroidal' | 'infinite';
  private readonly width: number;
  private readonly height: number;
  private readonly hysteresis: number;
  private readonly chunks = new Map<number, Chunk>();
  private readonly emptySince = new Map<number, number>();
  /** Chunks dirty this tick, plus their 8 neighbours — the step function's work list. */
  readonly activeChunks = new Set<number>();
  private currentTick = 0;

  constructor(opts: ChunkedGridOptions) {
    this.boundary = opts.boundary;
    this.width = opts.width ?? 0;
    this.height = opts.height ?? 0;
    this.hysteresis = opts.emptyChunkHysteresis ?? DEFAULT_HYSTERESIS;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get(x: number, y: number): StateId {
    const norm = normalize(x, y, this.boundary, this.width, this.height);
    if (norm === null) return DEAD;
    const [nx, ny] = norm;
    const [cx, cy] = worldToChunk(nx, ny);
    return this.chunks.get(packChunk(cx, cy))?.at(localIndex(nx, ny)) ?? DEAD;
  }

  /** Write one cell. Silently a no-op outside a `bounded` grid's extent, matching `normalize`. */
  set(x: number, y: number, state: StateId): void {
    const norm = normalize(x, y, this.boundary, this.width, this.height);
    if (norm === null) return;
    const [nx, ny] = norm;
    const [cx, cy] = worldToChunk(nx, ny);
    const key = packChunk(cx, cy);

    let chunk = this.chunks.get(key);
    if (!chunk) {
      if (state === DEAD) return; // never allocate a chunk just to keep it dead
      chunk = Chunk.acquire();
      this.chunks.set(key, chunk);
    }

    chunk.set(localIndex(nx, ny), state);
    this.markActive(cx, cy);

    if (chunk.population === 0) {
      this.emptySince.set(key, this.currentTick);
    } else {
      this.emptySince.delete(key);
    }
  }

  private markActive(cx: number, cy: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.activeChunks.add(packChunk(cx + dx, cy + dy));
      }
    }
  }

  /**
   * Advance the grid's notion of "now" to `tick`, then free chunks that have been at
   * population 0 since before `tick - hysteresis`. Called once per simulation tick, before
   * any `set()` calls for that tick, so newly-emptied chunks are timestamped correctly.
   * Returns the number of chunks freed.
   */
  reclaim(tick: number): number {
    this.currentTick = tick;
    let freed = 0;
    for (const [key, since] of this.emptySince) {
      if (tick - since < this.hysteresis) continue;
      const chunk = this.chunks.get(key);
      if (chunk) {
        this.chunks.delete(key);
        Chunk.release(chunk);
        freed += 1;
      }
      this.emptySince.delete(key);
    }
    return freed;
  }

  /** The bounding box of live *chunks* (chunk-granularity, not per-cell — cheap and O(chunks)). */
  bounds(): Rect {
    let minCx = Infinity;
    let minCy = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    for (const [key, chunk] of this.chunks) {
      if (chunk.population === 0) continue;
      const cx = unpackChunkX(key);
      const cy = unpackChunkY(key);
      if (cx < minCx) minCx = cx;
      if (cy < minCy) minCy = cy;
      if (cx > maxCx) maxCx = cx;
      if (cy > maxCy) maxCy = cy;
    }
    if (minCx === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: minCx * CHUNK_SIZE,
      y: minCy * CHUNK_SIZE,
      width: (maxCx - minCx + 1) * CHUNK_SIZE,
      height: (maxCy - minCy + 1) * CHUNK_SIZE,
    };
  }

  private toChunkView(key: number, chunk: Chunk): ChunkView {
    return {
      cx: unpackChunkX(key),
      cy: unpackChunkY(key),
      population: chunk.population,
      at: (i: number) => chunk.at(i),
    };
  }

  getChunk(cx: number, cy: number): ChunkView | undefined {
    const key = packChunk(cx, cy);
    const chunk = this.chunks.get(key);
    return chunk ? this.toChunkView(key, chunk) : undefined;
  }

  forEachChunkInRect(rect: Rect, fn: (chunk: ChunkView) => void): void {
    const [cx0, cy0] = worldToChunk(rect.x, rect.y);
    const [cx1, cy1] = worldToChunk(rect.x + rect.width - 1, rect.y + rect.height - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const view = this.getChunk(cx, cy);
        if (view) fn(view);
      }
    }
  }

  /** A read-only, no-copy façade for the renderer and stats engine. */
  view(): GridView {
    return {
      boundary: this.boundary,
      get: (x, y) => this.get(x, y),
      bounds: () => this.bounds(),
      forEachChunkInRect: (rect, fn) => this.forEachChunkInRect(rect, fn),
      getChunk: (cx, cy) => this.getChunk(cx, cy),
    };
  }
}
