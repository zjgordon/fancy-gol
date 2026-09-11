/**
 * `StatsCollector` — population, per-state counts, births, deaths,
 * transitions, activity, density, live bounding box, centroid and
 * per-state flux, maintained in O(changes) from the `ChangeSet` stream a
 * `Simulation` already produces. Per ADR-007, the delta stream is exactly
 * the data the stat engine needs; this collector never re-scans the grid
 * to answer "what changed."
 *
 * `reset` is the one O(cells) pass a collector ever takes — it seeds a
 * baseline (from a fresh grid, a restored snapshot, a `seedRandom` call, a
 * pattern stamped in with raw `set`s, …) that every subsequent `apply` call
 * can then update incrementally, independent of grid size.
 *
 * Bounding-box shrink on deletion unions the per-chunk live extents
 * ADR-010 already tracks (`ChunkView.liveMinX` …), so a die-back is
 * O(chunks), not O(cells). Pass the `GridView` as `apply`'s second
 * argument when a tight shrink matters; without it the box stays a
 * conservative expansion until the next `reset`.
 *
 * Instance-scoped, not a singleton: each collector owns its typed arrays
 * and geometry. A second `StatsCollector` on a second `Simulation` shares
 * nothing mutable (P2-C-1; Phase 4's Laboratory runs two side by side).
 *
 * Entropy (P2-C-2) is the exception to O(changes): a 16×16 occupancy
 * histogram is O(cells). `reset` takes an exact reading; `observeEntropy`
 * refreshes on the scanner's period. `apply` never scans — it only marks
 * the held value stale. Always display {@link StatsCollector.entropyLabel},
 * never the raw number, when `entropyExact` is false.
 */
import { CHUNK_AREA, CHUNK_SIZE, unpackCellX, unpackCellY } from '../grid/coords.js';
import { DEAD, type ChangeSet, type GridView, type StatSample } from '../types.js';
import {
  DEFAULT_PERIOD,
  describeEntropy,
  EntropyScanner,
  type EntropySample,
} from './entropy.js';

/** A `StateId` is a grid byte; 256 slots always fits the palette. */
const STATE_SLOTS = 256;

/** The counters a `StatsCollector` maintains. Mutated in place — copy `perState` / `flux` / `bbox` / `centroid` if you need to keep a tick's values past the next `apply`/`reset`. */
export interface CollectorStats {
  tick: number;
  population: number;
  readonly perState: Uint32Array;
  /** Cells born (a `DEAD` cell became live) this tick. */
  births: number;
  /** Cells that died (a live cell became `DEAD`) this tick. */
  deaths: number;
  /** Cells that changed between two non-`DEAD` states this tick. */
  transitions: number;
  /** Cells changed this tick — the `ChangeSet.count` this collector last folded in. */
  activity: number;
  /** Population / bounded area, or / bbox area when infinite. 0 when empty. */
  density: number;
  readonly bbox: { x: number; y: number; width: number; height: number };
  readonly centroid: { x: number; y: number };
  /** Net per-state change this tick (`+to − from`). Reset every `apply`, like births. */
  readonly flux: Int32Array;
  /** Shannon entropy of the 16×16 occupancy histogram, in bits (P2-C-2). */
  entropy: number;
  /**
   * True only when {@link entropy} came from a just-run, spatially complete
   * scan. After `apply`, or when the scanner is sampling, this is false —
   * use {@link StatsCollector.entropyLabel}, never present the number as exact.
   */
  entropyExact: boolean;
}

export interface StatsCollectorOptions {
  /** Temporal entropy rate. Default 8. */
  readonly entropyPeriod?: number;
  /** Spatial 16×16-block stride. Default 1 (every block when a scan runs). */
  readonly entropyBlockStride?: number;
}

export class StatsCollector {
  readonly entropyScanner: EntropyScanner;

