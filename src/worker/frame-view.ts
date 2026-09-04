/**
 * P0-H-3 — bridges the wire protocol's `TransferredChunks` (raw byte pages, arriving via
 * `WorkerClient.onFrame`) to the `GridView` the renderer expects (ADR-005). A single frame's
 * payload is only the chunks that changed *this* tick (`worker/handler.ts`'s `postFrame`) — the
 * renderer needs the full current picture, not just one tick's delta — so `FrameGridMirror`
 * keeps a persistent client-side mirror of every chunk page it has ever seen, merging each new
 * frame's pages into it.
 *
 * `view()` and the `ChunkView`s it hands out are reused, mutated in place, not freshly
 * allocated per call — the same reused-buffer discipline `Simulation`'s own `ChangeSet` uses.
 * **A `ChunkView` from this module is only valid until the next chunk visit** (the next
 * `forEachChunkInRect`/`getChunk` call, on this or a nested loop) — a caller that needs to keep
 * one past that must copy the fields it needs. `Canvas2DRenderer` (P0-H-2) never does otherwise:
 * it consumes each chunk fully, synchronously, before moving to the next.
 *
 * Known limitation: nothing on the wire protocol flags "this frame is authoritative for the
 * whole world, drop anything not listed" (`postFullFrame`, sent after `clear`/`seedRandom`/
 * `seek`/`restore`) versus "this is only what changed" (`postFrame`). A chunk that died out
 * entirely in one of those operations is genuinely absent from the new frame, but stays stale
 * in this mirror until something else overwrites it. `reset()` is the escape hatch: a caller
 * that already knows it is about to trigger one of those full-frame commands (P0-I-1's client
 * shell calls it around its own `clear` command, for its reset button) can discard the mirror's
 * contents first, so the next frame's chunks are all that remain. This only helps a caller who
 * knows to use it — the wire protocol still can't distinguish the two frame kinds on its own,
 * so any other caller sending `seedRandom`/`seek`/`restore` without also calling `reset()` still
 * hits the same staleness. Not exercised by any Phase 0 caller other than P0-I-1's `clear` path.
 *
 * The same gap has a second, renderer-facing half: `postFullFrame` reports `dirty: []` (not
 * `null`) when the world becomes fully empty — an empty world has nothing to *describe* as
 * changed — so `Renderer.draw()` sees an empty dirty list and issues zero draw calls, leaving
 * whatever was on screen before untouched. Found exactly this way: clicking P0-I-1's reset
 * button cleared the mirror correctly but left the old gliders visibly painted on the canvas.
 * `FrameGridMirror` can't fix this itself (it has no renderer to redraw); the client shell works
 * around it locally by forcing one `draw()` with `dirty: null` right after its own `reset()`.
 */
import { packChunk, unpackChunkX, unpackChunkY, worldToChunk } from '@engine/grid/coords';
import {
  CHUNK_AREA,
  CHUNK_SIZE,
  DEAD,
  chunkToWorld,
  localIndex,
  type ChunkView,
  type GridView,
  type Rect,
} from '@shared/types';
import type { TransferredChunks } from '@shared/protocol';

/** `ChunkView`'s fields, without the `readonly` — for this module's own reused, mutated-in-place instance. */
interface MutableChunkView {
  cx: number;
  cy: number;
  population: number;
  at(localIndex: number): number;
}

export class FrameGridMirror {
  private readonly pages = new Map<number, Uint8Array>();

  // One reused ChunkView, re-pointed at whichever chunk was last visited, and one reused
  // GridView wrapping the (mutating-in-place) `pages` map — see the class doc's warning about
  // the ChunkView's validity window.
  private scratchData: Uint8Array = new Uint8Array(0);
  private readonly reusableChunkView: MutableChunkView = {
    cx: 0,
    cy: 0,
    population: 0,
    at: (li) => this.scratchData[li] ?? DEAD,
  };
  private readonly gridView: GridView = {
    boundary: 'infinite',
    get: (x, y) => {
      const [cx, cy] = worldToChunk(x, y);
      const data = this.pages.get(packChunk(cx, cy));
      return data ? (data[localIndex(x, y)] ?? DEAD) : DEAD;
    },
    bounds: () => this.computeBounds(),
    forEachChunkInRect: (rect, fn) => this.forEachChunkInRect(rect, fn),
    getChunk: (cx, cy) => this.getChunk(cx, cy),
  };

  /** Merge one frame's chunk pages into the mirror — a plain overwrite per touched key, no copy beyond what the transfer already did. */
  applyChunks(chunks: TransferredChunks): void {
    for (let i = 0; i < chunks.keys.length; i++) {
      const key = chunks.keys[i]!;
      this.pages.set(key, chunks.data.subarray(i * CHUNK_AREA, (i + 1) * CHUNK_AREA));
    }
  }

  /** A `GridView` over the mirror's current contents — the same object every call; it reflects the mirror live, so there's nothing to reallocate. */
  view(): GridView {
    return this.gridView;
  }

  /** How many chunk pages the mirror currently holds — `* CHUNK_AREA` is a caller's cheapest
   * honest memory estimate for what it has mirrored client-side (P1-D-3's status bar), not a
   * measurement of the worker's own `Simulation` memory, which lives on the other side of the
   * wire and can differ (e.g. after chunk reclamation this mirror hasn't been told about yet). */
  get pageCount(): number {
    return this.pages.size;
  }

  /** Discards every chunk the mirror currently holds — see the class doc's "known limitation" for when a caller needs this. */
  reset(): void {
    this.pages.clear();
  }

  private chunkView(key: number, data: Uint8Array): ChunkView {
    this.reusableChunkView.cx = unpackChunkX(key);
    this.reusableChunkView.cy = unpackChunkY(key);
    this.scratchData = data;
    let population = 0;
    for (let i = 0; i < CHUNK_AREA; i++) if (data[i] !== DEAD) population++;
    this.reusableChunkView.population = population;
    return this.reusableChunkView;
  }

  private getChunk(cx: number, cy: number): ChunkView | undefined {
    const key = packChunk(cx, cy);
    const data = this.pages.get(key);
    return data ? this.chunkView(key, data) : undefined;
  }

  private forEachChunkInRect(rect: Rect, fn: (chunk: ChunkView) => void): void {
    const [cx0, cy0] = worldToChunk(rect.x, rect.y);
    const [cx1, cy1] = worldToChunk(rect.x + rect.width - 1, rect.y + rect.height - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = packChunk(cx, cy);
        const data = this.pages.get(key);
        if (data) fn(this.chunkView(key, data));
      }
    }
  }

  private computeBounds(): Rect {
    let minCx = Infinity;
    let minCy = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    for (const key of this.pages.keys()) {
      const cx = unpackChunkX(key);
      const cy = unpackChunkY(key);
      if (cx < minCx) minCx = cx;
      if (cy < minCy) minCy = cy;
      if (cx > maxCx) maxCx = cx;
      if (cy > maxCy) maxCy = cy;
    }
    if (minCx === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    const [x, y] = chunkToWorld(minCx, minCy);
    return { x, y, width: (maxCx - minCx + 1) * CHUNK_SIZE, height: (maxCy - minCy + 1) * CHUNK_SIZE };
  }
}
