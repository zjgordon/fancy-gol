/**
 * Shannon entropy of a 16×16 block-occupancy histogram (P2-C-2).
 *
 * Partition the world into 16×16 blocks, count live (non-`DEAD`) cells in
 * each — occupancy `0..256` — and take Shannon entropy of that histogram,
 * in bits. Empty and still-life fields pile into one bin (near 0); a
 * uniform random soup spreads occupancy around 128 and sits near the top
 * of the range this measure actually attains; a 16×16-tile checkerboard
 * agar has exactly two occupancy classes and lands between them.
 *
 * This is the one genuinely O(cells) stat. Call it on a sampled subset of
 * blocks (default every 8th tick, configurable stride) — never from
 * `StatsCollector.apply`, which must stay O(changes). The result is always
 * labelled: {@link describeEntropy} never lets a sampled or stale value
 * look exact (AGENTS.md §9).
 *
 * The same walk fills per-chunk population arrays for the Phase 5 density
 * LOD — one computation, two consumers.
 */
import { CHUNK_SIZE, packChunk, worldToChunk } from '../grid/coords.js';
import { DEAD, type GridView, type Rect } from '../types.js';

/** Side of one occupancy block. A 32×32 chunk holds exactly four. */
export const BLOCK_SIZE = 16;
/** Occupancy bins: live count `0..256` inclusive. */
export const OCCUPANCY_BINS = BLOCK_SIZE * BLOCK_SIZE + 1;
/** `log2(257)` — entropy of a perfectly flat occupancy histogram. */
export const MAX_ENTROPY = Math.log2(OCCUPANCY_BINS);
/** Default temporal rate: measure every 8th tick. */
export const DEFAULT_PERIOD = 8;

export interface EntropyOptions {
  /**
   * Visit every Nth 16×16 block (spatial hash, not a lattice — so a
   * checkerboard agar does not alias). `1` includes every block. Default `1`.
   * Ignored when {@link sampleFraction} is set.
   */
  readonly blockStride?: number;
  /**
   * Fraction of 16×16 blocks to visit, in `(0, 1]`. Overrides
   * {@link blockStride} when set. `1` is spatially exact.
   */
  readonly sampleFraction?: number;
  /** Offset into the stride, mixed into the spatial hash. Default `0`. */
  readonly blockPhase?: number;
  /** Temporal period, carried on the sample for labelling. Default {@link DEFAULT_PERIOD}. */
  readonly period?: number;
  readonly tick?: number;
}

/**
 * One entropy reading. Treat `entropy` as exact only when {@link exact}
 * is true; otherwise use {@link describeEntropy}.
 */
export interface EntropySample {
  readonly entropy: number;
  readonly maxEntropy: number;
  /** True only when this reading included every 16×16 block in the domain. */
  readonly exact: boolean;
  readonly blockStride: number;
  readonly sampleFraction: number;
  readonly period: number;
  readonly tick: number;
  readonly blocksSampled: number;
  readonly blocksTotal: number;
}

const EMPTY_SAMPLE: EntropySample = {
  entropy: 0,
  maxEntropy: MAX_ENTROPY,
  exact: true,
  blockStride: 1,
  sampleFraction: 1,
  period: DEFAULT_PERIOD,
  tick: 0,
  blocksSampled: 0,
  blocksTotal: 0,
};

/**
 * User-facing label. Sampled and stale readings always say so — this is the
 * string the statistics panel (P2-D-3) must render next to the number.
 */
export function describeEntropy(sample: EntropySample): string {
  const bits = `${sample.entropy.toFixed(2)} bits`;
  if (sample.exact) return `${bits} (exact)`;
  const every = sample.period <= 1 ? 'every tick' : `every ${sample.period} ticks`;
  const spatial =
    sample.blocksTotal > 0
      ? `${sample.blocksSampled}/${sample.blocksTotal} of 16×16 blocks`
      : 'a subset of 16×16 blocks';
  return `${bits} (sampled, ${every}, ${spatial})`;
}

