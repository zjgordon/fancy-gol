/**
 * Tiered stat series (P2-C-5).
 *
 * Four rings, exactly the §2.2 table:
 *
 * | Tier | Resolution     | Span                         |
 * | 0    | every tick     | last 4,096 ticks             |
 * | 1    | every 16th     | last 65,536 (min/mean/max)   |
 * | 2    | every 256th    | last 1,048,576               |
 * | 3    | every 4,096th  | ring-capped (hard memory cap)|
 *
 * Each coarser ring folds 16 slots of the finer one. Min/max of population
 * survive the fold — a chart drawn from tier 3 still shows an oscillation
 * that lived in tier 0. **A chart that hides an oscillation is a lying chart.**
 *
 * `query` is the §2.2 `window()` method. It is not named `window` because
 * that identifier is the DOM global the pure-logic lane forbids (ADR-009).
 * It picks the finest ring that still covers the requested span, then
 * LTTB-downsamples to `maxPoints`.
 *
 * Columnar typed arrays, instance-scoped. One million pushes stay under
 * 32 MB because the rings do not grow with tick count.
 *
 * Per-state histograms live on tier 0 only. Folding 256 bins on every tick
 * is O(palette), not O(changes), and the anti-lying-chart contract is the
 * population min/max envelope — that is what coarser tiers keep.
 */
import type { Rect, StatSample } from '../types.js';

export const TIER_SLOTS = 4096;
export const TIER_FOLD = 16;
export const TIER_STRIDE = [1, 16, 256, 4096] as const;
export const TIER_SPAN = [4096, 65_536, 1_048_576, TIER_SLOTS * 4096] as const;
const STATE_SLOTS = 256;
const EMPTY_PER_STATE = new Uint32Array(STATE_SLOTS);

export type SeriesTier = 0 | 1 | 2 | 3;

/**
 * One point of a {@link Series.query} result. Extends {@link StatSample}
 * with the population envelope so a band renderer can show oscillation
 * that aggregation would otherwise flatten. For tier 0, min = max = population.
 */
export interface SeriesPoint extends StatSample {
  readonly populationMin: number;
  readonly populationMax: number;
  readonly tier: SeriesTier;
}

export interface SeriesQuery {
  readonly tier: SeriesTier;
  /** True when the source ring is aggregated (tiers 1–3). */
  readonly aggregated: boolean;
  /** True when LTTB dropped points. */
  readonly downsampled: boolean;
  readonly sourceCount: number;
  readonly points: readonly SeriesPoint[];
}

interface Ring {
  readonly tick: Float64Array;
  readonly pop: Float64Array;
  readonly popMin: Float64Array;
  readonly popMax: Float64Array;
  readonly births: Float64Array;
  readonly deaths: Float64Array;
  readonly transitions: Float64Array;
  readonly activity: Float64Array;
  readonly density: Float64Array;
  readonly entropy: Float64Array;
  readonly hash: Float64Array;
  readonly bboxX: Float64Array;
  readonly bboxY: Float64Array;
  readonly bboxW: Float64Array;
  readonly bboxH: Float64Array;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly perState: Uint32Array;
  write: number;
  filled: number;
}

interface Acc {
  n: number;
  tickFirst: number;
  tickLast: number;
  popSum: number;
  popMin: number;
  popMax: number;
  births: number;
  deaths: number;
  transitions: number;
  activity: number;
  density: number;
  entropy: number;
  hash: number;
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
  cx: number;
  cy: number;
}

