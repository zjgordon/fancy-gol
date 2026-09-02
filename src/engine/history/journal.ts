/**
 * Hybrid keyframe + delta journal (ADR-007). Keyframes every K ticks, a copied
 * delta per step, a hard byte ceiling, oldest-keyframe-first eviction that
 * *emits* rather than silently dropping the retained window.
 */
import {
  CHUNK_AREA,
  localIndex,
  packChunk,
  unpackCellX,
  unpackCellY,
  worldToChunk,
} from '../grid/coords';
import { DEAD, type ChangeSet, type Snapshot } from '../types';
import { decodeChunkSet, encodeChunkSet } from './compress';

export const DEFAULT_KEYFRAME_INTERVAL = 64;
export const DEFAULT_BYTE_CEILING = 256 * 1024 * 1024;

export interface HistoryEviction {
  readonly discardedFrom: number;
  readonly discardedTo: number;
  readonly bytesFreed: number;
  readonly retainedFrom: number;
}

export interface HistoryJournalOptions {
  readonly keyframeInterval?: number;
  readonly byteCeiling?: number;
  readonly onEvict?: (eviction: HistoryEviction) => void;
}

interface StoredKeyframe {
  readonly tick: number;
  readonly rngState: number;
  readonly population: number;
  readonly encoded: Uint8Array;
  readonly bytes: number;
}

interface StoredDelta {
  readonly tick: number;
  readonly rngState: number;
  readonly coords: Int32Array;
  readonly from: Uint8Array;
  readonly to: Uint8Array;
  readonly bytes: number;
}

function deltaBytes(count: number): number {
  return count * 6 + 16;
}

export class HistoryJournal {
  readonly keyframeInterval: number;
  readonly byteCeiling: number;
  private readonly onEvict: ((eviction: HistoryEviction) => void) | undefined;

  private keyframes: StoredKeyframe[] = [];
  private deltas: StoredDelta[] = [];
  private _bytes = 0;
  private _evictions = 0;
  private lastEviction: HistoryEviction | undefined;

  constructor(opts: HistoryJournalOptions = {}) {
    this.keyframeInterval = opts.keyframeInterval ?? DEFAULT_KEYFRAME_INTERVAL;
    this.byteCeiling = opts.byteCeiling ?? DEFAULT_BYTE_CEILING;
    this.onEvict = opts.onEvict;
    if (this.keyframeInterval < 1) {
      throw new RangeError('keyframeInterval must be >= 1');
    }
    if (this.byteCeiling < 1) {
      throw new RangeError('byteCeiling must be >= 1');
    }
  }

  get bytes(): number {
    return this._bytes;
  }

  get evictions(): number {
    return this._evictions;
  }

  get eviction(): HistoryEviction | undefined {
    return this.lastEviction;
  }

  /** Inclusive retained tick range. Empty journal: `{ from: 0, to: 0 }` with no keyframe. */
  get retained(): { from: number; to: number } {
    if (this.keyframes.length === 0) return { from: 0, to: 0 };
    const from = this.keyframes[0]!.tick;
    const lastKf = this.keyframes[this.keyframes.length - 1]!.tick;
    const lastD = this.deltas.length === 0 ? lastKf : this.deltas[this.deltas.length - 1]!.tick;
    return { from, to: Math.max(lastKf, lastD) };
  }

  /**
   * Drop everything and install `snap` as the sole keyframe. Used after seed/clear
   * so tick 0 is the soup, not the empty constructor grid.
   */
  resetTo(snap: Snapshot, population: number): void {
    this.keyframes = [];
    this.deltas = [];
    this._bytes = 0;
    this.pushKeyframe(snap, population);
  }

  recordDelta(cs: ChangeSet, rngState: number): void {
    const count = cs.count;
    const coords = cs.coords.slice(0, count);
    const from = cs.from.slice(0, count);
    const to = cs.to.slice(0, count);
    const bytes = deltaBytes(count);
    this.deltas.push({ tick: cs.tick, rngState, coords, from, to, bytes });
    this._bytes += bytes;
    this.evictWhileOver();
  }

  recordKeyframe(snap: Snapshot, population: number): void {
    this.pushKeyframe(snap, population);
    this.evictWhileOver();
  }

