/**
 * Incremental Zobrist hashing of live cells (P2-C-3).
 *
 * A dense per-(cell, state) table over the infinite world's ±1e6 × 256
 * palette would be gigabytes. Compact axis tables plus a high-bit mixer
 * give an independent 32-bit key per `(x, y, state)` without that
 * allocation: `TX[x & 4095] ^ TY[y & 4095] ^ HX[x>>>12] ^ HY[y>>>12] ^ TS[state]`.
 *
 * Empty field = 0. Dead cells are never XOR'd — a birth XORs the live
 * key in, a death XORs it back out, a live→live swap XORs both.
 *
 * Three running hashes, all XOR-updated from the `ChangeSet`:
 *
 * 1. **abs** — world coordinates. Repeats for oscillators (and still lifes).
 * 2. **shape** — coordinates normalised to the live bbox origin. Repeats
 *    for spaceships whose shape returns, even as they translate.
 * 3. **window** — only cells inside a rectangle frozen at `reset`. A gun's
 *    exhaust walks out of that rect; the mechanism's period remains.
 *
 * Shape is incremental while the bbox origin is stable. A moving origin
 * (a spaceship's leading edge, a die-back that peels the min-x rim)
 * recomputes from the `GridView` — O(live), never on the 512² soup apply
 * path unless that origin actually moved. Abs and window stay O(changes)
 * unconditionally.
 *
 * The tables are filled once at module load from a fixed-seed Mulberry32
 * and then treated as immutable. Each `ZobristHasher` owns only its
 * running hashes — two collectors never share mutable state.
 */
import { CHUNK_AREA, CHUNK_SIZE, unpackCellX, unpackCellY } from '../grid/coords.js';
import { Mulberry32 } from '../rng.js';
import { DEAD, type ChangeSet, type GridView, type Rect, type StateId } from '../types.js';

/** Side of the compact axis tables. 12 bits covers a 4096-cell tile. */
const TABLE_BITS = 12;
const TABLE_SIZE = 1 << TABLE_BITS;
const TABLE_MASK = TABLE_SIZE - 1;

/**
 * Cells of pad around the live bbox at `reset`, then frozen in world space.
 *
 * Gosper's gun is 36×9 at stamp; pad 8 yields a ~52×25 core window. Emitted
 * gliders leave that rect in ~32 generations (c/4, 8 cells). After the first
 * outbound glider has cleared the pad, the window contents are the gun
 * mechanism plus the in-production glider at the same phase — period 30.
 * A larger pad keeps spent gliders around and hides the period; a smaller
 * one clips the queen-bee shuttles. 8 is the smallest pad that still
 * contains the classic RLE's shuttle travel.
 */
export const WINDOW_PAD = 8;

const TX = new Uint32Array(TABLE_SIZE);
const TY = new Uint32Array(TABLE_SIZE);
const HX = new Uint32Array(TABLE_SIZE);
const HY = new Uint32Array(TABLE_SIZE);
const TS = new Uint32Array(256);

function fillTable(table: Uint32Array, rng: Mulberry32): void {
  for (let i = 0; i < table.length; i++) {
    let v = (rng.next() * 0x1_0000_0000) >>> 0;
    if (v === 0) v = 1;
    table[i] = v;
  }
}

const _fillRng = new Mulberry32(0x50b15);
fillTable(TX, _fillRng);
fillTable(TY, _fillRng);
fillTable(HX, _fillRng);
fillTable(HY, _fillRng);
fillTable(TS, _fillRng);

/** Independent 32-bit Zobrist key for a live cell at world (or relative) `(x, y)`. */
export function zobristCellKey(x: number, y: number, state: StateId): number {
  const ux = x >>> 0;
  const uy = y >>> 0;
  return (
    (TX[ux & TABLE_MASK]! ^
      TY[uy & TABLE_MASK]! ^
      HX[(ux >>> TABLE_BITS) & TABLE_MASK]! ^
      HY[(uy >>> TABLE_BITS) & TABLE_MASK]! ^
      TS[state & 0xff]!) >>> 0
  );
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
}