function makeRing(keepPerState: boolean): Ring {
  return {
    tick: new Float64Array(TIER_SLOTS),
    pop: new Float64Array(TIER_SLOTS),
    popMin: new Float64Array(TIER_SLOTS),
    popMax: new Float64Array(TIER_SLOTS),
    births: new Float64Array(TIER_SLOTS),
    deaths: new Float64Array(TIER_SLOTS),
    transitions: new Float64Array(TIER_SLOTS),
    activity: new Float64Array(TIER_SLOTS),
    density: new Float64Array(TIER_SLOTS),
    entropy: new Float64Array(TIER_SLOTS),
    hash: new Float64Array(TIER_SLOTS),
    bboxX: new Float64Array(TIER_SLOTS),
    bboxY: new Float64Array(TIER_SLOTS),
    bboxW: new Float64Array(TIER_SLOTS),
    bboxH: new Float64Array(TIER_SLOTS),
    cx: new Float64Array(TIER_SLOTS),
    cy: new Float64Array(TIER_SLOTS),
    perState: keepPerState ? new Uint32Array(TIER_SLOTS * STATE_SLOTS) : new Uint32Array(0),
    write: 0,
    filled: 0,
  };
}

function ringBytes(r: Ring): number {
  return (
    r.tick.byteLength +
    r.pop.byteLength +
    r.popMin.byteLength +
    r.popMax.byteLength +
    r.births.byteLength +
    r.deaths.byteLength +
    r.transitions.byteLength +
    r.activity.byteLength +
    r.density.byteLength +
    r.entropy.byteLength +
    r.hash.byteLength +
    r.bboxX.byteLength +
    r.bboxY.byteLength +
    r.bboxW.byteLength +
    r.bboxH.byteLength +
    r.cx.byteLength +
    r.cy.byteLength +
    r.perState.byteLength
  );
}

function makeAcc(): Acc {
  return {
    n: 0,
    tickFirst: 0,
    tickLast: 0,
    popSum: 0,
    popMin: Infinity,
    popMax: -Infinity,
    births: 0,
    deaths: 0,
    transitions: 0,
    activity: 0,
    density: 0,
    entropy: 0,
    hash: 0,
    bx0: 0,
    by0: 0,
    bx1: 0,
    by1: 0,
    cx: 0,
    cy: 0,
  };
}

function accClear(a: Acc): void {
  a.n = 0;
  a.popSum = 0;
  a.popMin = Infinity;
  a.popMax = -Infinity;
  a.births = 0;
  a.deaths = 0;
  a.transitions = 0;
  a.activity = 0;
  a.density = 0;
  a.entropy = 0;
  a.hash = 0;
  a.cx = 0;
  a.cy = 0;
}

function accAdd(
  a: Acc,
  tick: number,
  pop: number,
  popMin: number,
  popMax: number,
  births: number,
  deaths: number,
  transitions: number,
  activity: number,
  density: number,
  entropy: number,
  hash: number,
  bbox: Rect,
  cx: number,
  cy: number,
): void {
  if (a.n === 0) {
    a.tickFirst = tick;
    a.bx0 = bbox.x;
    a.by0 = bbox.y;
    a.bx1 = bbox.x + bbox.width;
    a.by1 = bbox.y + bbox.height;
  } else {
    if (bbox.x < a.bx0) a.bx0 = bbox.x;
    if (bbox.y < a.by0) a.by0 = bbox.y;
    const x1 = bbox.x + bbox.width;
    const y1 = bbox.y + bbox.height;
    if (x1 > a.bx1) a.bx1 = x1;
    if (y1 > a.by1) a.by1 = y1;
  }
  a.tickLast = tick;
  a.n += 1;
  a.popSum += pop;
  if (popMin < a.popMin) a.popMin = popMin;
  if (popMax > a.popMax) a.popMax = popMax;
  a.births += births;
  a.deaths += deaths;
  a.transitions += transitions;
  a.activity += activity;
  a.density += density;
  a.entropy += entropy;
  a.hash = hash;
  a.cx += cx;
  a.cy += cy;
}