  private readonly stats: CollectorStats = {
    tick: 0,
    population: 0,
    perState: new Uint32Array(STATE_SLOTS),
    births: 0,
    deaths: 0,
    transitions: 0,
    activity: 0,
    density: 0,
    bbox: { x: 0, y: 0, width: 0, height: 0 },
    centroid: { x: 0, y: 0 },
    flux: new Int32Array(STATE_SLOTS),
    entropy: 0,
    entropyExact: false,
  };

  private boundary: GridView['boundary'] = 'infinite';
  private worldWidth = 0;
  private worldHeight = 0;
  private sumX = 0;
  private sumY = 0;
  private hasExtent = false;
  private bboxDirty = false;

  constructor(opts: StatsCollectorOptions = {}) {
    this.entropyScanner = new EntropyScanner({
      period: opts.entropyPeriod ?? DEFAULT_PERIOD,
      blockStride: opts.entropyBlockStride ?? 1,
    });
  }

  get snapshot(): Readonly<CollectorStats> {
    return this.stats;
  }

  /**
   * A `StatSample` for the series / wire shape. Entropy is the last
   * occupancy-histogram reading; hash stays 0 until P2-C-3. Copies buffers
   * so a caller can keep the sample past the next `apply`.
   *
   * `entropy` is an approximation whenever {@link CollectorStats.entropyExact}
   * is false — pair it with {@link entropyLabel}.
   */
  sample(): StatSample {
    const s = this.stats;
    return {
      tick: s.tick,
      population: s.population,
      perState: s.perState.slice(),
      births: s.births,
      deaths: s.deaths,
      transitions: s.transitions,
      activity: s.activity,
      density: s.density,
      bbox: { x: s.bbox.x, y: s.bbox.y, width: s.bbox.width, height: s.bbox.height },
      centroid: { x: s.centroid.x, y: s.centroid.y },
      entropy: s.entropy,
      hash: 0,
    };
  }

  /**
   * Labelled entropy for display. Sampled, strided and stale readings all
   * say so — this is the user-visible sampling rate the acceptance criterion
   * asks for (the statistics panel, P2-D-3, renders this string).
   */
  entropyLabel(): string {
    return describeEntropy({ ...this.entropyScanner.last, exact: this.stats.entropyExact });
  }

  /**
   * Refresh entropy (and per-chunk populations) according to the scanner's
   * period. Not called from {@link apply} — that path must stay O(changes).
   */
  observeEntropy(view: GridView): EntropySample {
    const sample = this.entropyScanner.observe(view, this.stats.tick);
    this.syncEntropy(sample);
    return sample;
  }

