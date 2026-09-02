/**
 * `Simulation` — the hot loop. Reads a `ChunkedGrid`, writes a reused `ChangeSet`,
 * and never asks the UI whether it exists.
 *
 * Double-buffering is per-chunk: every active chunk's next 1024 bytes are written
 * into a pooled back buffer, then applied only after *every* chunk has been
 * computed, so a neighbour still sees last tick's cells.
 */
import type { Clock } from './clock';
import { compileRule, type CompiledRule } from './rules/compile';
import { RuleValidationError } from './rules/errors';
import { ChunkedGrid } from './grid/chunked-grid';
import {
  CHUNK_SIZE,
  chunkToWorld,
  localIndex,
  normalize,
  packCell,
  packChunk,
  unpackChunkX,
  unpackChunkY,
  worldToChunk,
} from './grid/coords';
import { Mulberry32 } from './rng';
import {
  DEAD,
  type ChangeSet,
  type GridView,
  type Rect,
  type RuleSet,
  type Snapshot,
  type StateId,
} from './types';

const DEFAULT_SEED = 0x9e3779b9;
const INITIAL_CHANGE_CAP = 1024;
const ZERO_PAGE = new Uint8Array(1024);

export interface SimulationOptions {
  readonly ruleset: RuleSet;
  readonly width?: number;
  readonly height?: number;
  /** PRNG seed; default `0x9e3779b9`. */
  readonly seed?: number;
  /** History lands in P0-F-1; pass `false` to be explicit. */
  readonly history?: false;
  /** Injected clock for `TickStats.stepMicros`. Defaults to a zero-delta stub. */
  readonly clock?: Clock;
}

export interface TickStats {
  tick: number;
  population: number;
  perState: Uint32Array;
  births: number;
  deaths: number;
  transitions: number;
  activeChunks: number;
  stepMicros: number;
}

const ZERO_CLOCK: Clock = { now: () => 0 };

export class Simulation {
  readonly ruleset: RuleSet;
  private readonly grid: ChunkedGrid;
  private readonly compiled: CompiledRule;
  private readonly clock: Clock;
  private readonly rng: Mulberry32;
  private readonly width: number;
  private readonly height: number;

  private _tick = 0;
  private readonly statsState: TickStats = {
    tick: 0,
    population: 0,
    perState: new Uint32Array(256),
    births: 0,
    deaths: 0,
    transitions: 0,
    activeChunks: 0,
    stepMicros: 0,
  };

  private coords = new Int32Array(INITIAL_CHANGE_CAP);
  private from = new Uint8Array(INITIAL_CHANGE_CAP);
  private to = new Uint8Array(INITIAL_CHANGE_CAP);
  private dirtyChunkKeys = new Int32Array(16);
  private changeCount = 0;
  private dirtyCount = 0;

  private workList = new Int32Array(16);
  private workCount = 0;
  private readonly backs: Uint8Array[] = [];
  private readonly neighbourScratch: Uint8Array;
  private readonly halo = new Uint8Array(34 * 34);

  constructor(opts: SimulationOptions) {
    this.ruleset = opts.ruleset;
    this.width = opts.width ?? 0;
    this.height = opts.height ?? 0;
    if (
      opts.ruleset.boundary !== 'infinite' &&
      (opts.width === undefined || opts.height === undefined)
    ) {
      throw new RangeError(`boundary "${opts.ruleset.boundary}" requires width and height`);
    }
    this.grid = new ChunkedGrid({
      boundary: opts.ruleset.boundary,
      ...(opts.width !== undefined ? { width: opts.width } : {}),
      ...(opts.height !== undefined ? { height: opts.height } : {}),
    });
    this.compiled = compileRule(opts.ruleset);
    this.clock = opts.clock ?? ZERO_CLOCK;
    this.rng = new Mulberry32(opts.seed ?? DEFAULT_SEED);
    this.neighbourScratch = new Uint8Array(this.compiled.neighbourCount);
  }

  get tick(): number {
    return this._tick;
  }

  get stats(): Readonly<TickStats> {
    return this.statsState;
  }

  get(x: number, y: number): StateId {
    return this.grid.get(x, y);
  }

  set(x: number, y: number, state: StateId): void {
    this.grid.set(x, y, state);
  }

  view(): GridView {
    return this.grid.view();
  }

  bounds(): Rect {
    return this.grid.bounds();
  }