function writeSlot(
  r: Ring,
  i: number,
  tick: number,
  pop: number,
  popMin: number,
  popMax: number,
  births: number,
  deaths: number,
  transitions: number,
  activity: number,
  density: number,
  entropy: number,
  hash: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  cx: number,
  cy: number,
  perState: Uint32Array,
  perOff: number,
): void {
  r.tick[i] = tick;
  r.pop[i] = pop;
  r.popMin[i] = popMin;
  r.popMax[i] = popMax;
  r.births[i] = births;
  r.deaths[i] = deaths;
  r.transitions[i] = transitions;
  r.activity[i] = activity;
  r.density[i] = density;
  r.entropy[i] = entropy;
  r.hash[i] = hash;
  r.bboxX[i] = bx;
  r.bboxY[i] = by;
  r.bboxW[i] = bw;
  r.bboxH[i] = bh;
  r.cx[i] = cx;
  r.cy[i] = cy;
  if (r.perState.length > 0) {
    r.perState.set(perState.subarray(perOff, perOff + STATE_SLOTS), i * STATE_SLOTS);
  }
}

function commitAcc(r: Ring, a: Acc): number {
  const n = a.n;
  const i = r.write;
  const inv = 1 / n;
  writeSlot(
    r,
    i,
    a.tickLast,
    a.popSum * inv,
    a.popMin,
    a.popMax,
    a.births * inv,
    a.deaths * inv,
    a.transitions * inv,
    a.activity * inv,
    a.density * inv,
    a.entropy * inv,
    a.hash,
    a.bx0,
    a.by0,
    Math.max(0, a.bx1 - a.bx0),
    Math.max(0, a.by1 - a.by0),
    a.cx * inv,
    a.cy * inv,
    EMPTY_PER_STATE,
    0,
  );
  r.write = (i + 1) % TIER_SLOTS;
  if (r.filled < TIER_SLOTS) r.filled += 1;
  accClear(a);
  return i;
}

function ringIndex(r: Ring, k: number): number {
  const start = r.filled === TIER_SLOTS ? r.write : 0;
  return (start + k) % TIER_SLOTS;
}

function pointFromRing(r: Ring, i: number, tier: SeriesTier): SeriesPoint {
  const off = i * STATE_SLOTS;
  return {
    tick: r.tick[i]!,
    population: r.pop[i]!,
    populationMin: r.popMin[i]!,
    populationMax: r.popMax[i]!,
    perState:
      r.perState.length >= off + STATE_SLOTS
        ? r.perState.slice(off, off + STATE_SLOTS)
        : new Uint32Array(STATE_SLOTS),
    births: r.births[i]!,
    deaths: r.deaths[i]!,
    transitions: r.transitions[i]!,
    activity: r.activity[i]!,
    density: r.density[i]!,
    bbox: {
      x: r.bboxX[i]!,
      y: r.bboxY[i]!,
      width: r.bboxW[i]!,
      height: r.bboxH[i]!,
    },
    centroid: { x: r.cx[i]!, y: r.cy[i]! },
    entropy: r.entropy[i]!,
    hash: r.hash[i]!,
    tier,
  };
}

/**
 * Largest-Triangle-Three-Buckets. Returns selected indices into a length-`n`
 * sequence. Always keeps the first and last point when `maxPoints >= 2`.
 */
export function lttbIndices(
  n: number,
  maxPoints: number,
  xAt: (i: number) => number,
  yAt: (i: number) => number,
): number[] {
  if (n <= 0) return [];
  if (maxPoints >= n || maxPoints < 3) {
    if (maxPoints === 1) return [n - 1];
    if (maxPoints === 2 && n >= 2) return [0, n - 1];
    const all = new Array<number>(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }
  const sampled = new Array<number>(maxPoints);
  sampled[0] = 0;
  sampled[maxPoints - 1] = n - 1;
  const bucketSize = (n - 2) / (maxPoints - 2);
  let a = 0;
  for (let i = 0; i < maxPoints - 2; i++) {
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(n - 1, Math.floor((i + 2) * bucketSize) + 1);
    let avgX = 0;
    let avgY = 0;
    const nextCount = Math.max(1, nextEnd - nextStart);
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += xAt(j);
      avgY += yAt(j);
    }
    avgX /= nextCount;
    avgY /= nextCount;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(n - 1, Math.floor((i + 1) * bucketSize) + 1);
    const ax = xAt(a);
    const ay = yAt(a);
    let maxArea = -1;
    let maxIdx = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs((ax - avgX) * (yAt(j) - ay) - (ax - xAt(j)) * (avgY - ay)) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }
    sampled[i + 1] = maxIdx;
    a = maxIdx;
  }
  return sampled;
}