const EMPTY_WINDOW: Rect = { x: 0, y: 0, width: 0, height: 0 };

export class ZobristHasher {
  private _abs = 0;
  private _shape = 0;
  private _window = 0;
  private _windowPop = 0;
  private _originX = 0;
  private _originY = 0;
  private _windowRect: Rect = EMPTY_WINDOW;
  private _shapeValid = true;
  private _applyOx = 0;
  private _applyOy = 0;
  private _trackCycle = false;

  get absHash(): number {
    return this._abs;
  }

  get shapeHash(): number {
    return this._shape;
  }

  get windowHash(): number {
    return this._window;
  }

  get windowPop(): number {
    return this._windowPop;
  }

  get core(): Rect {
    return this._windowRect;
  }

  get shapeValid(): boolean {
    return this._shapeValid;
  }

  /**
   * Seed abs / shape / window from a full live-cell scan. Call from
   * `StatsCollector.reset` after the bbox is known. Freezes the core
   * window at bbox + {@link WINDOW_PAD}.
   */
  reset(view: GridView, bbox: Rect): void {
    this._abs = 0;
    this._shape = 0;
    this._window = 0;
    this._windowPop = 0;
    this._originX = bbox.x;
    this._originY = bbox.y;
    this._shapeValid = true;
    if (bbox.width > 0 && bbox.height > 0) {
      this._windowRect = {
        x: bbox.x - WINDOW_PAD,
        y: bbox.y - WINDOW_PAD,
        width: bbox.width + WINDOW_PAD * 2,
        height: bbox.height + WINDOW_PAD * 2,
      };
    } else {
      this._windowRect = EMPTY_WINDOW;
    }

    const bounds = view.bounds();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const ox = this._originX;
    const oy = this._originY;
    const win = this._windowRect;
    const winActive = win.width > 0 && win.height > 0;
    let abs = 0;
    let shape = 0;
    let windowHash = 0;
    let windowPop = 0;

    view.forEachChunkInRect(bounds, (chunk) => {
      if (chunk.population === 0) return;
      const cox = chunk.cx * CHUNK_SIZE;
      const coy = chunk.cy * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_AREA; i++) {
        const st = chunk.at(i);
        if (st === DEAD) continue;
        const x = cox + (i & 31);
        const y = coy + (i >>> 5);
        abs ^= zobristCellKey(x, y, st);
        shape ^= zobristCellKey(x - ox, y - oy, st);
        if (winActive && inRect(x, y, win)) {
          windowHash ^= zobristCellKey(x, y, st);
          windowPop += 1;
        }
      }
    });