  /**
   * Reconstruct the snapshot at `t`. Throws if `t` is outside the retained window.
   */
  materialize(t: number): Snapshot {
    if (this.keyframes.length === 0) {
      throw new RangeError('history journal is empty');
    }
    const { from, to } = this.retained;
    if (t < from || t > to) {
      throw new RangeError(`tick ${t} is outside the retained window [${from}, ${to}]`);
    }
    let kf = this.keyframes[0]!;
    for (const candidate of this.keyframes) {
      if (candidate.tick > t) break;
      kf = candidate;
    }
    const decoded = decodeChunkSet(kf.encoded);
    const pages = new Map<number, Uint8Array>();
    for (let i = 0; i < decoded.keys.length; i++) {
      const page = new Uint8Array(CHUNK_AREA);
      page.set(decoded.data.subarray(i * CHUNK_AREA, (i + 1) * CHUNK_AREA));
      pages.set(decoded.keys[i]!, page);
    }
    let rngState = kf.rngState;
    for (const d of this.deltas) {
      if (d.tick <= kf.tick || d.tick > t) continue;
      rngState = d.rngState;
      for (let i = 0; i < d.coords.length; i++) {
        const packed = d.coords[i]!;
        const x = unpackCellX(packed);
        const y = unpackCellY(packed);
        const [cx, cy] = worldToChunk(x, y);
        const key = packChunk(cx, cy);
        let page = pages.get(key);
        if (!page) {
          page = new Uint8Array(CHUNK_AREA);
          pages.set(key, page);
        }
        page[localIndex(x, y)] = d.to[i] ?? DEAD;
      }
    }
    const keys = Int32Array.from([...pages.keys()].sort((a, b) => a - b));
    const data = new Uint8Array(keys.length * CHUNK_AREA);
    let live = 0;
    for (let i = 0; i < keys.length; i++) {
      const page = pages.get(keys[i]!)!;
      let pop = 0;
      for (let c = 0; c < CHUNK_AREA; c++) if (page[c] !== DEAD) pop += 1;
      if (pop === 0) continue;
      data.set(page, live * CHUNK_AREA);
      keys[live] = keys[i]!;
      live += 1;
    }
    return {
      tick: t,
      chunkKeys: keys.subarray(0, live),
      chunkData: data.subarray(0, live * CHUNK_AREA),
      rngState,
    };
  }

  /**
   * Discard ticks after `t` (the Phase 4 timeline fork). Keyframes and deltas
   * with tick > t are released; `bytes` drops accordingly.
   */
  truncateAfter(t: number): void {
    let freed = 0;
    const keepKf: StoredKeyframe[] = [];
    for (const kf of this.keyframes) {
      if (kf.tick <= t) keepKf.push(kf);
      else freed += kf.bytes;
    }
    const keepD: StoredDelta[] = [];
    for (const d of this.deltas) {
      if (d.tick <= t) keepD.push(d);
      else freed += d.bytes;
    }
    this.keyframes = keepKf;
    this.deltas = keepD;
    this._bytes -= freed;
  }

  private pushKeyframe(snap: Snapshot, population: number): void {
    const encoded = encodeChunkSet(snap.chunkKeys, snap.chunkData);
    const bytes = encoded.byteLength + 16;
    this.keyframes.push({
      tick: snap.tick,
      rngState: snap.rngState,
      population,
      encoded,
      bytes,
    });
    this._bytes += bytes;
  }

  private evictWhileOver(): void {
    while (this._bytes > this.byteCeiling && this.keyframes.length > 1) {
      const oldest = this.keyframes[0]!;
      const next = this.keyframes[1]!;
      let freed = oldest.bytes;
      const keptD: StoredDelta[] = [];
      for (const d of this.deltas) {
        if (d.tick < next.tick) freed += d.bytes;
        else keptD.push(d);
      }
      this.keyframes.shift();
      this.deltas = keptD;
      this._bytes -= freed;
      this._evictions += 1;
      const eviction: HistoryEviction = {
        discardedFrom: oldest.tick,
        discardedTo: next.tick - 1,
        bytesFreed: freed,
        retainedFrom: next.tick,
      };
      this.lastEviction = eviction;
      this.onEvict?.(eviction);
    }
  }
}