export function describeSeriesQuery(q: SeriesQuery): string {
  if (q.points.length === 0) return 'No samples';
  const stride = TIER_STRIDE[q.tier];
  const every = stride === 1 ? 'every tick' : `every ${stride} ticks`;
  const agg = q.aggregated ? `min/mean/max, ${every}` : every;
  const ds = q.downsampled ? `, LTTB to ${q.points.length} points` : '';
  return `Tier ${q.tier} (${agg}${ds})`;
}

/** Finest ring whose span still contains a sample `age` ticks behind the head. */
export function chooseTier(
  age: number,
  filled: readonly [number, number, number, number],
): SeriesTier {
  if (age < TIER_SPAN[0] && filled[0] > 0) return 0;
  if (age < TIER_SPAN[1] && filled[1] > 0) return 1;
  if (age < TIER_SPAN[2] && filled[2] > 0) return 2;
  if (filled[3] > 0) return 3;
  if (filled[2] > 0) return 2;
  if (filled[1] > 0) return 1;
  return 0;
}

export class Series {
  /** Finest-ring length (tier 0). Coarser rings use the same slot count. */
  readonly capacity = TIER_SLOTS;

  private readonly rings: readonly [Ring, Ring, Ring, Ring] = [
    makeRing(true),
    makeRing(false),
    makeRing(false),
    makeRing(false),
  ];
  private readonly acc: readonly [Acc, Acc, Acc] = [makeAcc(), makeAcc(), makeAcc()];
  private newestTick = -1;

  get bytes(): number {
    return (
      ringBytes(this.rings[0]) +
      ringBytes(this.rings[1]) +
      ringBytes(this.rings[2]) +
      ringBytes(this.rings[3])
    );
  }

  get sampleCount(): number {
    return this.rings[0].filled;
  }

  reset(): void {
    for (const r of this.rings) {
      r.write = 0;
      r.filled = 0;
    }
    for (const a of this.acc) accClear(a);
    this.newestTick = -1;
  }

  push(s: StatSample): void {
    const pop = s.population;
    const bbox = s.bbox;
    const i0 = this.rings[0].write;
    writeSlot(
      this.rings[0],
      i0,
      s.tick,
      pop,
      pop,
      pop,
      s.births,
      s.deaths,
      s.transitions,
      s.activity,
      s.density,
      s.entropy,
      s.hash,
      bbox.x,
      bbox.y,
      bbox.width,
      bbox.height,
      s.centroid.x,
      s.centroid.y,
      s.perState,
      0,
    );
    this.rings[0].write = (i0 + 1) % TIER_SLOTS;
    if (this.rings[0].filled < TIER_SLOTS) this.rings[0].filled += 1;
    this.newestTick = s.tick;
    this.fold(0, i0);
  }

  /**
   * Record one collector tick. Same rings as {@link push}; the live
   * `perState` buffer is copied, not sliced, so this stays allocation-light
   * on the `apply` path.
   */
  capture(
    s: {
      readonly tick: number;
      readonly population: number;
      readonly perState: Uint32Array;
      readonly births: number;
      readonly deaths: number;
      readonly transitions: number;
      readonly activity: number;
      readonly density: number;
      readonly bbox: Rect;
      readonly centroid: { x: number; y: number };
      readonly entropy: number;
    },
    hash: number,
  ): void {
    this.push({
      tick: s.tick,
      population: s.population,
      perState: s.perState,
      births: s.births,
      deaths: s.deaths,
      transitions: s.transitions,
      activity: s.activity,
      density: s.density,
      bbox: s.bbox,
      centroid: s.centroid,
      entropy: s.entropy,
      hash,
    });
  }