/** Shannon entropy in bits of a non-negative histogram whose masses sum to `total`. */
export function shannon(hist: ArrayLike<number>, total: number): number {
  if (total <= 0) return 0;
  const inv = 1 / total;
  let h = 0;
  const n = hist.length;
  for (let i = 0; i < n; i++) {
    const c = hist[i] ?? 0;
    if (c <= 0) continue;
    const p = c * inv;
    h -= p * Math.log2(p);
  }
  return h;
}

export function entropyDomain(view: GridView): Rect {
  if (view.boundary !== 'infinite' && (view.width ?? 0) > 0 && (view.height ?? 0) > 0) {
    return { x: 0, y: 0, width: view.width!, height: view.height! };
  }
  const b = view.bounds();
  if (b.width <= 0 || b.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.floor(b.x / BLOCK_SIZE) * BLOCK_SIZE;
  const y = Math.floor(b.y / BLOCK_SIZE) * BLOCK_SIZE;
  const x1 = Math.ceil((b.x + b.width) / BLOCK_SIZE) * BLOCK_SIZE;
  const y1 = Math.ceil((b.y + b.height) / BLOCK_SIZE) * BLOCK_SIZE;
  return { x, y, width: x1 - x, height: y1 - y };
}

/**
 * Instance-scoped scanner. Owns the occupancy histogram and the per-chunk
 * population buffers (reused, mutated in place — copy if you need to keep
 * them past the next {@link EntropyScanner.measure}).
 */
export class EntropyScanner {
  readonly period: number;
  readonly blockStride: number;
  private readonly hist = new Uint32Array(OCCUPANCY_BINS);
  private keys = new Int32Array(8);
  private pop = new Uint16Array(8);
  private nChunks = 0;
  private lastSample: EntropySample = EMPTY_SAMPLE;

  constructor(opts: { period?: number; blockStride?: number } = {}) {
    const period = opts.period ?? DEFAULT_PERIOD;
    const blockStride = opts.blockStride ?? 1;
    if (period < 1 || (period | 0) !== period) {
      throw new RangeError(`entropy period must be a positive integer, got ${period}`);
    }
    if (blockStride < 1 || (blockStride | 0) !== blockStride) {
      throw new RangeError(`entropy blockStride must be a positive integer, got ${blockStride}`);
    }
    this.period = period;
    this.blockStride = blockStride;
  }

  get last(): EntropySample {
    return this.lastSample;
  }

  /** Packed chunk keys, valid prefix {@link chunkCount}. Reused. */
  get chunkKeys(): Int32Array {
    return this.keys;
  }

  /** Per-chunk live population, same order as {@link chunkKeys}. Reused. */
  get chunkPopulation(): Uint16Array {
    return this.pop;
  }

  get chunkCount(): number {
    return this.nChunks;
  }

  due(tick: number): boolean {
    return tick % this.period === 0;
  }

  /**
   * Measure if {@link due}, otherwise return the previous reading marked
   * not-exact (held across ticks). Always refreshes per-chunk populations —
   * those are O(chunks) and the LOD needs them every frame.
   */
  observe(view: GridView, tick: number): EntropySample {
    this.collectChunkPops(view);
    if (!this.due(tick) && this.lastSample.blocksTotal > 0) {
      const held = this.lastSample;
      this.lastSample = { ...held, exact: false, tick };
      return this.lastSample;
    }
    return this.measure(view, { tick, period: this.period, blockStride: this.blockStride });
  }

  /**
   * Full occupancy-histogram pass. Also refreshes per-chunk populations.
   * Spatially exact iff `blockStride === 1`.
   */
  measure(view: GridView, opts: EntropyOptions = {}): EntropySample {
    this.collectChunkPops(view);
    const stride = opts.blockStride ?? this.blockStride;
    const fraction = opts.sampleFraction ?? (stride <= 1 ? 1 : 1 / stride);
    if (!(fraction > 0 && fraction <= 1)) {
      throw new RangeError(`entropy sampleFraction must be in (0, 1], got ${fraction}`);
    }
    const phase = opts.blockPhase ?? 0;
    const period = opts.period ?? this.period;
    const tick = opts.tick ?? 0;
    const spatiallyExact = fraction >= 1;
    const domain = entropyDomain(view);
    this.hist.fill(0);

    if (domain.width <= 0 || domain.height <= 0) {
      this.lastSample = {
        entropy: 0,
        maxEntropy: MAX_ENTROPY,
        exact: spatiallyExact,
        blockStride: stride,
        sampleFraction: fraction,
        period,
        tick,
        blocksSampled: 0,
        blocksTotal: 0,
      };
      return this.lastSample;
    }

    const x0 = domain.x;
    const y0 = domain.y;
    const xEnd = x0 + domain.width;
    const yEnd = y0 + domain.height;
    const nx = Math.ceil(domain.width / BLOCK_SIZE);
    const ny = Math.ceil(domain.height / BLOCK_SIZE);
    const blocksTotal = nx * ny;
    let blocksSampled = 0;

    for (let by = 0; by < ny; by++) {
      const by0 = y0 + by * BLOCK_SIZE;
      const by1 = by0 + BLOCK_SIZE < yEnd ? by0 + BLOCK_SIZE : yEnd;
      for (let bx = 0; bx < nx; bx++) {
        const hashed = ((bx * 0x9e3779b1) ^ (by * 0x85ebca77) ^ phase) >>> 0;
        const take = spatiallyExact || hashed % 10_000 < Math.round(fraction * 10_000);
        if (!take) continue;
        const bx0 = x0 + bx * BLOCK_SIZE;
        const bx1 = bx0 + BLOCK_SIZE < xEnd ? bx0 + BLOCK_SIZE : xEnd;
        const occ = this.blockOccupancy(view, bx0, by0, bx1, by1);
        this.hist[occ] = (this.hist[occ] ?? 0) + 1;
        blocksSampled += 1;
      }
    }

    this.lastSample = {
      entropy: shannon(this.hist, blocksSampled),
      maxEntropy: MAX_ENTROPY,
      exact: spatiallyExact,
      blockStride: stride,
      sampleFraction: fraction,
      period,
      tick,
      blocksSampled,
      blocksTotal,
    };
    return this.lastSample;
  }

  private collectChunkPops(view: GridView): void {
    this.nChunks = 0;
    const bounds = view.bounds();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    view.forEachChunkInRect(bounds, (chunk) => {
      if (this.nChunks === this.keys.length) {
        const cap = this.keys.length * 2;
        const nextKeys = new Int32Array(cap);
        const nextPop = new Uint16Array(cap);
        nextKeys.set(this.keys);
        nextPop.set(this.pop);
        this.keys = nextKeys;
        this.pop = nextPop;
      }
      this.keys[this.nChunks] = packChunk(chunk.cx, chunk.cy);
      this.pop[this.nChunks] = chunk.population;
      this.nChunks += 1;
    });
  }

  private blockOccupancy(
    view: GridView,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): number {
    const [cx0, cy0] = worldToChunk(x0, y0);
    const [cx1, cy1] = worldToChunk(x1 - 1, y1 - 1);
    if (cx0 === cx1 && cy0 === cy1) {
      const chunk = view.getChunk(cx0, cy0);
      if (!chunk) return 0;
      let occ = 0;
      for (let y = y0; y < y1; y++) {
        const row = (y & (CHUNK_SIZE - 1)) << 5;
        for (let x = x0; x < x1; x++) {
          if (chunk.at(row | (x & (CHUNK_SIZE - 1))) !== DEAD) occ += 1;
        }
      }
      return occ;
    }
    let occ = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (view.get(x, y) !== DEAD) occ += 1;
      }
    }
    return occ;
  }
}