  /**
   * Exactly one generation. The returned `ChangeSet` arrays are reused on the next
   * `step()` — copy them if you need to keep them.
   */
  step(): ChangeSet {
    if (this.compiled.turmite) {
      throw new RuleValidationError([
        {
          path: '/transition',
          message: 'turmite rules are not stepped as a per-cell CA',
          hint: 'the agent loop lands with the rest of the Simulation; until then, only cellular rules can step',
        },
      ]);
    }

    const t0 = this.clock.now();
    this.collectWork();
    this.grid.activeChunks.clear();
    this.grid.reclaim(this._tick);

    this.ensureBacks(this.workCount);
    for (let i = 0; i < this.workCount; i++) {
      this.computeChunk(this.workList[i]!, this.backs[i]!);
    }

    this.changeCount = 0;
    this.dirtyCount = 0;
    this.statsState.births = 0;
    this.statsState.deaths = 0;
    this.statsState.transitions = 0;

    for (let i = 0; i < this.workCount; i++) {
      this.applyChunk(this.workList[i]!, this.backs[i]!);
    }

    this._tick += 1;
    this.refreshStats(this.clock.now() - t0);
    return this.changeSetView();
  }

  /** Run `n` generations and return a coalesced ChangeSet from the first tick's before to the last tick's after. */
  stepMany(n: number): ChangeSet {
    if (n <= 0) return this.changeSetView();
    if (n === 1) return this.step();

    const original = new Map<number, number>();
    const latest = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const cs = this.step();
      for (let k = 0; k < cs.count; k++) {
        const packed = cs.coords[k]!;
        if (!original.has(packed)) original.set(packed, cs.from[k]!);
        latest.set(packed, cs.to[k]!);
      }
    }
    this.changeCount = 0;
    for (const [packed, toState] of latest) {
      const fromState = original.get(packed) ?? toState;
      if (fromState === toState) continue;
      this.pushChange(packed, fromState, toState);
    }
    this.dirtyCount = 0;
    return this.changeSetView();
  }

  snapshot(): Snapshot {
    const keys: number[] = [];
    this.grid.forEachRawChunk((key, chunk) => {
      if (chunk.population > 0) keys.push(key);
    });
    const chunkKeys = Int32Array.from(keys);
    const chunkData = new Uint8Array(keys.length * 1024);
    keys.forEach((key, i) => {
      const chunk = this.grid.rawChunk(key);
      if (chunk) chunkData.set(chunk.data, i * 1024);
    });
    return { tick: this._tick, chunkKeys, chunkData, rngState: this.rng.state };
  }

  restore(s: Snapshot): void {
    this.grid.clear();
    this._tick = s.tick;
    this.rng.reset(s.rngState);
    for (let i = 0; i < s.chunkKeys.length; i++) {
      const key = s.chunkKeys[i]!;
      const slice = s.chunkData.subarray(i * 1024, (i + 1) * 1024);
      const [ox, oy] = chunkToWorld(unpackChunkX(key), unpackChunkY(key));
      for (let c = 0; c < 1024; c++) {
        const state = slice[c]!;
        if (state !== DEAD) this.grid.set(ox + (c & 31), oy + (c >> 5), state);
      }
    }
    this.refreshStats(0);
  }

  private collectWork(): void {
    this.workCount = 0;
    for (const key of this.grid.activeChunks) {
      if (this.workCount === this.workList.length) {
        const grown = new Int32Array(this.workList.length * 2);
        grown.set(this.workList);
        this.workList = grown;
      }
      this.workList[this.workCount++] = key;
    }
  }

  private ensureBacks(n: number): void {
    while (this.backs.length < n) this.backs.push(new Uint8Array(1024));
  }

  private computeChunk(key: number, back: Uint8Array): void {
    const chunk = this.grid.rawChunk(key);
    const src = chunk?.data;
    const empty = !chunk || chunk.population === 0;
    const [cx, cy] = [unpackChunkX(key), unpackChunkY(key)];
    const [ox, oy] = chunkToWorld(cx, cy);
    const r = this.compiled.maxRadius;
    const lut8 = this.compiled.strategy === 'lut8' && r === 1;

    if (empty && this.compiled.stableWhenIsolated) {
      back.fill(0);
      if (lut8) this.computeLut8Border(src ?? ZERO_PAGE, back, ox, oy);
      else this.computeGeneralBorder(src, back, ox, oy, r);
      return;
    }

    if (lut8) {
      this.computeLut8(src ?? ZERO_PAGE, back, ox, oy);
      return;
    }

    const neighbours = this.neighbourScratch;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = (ly << 5) | lx;
        const state = src?.[i] ?? DEAD;
        this.gatherNeighbours(ox + lx, oy + ly, neighbours);
        back[i] = this.compiled.next(state, neighbours);
      }
    }
  }

  private computeLut8Border(src: Uint8Array, back: Uint8Array, ox: number, oy: number): void {
    const table = this.compiled.table!;
    const alive = this.compiled.aliveMask;
    const last = CHUNK_SIZE - 1;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (lx !== 0 && ly !== 0 && lx !== last && ly !== last) continue;
        const i = (ly << 5) | lx;
        back[i] = this.lut8Halo(src[i] ?? DEAD, ox + lx, oy + ly, table, alive);
      }
    }
  }

  private computeGeneralBorder(
    src: Uint8Array | undefined,
    back: Uint8Array,
    ox: number,
    oy: number,
    r: number,
  ): void {
    const neighbours = this.neighbourScratch;
    const lo = r;
    const hi = CHUNK_SIZE - r;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (lx >= lo && lx < hi && ly >= lo && ly < hi) continue;
        const i = (ly << 5) | lx;
        const state = src?.[i] ?? DEAD;
        this.gatherNeighbours(ox + lx, oy + ly, neighbours);
        back[i] = this.compiled.next(state, neighbours);
      }
    }
  }

  private computeLut8(src: Uint8Array, back: Uint8Array, ox: number, oy: number): void {
    const table = this.compiled.table!;
    const alive = this.compiled.aliveMask;
    const halo = this.halo;
    this.fillHaloFromChunks(src, ox, oy);

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = (ly << 5) | lx;
        const hi = (ly + 1) * 34 + (lx + 1);
        const state = src[i] ?? DEAD;
        const live =
          (alive[halo[hi - 35] ?? 0] ?? 0) +
          (alive[halo[hi - 34] ?? 0] ?? 0) +
          (alive[halo[hi - 33] ?? 0] ?? 0) +
          (alive[halo[hi - 1] ?? 0] ?? 0) +
          (alive[halo[hi + 1] ?? 0] ?? 0) +
          (alive[halo[hi + 33] ?? 0] ?? 0) +
          (alive[halo[hi + 34] ?? 0] ?? 0) +
          (alive[halo[hi + 35] ?? 0] ?? 0);
        back[i] = table[state * 9 + live] ?? 0;
      }
    }
  }

  /** Copy this chunk plus its 8 neighbours' abutting edges into the 34×34 halo pad. */
  private fillHaloFromChunks(src: Uint8Array, ox: number, oy: number): void {
    const halo = this.halo;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const row = (ly + 1) * 34 + 1;
      const srcRow = ly << 5;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) halo[row + lx] = src[srcRow + lx] ?? 0;
    }
    const north = this.page(ox, oy - 1);
    const south = this.page(ox, oy + CHUNK_SIZE);
    const west = this.page(ox - 1, oy);
    const east = this.page(ox + CHUNK_SIZE, oy);
    const nw = this.page(ox - 1, oy - 1);
    const ne = this.page(ox + CHUNK_SIZE, oy - 1);
    const sw = this.page(ox - 1, oy + CHUNK_SIZE);
    const se = this.page(ox + CHUNK_SIZE, oy + CHUNK_SIZE);
    for (let i = 0; i < CHUNK_SIZE; i++) {
      halo[0 * 34 + (i + 1)] = north[31 * 32 + i] ?? 0; // N: neighbour's south row
      halo[33 * 34 + (i + 1)] = south[i] ?? 0; // S: neighbour's north row
      halo[(i + 1) * 34 + 0] = west[i * 32 + 31] ?? 0; // W: neighbour's east col
      halo[(i + 1) * 34 + 33] = east[i * 32] ?? 0; // E: neighbour's west col
    }
    halo[0] = nw[31 * 32 + 31] ?? 0;
    halo[33] = ne[31 * 32] ?? 0;
    halo[33 * 34] = sw[31] ?? 0;
    halo[33 * 34 + 33] = se[0] ?? 0;
  }

  /** The 1024-byte page containing (x, y), or a zero page if that chunk is not allocated. */
  private page(x: number, y: number): Uint8Array {
    const norm = normalize(x, y, this.ruleset.boundary, this.width, this.height);
    if (norm === null) return ZERO_PAGE;
    const [nx, ny] = norm;
    const [cx, cy] = worldToChunk(nx, ny);
    return this.grid.rawChunk(packChunk(cx, cy))?.data ?? ZERO_PAGE;
  }

  private lut8Halo(
    state: StateId,
    x: number,
    y: number,
    table: Uint8Array,
    alive: Uint8Array,
  ): StateId {
    let live = 0;
    live += alive[this.read(x - 1, y - 1)] ?? 0;
    live += alive[this.read(x, y - 1)] ?? 0;
    live += alive[this.read(x + 1, y - 1)] ?? 0;
    live += alive[this.read(x - 1, y)] ?? 0;
    live += alive[this.read(x + 1, y)] ?? 0;
    live += alive[this.read(x - 1, y + 1)] ?? 0;
    live += alive[this.read(x, y + 1)] ?? 0;
    live += alive[this.read(x + 1, y + 1)] ?? 0;
    return table[state * 9 + live] ?? 0;
  }

  private gatherNeighbours(x: number, y: number, neighbours: Uint8Array): void {
    const packed = this.compiled.neighborhood.offsetsByParity[y & 1]!;
    for (let i = 0; i < this.compiled.neighbourCount; i++) {
      neighbours[i] = this.read(x + packed[i * 2]!, y + packed[i * 2 + 1]!);
    }
  }

  private read(x: number, y: number): StateId {
    const norm = normalize(x, y, this.ruleset.boundary, this.width, this.height);
    if (norm === null) return DEAD;
    const [nx, ny] = norm;
    const [cx, cy] = worldToChunk(nx, ny);
    return this.grid.rawChunk(packChunk(cx, cy))?.at(localIndex(nx, ny)) ?? DEAD;
  }

  private applyChunk(key: number, back: Uint8Array): void {
    let chunk = this.grid.rawChunk(key);
    const [ox, oy] = chunkToWorld(unpackChunkX(key), unpackChunkY(key));
    let any = false;
    let borderChanged = false;
    for (let i = 0; i < 1024; i++) {
      const next = back[i] ?? DEAD;
      const prev = chunk?.data[i] ?? DEAD;
      if (next === prev) continue;
      if (!chunk) {
        if (next === DEAD) continue;
        chunk = this.grid.ensureChunk(key);
      }
      chunk.set(i, next);
      const x = ox + (i & 31);
      const y = oy + (i >> 5);
      this.recordTransition(prev, next);
      this.pushChange(packCell(x, y), prev, next);
      any = true;
      const lx = i & 31;
      const ly = i >> 5;
      if (lx === 0 || ly === 0 || lx === 31 || ly === 31) borderChanged = true;
    }
    if (any && chunk) {
      this.grid.finishWrite(key, borderChanged);
      this.pushDirty(key);
    }
  }

  private recordTransition(prev: StateId, next: StateId): void {
    if (prev === DEAD && next !== DEAD) this.statsState.births += 1;
    else if (prev !== DEAD && next === DEAD) this.statsState.deaths += 1;
    else if (prev !== DEAD && next !== DEAD) this.statsState.transitions += 1;
  }

  private pushChange(packed: number, from: StateId, to: StateId): void {
    if (this.changeCount === this.coords.length) {
      const cap = this.coords.length * 2;
      const coords = new Int32Array(cap);
      coords.set(this.coords);
      this.coords = coords;
      const fromA = new Uint8Array(cap);
      fromA.set(this.from);
      this.from = fromA;
      const toA = new Uint8Array(cap);
      toA.set(this.to);
      this.to = toA;
    }
    this.coords[this.changeCount] = packed;
    this.from[this.changeCount] = from;
    this.to[this.changeCount] = to;
    this.changeCount += 1;
  }

  private pushDirty(key: number): void {
    if (this.dirtyCount === this.dirtyChunkKeys.length) {
      const grown = new Int32Array(this.dirtyChunkKeys.length * 2);
      grown.set(this.dirtyChunkKeys);
      this.dirtyChunkKeys = grown;
    }
    this.dirtyChunkKeys[this.dirtyCount++] = key;
  }

  private refreshStats(stepMicros: number): void {
    const per = this.statsState.perState;
    per.fill(0);
    let population = 0;
    const stateCount = this.compiled.stateCount;
    this.grid.forEachRawChunk((_key, chunk) => {
      population += chunk.population;
      for (let s = 0; s < stateCount; s++) per[s] = (per[s] ?? 0) + (chunk.perState[s] ?? 0);
    });
    this.statsState.tick = this._tick;
    this.statsState.population = population;
    this.statsState.activeChunks = this.grid.activeChunks.size;
    this.statsState.stepMicros = stepMicros;
  }

  private changeSetView(): ChangeSet {
    return {
      tick: this._tick,
      coords: this.coords,
      from: this.from,
      to: this.to,
      count: this.changeCount,
      dirtyChunks: this.dirtyChunkKeys.subarray(0, this.dirtyCount),
    };
  }
}