  /**
   * §2.2 `window(fromTick, toTick, maxPoints)` — finest covering ring, then
   * LTTB. Named `query` so this module stays inside the ADR-009 forbidden-global
   * list (`window` is the DOM global the boundary checker bans).
   */
  query(fromTick: number, toTick: number, maxPoints: number): SeriesQuery {
    if (!(maxPoints >= 1) || (maxPoints | 0) !== maxPoints) {
      throw new RangeError(`maxPoints must be a positive integer, got ${maxPoints}`);
    }
    if (toTick < fromTick) {
      throw new RangeError(`toTick ${toTick} is before fromTick ${fromTick}`);
    }
    const t0 = this.rings[0];
    if (t0.filled === 0) {
      return { tier: 0, aggregated: false, downsampled: false, sourceCount: 0, points: [] };
    }

    const tier = this.pickTier(fromTick);
    const ring = this.rings[tier];
    const idxs: number[] = [];
    for (let k = 0; k < ring.filled; k++) {
      const i = ringIndex(ring, k);
      const tick = ring.tick[i]!;
      if (tick < fromTick || tick > toTick) continue;
      idxs.push(i);
    }
    const n = idxs.length;
    if (n === 0) {
      return { tier, aggregated: tier > 0, downsampled: false, sourceCount: 0, points: [] };
    }

    const xAt = (p: number) => ring.tick[idxs[p]!]!;
    const yAt = (p: number) => ring.pop[idxs[p]!]!;
    const picked = lttbIndices(n, maxPoints, xAt, yAt);
    const points = picked.map((p, pi) => {
      const pt = pointFromRing(ring, idxs[p]!, tier);
      // Fold dropped neighbours into the envelope so LTTB cannot hide an
      // oscillation that lived between kept points (tiers 0–3 alike).
      if (picked.length === n) return pt;
      const hi = pi + 1 < picked.length ? picked[pi + 1]! : n;
      let mn = pt.populationMin;
      let mx = pt.populationMax;
      for (let q = p; q < hi; q++) {
        const ri = idxs[q]!;
        const loV = ring.popMin[ri]!;
        const hiV = ring.popMax[ri]!;
        if (loV < mn) mn = loV;
        if (hiV > mx) mx = hiV;
      }
      return { ...pt, populationMin: mn, populationMax: mx };
    });
    return {
      tier,
      aggregated: tier > 0,
      downsampled: picked.length < n,
      sourceCount: n,
      points,
    };
  }

  /** Oldest..newest points of one ring — for tests that assert a specific tier. */
  tierPoints(tier: SeriesTier): SeriesPoint[] {
    const ring = this.rings[tier];
    const out = new Array<SeriesPoint>(ring.filled);
    for (let k = 0; k < ring.filled; k++) {
      out[k] = pointFromRing(ring, ringIndex(ring, k), tier);
    }
    return out;
  }

  private pickTier(fromTick: number): SeriesTier {
    const newest = this.newestTick;
    if (newest < 0) return 0;
    return chooseTier(newest - fromTick, [
      this.rings[0].filled,
      this.rings[1].filled,
      this.rings[2].filled,
      this.rings[3].filled,
    ]);
  }

  private fold(fromTier: 0 | 1 | 2, slot: number): void {
    const src = this.rings[fromTier];
    const acc = this.acc[fromTier];
    const bbox: Rect = {
      x: src.bboxX[slot]!,
      y: src.bboxY[slot]!,
      width: src.bboxW[slot]!,
      height: src.bboxH[slot]!,
    };
    accAdd(
      acc,
      src.tick[slot]!,
      src.pop[slot]!,
      src.popMin[slot]!,
      src.popMax[slot]!,
      src.births[slot]!,
      src.deaths[slot]!,
      src.transitions[slot]!,
      src.activity[slot]!,
      src.density[slot]!,
      src.entropy[slot]!,
      src.hash[slot]!,
      bbox,
      src.cx[slot]!,
      src.cy[slot]!,
    );
    if (acc.n < TIER_FOLD) return;
    const next = (fromTier + 1) as 1 | 2 | 3;
    const committed = commitAcc(this.rings[next], acc);
    if (next === 1 || next === 2) this.fold(next, committed);
  }
}