    this._abs = abs >>> 0;
    this._shape = shape >>> 0;
    this._window = windowHash >>> 0;
    this._windowPop = windowPop;
  }

  /**
   * Start a ChangeSet fold. `trackCycle` also XOR-updates the shape and
   * frozen-window hashes — leave it false on the 512² soup apply path
   * (abs is enough for `StatSample.hash`; cycle detection arms this via
   * `StatsCollector.observeCycle`).
   */
  beginApply(originX: number, originY: number, trackCycle: boolean): void {
    this._applyOx = originX;
    this._applyOy = originY;
    this._trackCycle = trackCycle;
  }

  /** XOR one cell change. O(1). */
  note(x: number, y: number, from: number, to: number): void {
    if (from === to) return;
    if (from !== DEAD) this._abs ^= zobristCellKey(x, y, from);
    if (to !== DEAD) this._abs ^= zobristCellKey(x, y, to);
    if (!this._trackCycle) return;
    const ox = this._applyOx;
    const oy = this._applyOy;
    if (from !== DEAD) this._shape ^= zobristCellKey(x - ox, y - oy, from);
    if (to !== DEAD) this._shape ^= zobristCellKey(x - ox, y - oy, to);
    const win = this._windowRect;
    if (win.width <= 0 || win.height <= 0 || !inRect(x, y, win)) return;
    if (from !== DEAD) {
      this._window ^= zobristCellKey(x, y, from);
      if (to === DEAD) this._windowPop -= 1;
    }
    if (to !== DEAD) {
      this._window ^= zobristCellKey(x, y, to);
      if (from === DEAD) this._windowPop += 1;
    }
  }

  endApply(newOriginX: number, newOriginY: number, view?: GridView): void {
    this._abs >>>= 0;
    this._shape >>>= 0;
    this._window >>>= 0;
    const ox = this._applyOx;
    const oy = this._applyOy;
    this._originX = newOriginX;
    this._originY = newOriginY;
    if (!this._trackCycle) return;
    if (newOriginX !== ox || newOriginY !== oy) {
      if (view) this.recomputeShape(view, newOriginX, newOriginY);
      else this._shapeValid = false;
    } else {
      this._shapeValid = true;
    }
  }

  /**
   * Fold one `ChangeSet` — O(`cs.count`). Pass `view` so a changed bbox
   * origin can rebuild the shape hash; without it, shape is marked stale
   * and spaceship detection waits until the next `reset`. Always tracks
   * shape and window (the standalone hasher path used by tests/benches).
   */
  apply(
    cs: ChangeSet,
    ctx: {
      readonly originX: number;
      readonly originY: number;
      readonly newOriginX: number;
      readonly newOriginY: number;
    },
    view?: GridView,
  ): void {
    const { from, to, coords, count } = cs;
    this.beginApply(ctx.originX, ctx.originY, true);
    for (let i = 0; i < count; i++) {
      const packed = coords[i]!;
      this.note(unpackCellX(packed), unpackCellY(packed), from[i]!, to[i]!);
    }
    this.endApply(ctx.newOriginX, ctx.newOriginY, view);
  }

  /** Rebuild the frozen-window hash from live cells inside the rect. O(live). */
  recomputeWindow(view: GridView): void {
    const win = this._windowRect;
    let windowHash = 0;
    let windowPop = 0;
    if (win.width > 0 && win.height > 0) {
      const bounds = view.bounds();
      if (bounds.width > 0 && bounds.height > 0) {
        view.forEachChunkInRect(bounds, (chunk) => {
          if (chunk.population === 0) return;
          const cox = chunk.cx * CHUNK_SIZE;
          const coy = chunk.cy * CHUNK_SIZE;
          for (let i = 0; i < CHUNK_AREA; i++) {
            const st = chunk.at(i);
            if (st === DEAD) continue;
            const x = cox + (i & 31);
            const y = coy + (i >>> 5);
            if (!inRect(x, y, win)) continue;
            windowHash ^= zobristCellKey(x, y, st);
            windowPop += 1;
          }
        });
      }
    }
    this._window = windowHash >>> 0;
    this._windowPop = windowPop;
  }

  /** Rebuild the bbox-relative hash from live cells. O(live). */
  recomputeShape(view: GridView, originX: number, originY: number): void {
    this._originX = originX;
    this._originY = originY;
    this._shapeValid = true;
    let shape = 0;
    const bounds = view.bounds();
    if (bounds.width > 0 && bounds.height > 0) {
      view.forEachChunkInRect(bounds, (chunk) => {
        if (chunk.population === 0) return;
        const cox = chunk.cx * CHUNK_SIZE;
        const coy = chunk.cy * CHUNK_SIZE;
        for (let i = 0; i < CHUNK_AREA; i++) {
          const st = chunk.at(i);
          if (st === DEAD) continue;
          const x = cox + (i & 31);
          const y = coy + (i >>> 5);
          shape ^= zobristCellKey(x - originX, y - originY, st);
        }
      });
    }
    this._shape = shape >>> 0;
  }
}