  /**
   * Seed the running counters from a full grid scan via the public
   * `GridView` surface. Call once at construction, and again after anything
   * that isn't itself a `ChangeSet` — `restore`, a fresh `seedRandom`, cells
   * stamped in with raw `set` calls.
   */
  reset(view: GridView, tick = 0): void {
    this.captureWorld(view);
    const s = this.stats;
    s.perState.fill(0);
    s.flux.fill(0);
    let population = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = 0;
    let minY = 0;
    let maxX = -1;
    let maxY = -1;
    let any = false;
    const bounds = view.bounds();
    if (bounds.width > 0 && bounds.height > 0) {
      view.forEachChunkInRect(bounds, (chunk) => {
        population += chunk.population;
        const ox = chunk.cx * CHUNK_SIZE;
        const oy = chunk.cy * CHUNK_SIZE;
        for (let i = 0; i < CHUNK_AREA; i++) {
          const st = chunk.at(i);
          s.perState[st] = (s.perState[st] ?? 0) + 1;
          if (st === DEAD) continue;
          const x = ox + (i & 31);
          const y = oy + (i >>> 5);
          sumX += x;
          sumY += y;
          if (!any) {
            minX = maxX = x;
            minY = maxY = y;
            any = true;
          } else {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      });
    }
    s.population = population;
    s.tick = tick;
    s.births = 0;
    s.deaths = 0;
    s.transitions = 0;
    s.activity = 0;
    this.sumX = sumX;
    this.sumY = sumY;
    this.bboxDirty = false;
    this.writeExtent(any, minX, minY, maxX, maxY);
    this.refreshDerived();
    // Reset already walked the grid; take an exact occupancy scan so the
    // baseline entropy matches the cells we just counted.
    this.syncEntropy(
      this.entropyScanner.measure(view, {
        tick,
        period: this.entropyScanner.period,
        blockStride: 1,
      }),
    );
  }

  /**
   * Fold one `ChangeSet` into the running counters — O(`cs.count`), never a
   * grid scan. `births`/`deaths`/`transitions`/`activity`/`flux` describe this
   * `ChangeSet` only (they are reset, not accumulated); `population` and
   * `perState` keep a running total across every `apply` since the last
   * `reset`.
   *
   * Pass `view` so a shrinking live region can recompute the bbox from
   * per-chunk live extents. Without it the box only expands.
   */
  apply(cs: ChangeSet, view?: GridView): void {
    if (view) this.captureWorld(view);
    const s = this.stats;
    const { from, to, coords, count } = cs;
    const perState = s.perState;
    const flux = s.flux;
    flux.fill(0);
    let population = s.population;
    let births = 0;
    let deaths = 0;
    let transitions = 0;
    let sumX = this.sumX;
    let sumY = this.sumY;

    for (let i = 0; i < count; i++) {
      const f = from[i]!;
      const t = to[i]!;
      if (f === t) continue;
      perState[f]!--;
      perState[t]!++;
      flux[f]!--;
      flux[t]!++;
      const packed = coords[i]!;
      const x = unpackCellX(packed);
      const y = unpackCellY(packed);
      if (f === DEAD) {
        population += 1;
        births += 1;
        sumX += x;
        sumY += y;
        this.expandBBox(x, y, population);
      } else if (t === DEAD) {
        population -= 1;
        deaths += 1;
        sumX -= x;
        sumY -= y;
        this.noteEdgeDeath(x, y);
      } else {
        transitions += 1;
      }
    }

    s.population = population;
    s.births = births;
    s.deaths = deaths;
    s.transitions = transitions;
    s.activity = count;
    s.tick = cs.tick;
    this.sumX = sumX;
    this.sumY = sumY;

    if (population === 0) {
      this.clearExtent();
      this.bboxDirty = false;
    } else if (this.bboxDirty && view) {
      this.tightenBBox(view);
    }
    this.refreshDerived();
    // The occupancy histogram is O(cells) and is not folded from the
    // ChangeSet. Mark the held value stale until {@link observeEntropy}.
    s.entropyExact = false;
  }

  private captureWorld(view: GridView): void {
    this.boundary = view.boundary;
    this.worldWidth = view.width ?? 0;
    this.worldHeight = view.height ?? 0;
  }

  private expandBBox(x: number, y: number, population: number): void {
    const b = this.stats.bbox;
    if (!this.hasExtent || population === 1) {
      b.x = x;
      b.y = y;
      b.width = 1;
      b.height = 1;
      this.hasExtent = true;
      return;
    }
    if (x < b.x) {
      b.width += b.x - x;
      b.x = x;
    } else if (x >= b.x + b.width) {
      b.width = x - b.x + 1;
    }
    if (y < b.y) {
      b.height += b.y - y;
      b.y = y;
    } else if (y >= b.y + b.height) {
      b.height = y - b.y + 1;
    }
  }

  private noteEdgeDeath(x: number, y: number): void {
    if (!this.hasExtent) return;
    const b = this.stats.bbox;
    if (x === b.x || x === b.x + b.width - 1 || y === b.y || y === b.y + b.height - 1) {
      this.bboxDirty = true;
    }
  }

  /**
   * A 50% soup kills rim cells every tick, which dirties the bbox — but the
   * four edges almost always still hold a live cell. Probing those edges is
   * O(perimeter) and usually exits after a handful of `get`s; only a real
   * shrink walks per-chunk live extents.
   */
  private tightenBBox(view: GridView): void {
    this.bboxDirty = false;
    if (!this.hasExtent) return;
    const b = this.stats.bbox;
    const x1 = b.x + b.width - 1;
    const y1 = b.y + b.height - 1;
    if (
      this.edgeHasLive(view, b.x, b.y, b.x, y1) &&
      this.edgeHasLive(view, x1, b.y, x1, y1) &&
      this.edgeHasLive(view, b.x, b.y, x1, b.y) &&
      this.edgeHasLive(view, b.x, y1, x1, y1)
    ) {
      return;
    }
    this.recomputeBBoxFromChunks(view);
  }

  private edgeHasLive(view: GridView, x0: number, y0: number, x1: number, y1: number): boolean {
    if (x0 === x1) {
      const x = x0;
      const yLo = y0 < y1 ? y0 : y1;
      const yHi = y0 < y1 ? y1 : y0;
      for (let y = yLo; y <= yHi; y++) {
        if (view.get(x, y) !== DEAD) return true;
      }
      return false;
    }
    const y = y0;
    const xLo = x0 < x1 ? x0 : x1;
    const xHi = x0 < x1 ? x1 : x0;
    for (let x = xLo; x <= xHi; x++) {
      if (view.get(x, y) !== DEAD) return true;
    }
    return false;
  }

  private recomputeBBoxFromChunks(view: GridView): void {
    this.bboxDirty = false;
    let minX = 0;
    let minY = 0;
    let maxX = -1;
    let maxY = -1;
    let any = false;
    const bounds = view.bounds();
    if (bounds.width > 0 && bounds.height > 0) {
      view.forEachChunkInRect(bounds, (chunk) => {
        if (chunk.population === 0) return;
        const ox = chunk.cx * CHUNK_SIZE;
        const oy = chunk.cy * CHUNK_SIZE;
        const x0 = ox + chunk.liveMinX;
        const y0 = oy + chunk.liveMinY;
        const x1 = ox + chunk.liveMaxX;
        const y1 = oy + chunk.liveMaxY;
        if (!any) {
          minX = x0;
          minY = y0;
          maxX = x1;
          maxY = y1;
          any = true;
        } else {
          if (x0 < minX) minX = x0;
          if (y0 < minY) minY = y0;
          if (x1 > maxX) maxX = x1;
          if (y1 > maxY) maxY = y1;
        }
      });
    }
    this.writeExtent(any, minX, minY, maxX, maxY);
  }

  private writeExtent(any: boolean, minX: number, minY: number, maxX: number, maxY: number): void {
    if (!any) {
      this.clearExtent();
      return;
    }
    const b = this.stats.bbox;
    b.x = minX;
    b.y = minY;
    b.width = maxX - minX + 1;
    b.height = maxY - minY + 1;
    this.hasExtent = true;
  }

  private clearExtent(): void {
    const b = this.stats.bbox;
    b.x = 0;
    b.y = 0;
    b.width = 0;
    b.height = 0;
    this.hasExtent = false;
    this.sumX = 0;
    this.sumY = 0;
  }

  private refreshDerived(): void {
    const s = this.stats;
    const pop = s.population;
    if (pop === 0) {
      s.density = 0;
      s.centroid.x = 0;
      s.centroid.y = 0;
      return;
    }
    if (this.boundary !== 'infinite' && this.worldWidth > 0 && this.worldHeight > 0) {
      s.density = pop / (this.worldWidth * this.worldHeight);
    } else {
      const area = s.bbox.width * s.bbox.height;
      s.density = area > 0 ? pop / area : 0;
    }
    s.centroid.x = this.sumX / pop;
    s.centroid.y = this.sumY / pop;
  }

  private syncEntropy(sample: EntropySample): void {
    this.stats.entropy = sample.entropy;
    this.stats.entropyExact = sample.exact;
  }
}
