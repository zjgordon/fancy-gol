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
  CHUNK_AREA,
  CHUNK_SIZE,
  WORLD_LIMIT,
  chunkFitsWorld,
  chunkToWorld,
  isCanonicalCell,
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
  type PaintOp,
  type Rect,
  type RuleSet,
  type Snapshot,
  type StateId,
  type StateMigration,
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

function paletteSignature(rs: RuleSet): string {
  return rs.states.map((s) => `${s.id}:${s.kind}:${s.name}`).join('|');
}

function paletteNames(rs: RuleSet): string {
  return rs.states.map((s) => s.name).join(', ');
}

function primaryLiveState(rs: RuleSet): StateId {
  for (const s of rs.states) {
    if (s.countsAsAlive) return s.id;
  }
  throw new RangeError(`ruleset "${rs.name}" has no live state to seed`);
}

export class Simulation {
  private _ruleset: RuleSet;
  private grid: ChunkedGrid;
  private compiled: CompiledRule;
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
  private neighbourScratch: Uint8Array;
  private readonly halo = new Uint8Array(34 * 34);
  private readonly touchedChunks = new Set<number>();

  constructor(opts: SimulationOptions) {
    this._ruleset = opts.ruleset;
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

  get ruleset(): RuleSet {
    return this._ruleset;
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
   * Apply a batch of cell writes and return a `ChangeSet` identical in shape to
   * {@link step}'s — history and rendering treat user edits and evolution uniformly.
   * The arrays are reused; copy them if you need to keep them.
   * No-ops (same state, or outside a bounded world) are not recorded.
   */
  paint(ops: readonly PaintOp[]): ChangeSet {
    this.changeCount = 0;
    this.dirtyCount = 0;
    this.statsState.births = 0;
    this.statsState.deaths = 0;
    this.statsState.transitions = 0;
    this.touchedChunks.clear();
    this.ensureChangeCap(ops.length);

    const stateCount = this.compiled.stateCount;
    const boundary = this._ruleset.boundary;
    const width = this.width;
    const height = this.height;
    let currentKey = 0x7fffffff;
    let chunk: ReturnType<ChunkedGrid['rawChunk']>;
    let marked = false;

    for (let o = 0; o < ops.length; o++) {
      const op = ops[o]!;
      const state = op.state;
      if (state < 0 || state >= stateCount || (state | 0) !== state) {
        throw new RangeError(
          `paint state ${state} is not in "${this._ruleset.name}"'s palette (0..${stateCount - 1})`,
        );
      }
      let x = op.x;
      let y = op.y;
      if (boundary === 'toroidal') {
        x = ((x % width) + width) % width;
        y = ((y % height) + height) % height;
      } else if (boundary === 'bounded') {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
      } else if (x > WORLD_LIMIT || x < -WORLD_LIMIT || y > WORLD_LIMIT || y < -WORLD_LIMIT) {
        throw new RangeError(
          `Coordinate (${x}, ${y}) exceeds the world limit of ±${WORLD_LIMIT} cells per axis`,
        );
      }
      const key = (((x >> 5) & 0xffff) << 16) | ((y >> 5) & 0xffff);
      if (key !== currentKey) {
        chunk = this.grid.rawChunk(key);
        currentKey = key;
        marked = false;
      }
      const idx = ((y & 31) << 5) | (x & 31);
      const prev = chunk?.at(idx) ?? DEAD;
      if (prev === state) continue;
      if (!chunk) {
        if (state === DEAD) continue;
        chunk = this.grid.ensureChunk(key);
      }
      chunk.write(idx, state);
      if (prev === DEAD) this.statsState.births += 1;
      else if (state === DEAD) this.statsState.deaths += 1;
      else this.statsState.transitions += 1;
      this.pushChange(((x & 0xffff) << 16) | (y & 0xffff), prev, state);
      if (!marked) {
        this.touchedChunks.add(key);
        marked = true;
      }
    }

    this.flushTouched();
    this.refreshStats(this.statsState.stepMicros);
    return this.changeSetView();
  }

  /** Empty the grid. Does not advance the tick. */
  clear(): void {
    this.grid.clear();
    this.changeCount = 0;
    this.dirtyCount = 0;
    this.statsState.births = 0;
    this.statsState.deaths = 0;
    this.statsState.transitions = 0;
    this.refreshStats(this.statsState.stepMicros);
  }

  /**
   * Replace the field with a random soup of the primary live state. Requires a
   * finite width×height (the 1M-cell AC uses 1024×1024). Reproducible for a
   * given `(density, seed)` pair; consumes `this` RNG from `seed`.
   */
  seedRandom(density: number, seed: number): void {
    if (!(density >= 0 && density <= 1)) {
      throw new RangeError(`density must be in [0, 1], got ${density}`);
    }
    if (this.width <= 0 || this.height <= 0) {
      throw new RangeError('seedRandom requires width and height');
    }
    this.grid.clear();
    this.rng.reset(seed);
    this.touchedChunks.clear();
    const live = primaryLiveState(this._ruleset);
    const width = this.width;
    const height = this.height;
    let currentKey = 0x7fffffff;
    let chunk: ReturnType<ChunkedGrid['ensureChunk']> | undefined;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (this.rng.next() >= density) continue;
        const [cx, cy] = worldToChunk(x, y);
        const key = packChunk(cx, cy);
        if (key !== currentKey) {
          chunk = this.grid.ensureChunk(key);
          currentKey = key;
          this.touchedChunks.add(key);
        }
        chunk!.write(localIndex(x, y), live);
      }
    }

    this.flushTouched();
    this.changeCount = 0;
    this.dirtyCount = 0;
    this.refreshStats(this.statsState.stepMicros);
  }

  /**
   * Swap the running rule. A differing state palette requires {@link StateMigration}
   * — silent reinterpretation of live cells is forbidden and produces beautiful nonsense.
   */
  setRuleset(rs: RuleSet, migrate?: StateMigration): void {
    const prev = this._ruleset;
    const palettesDiffer = paletteSignature(prev) !== paletteSignature(rs);
    if (palettesDiffer && migrate === undefined) {
      throw new RuleValidationError([
        {
          path: '/states',
          message: `switching from "${prev.name}" (${paletteNames(prev)}) to "${rs.name}" (${paletteNames(rs)}) requires a StateMigration`,
          hint: 'pass migrate: (old) => newState; silent reinterpretation of a live cell under a new palette is forbidden',
        },
      ]);
    }
    if (rs.boundary !== 'infinite' && (this.width <= 0 || this.height <= 0)) {
      throw new RangeError(`boundary "${rs.boundary}" requires width and height`);
    }

    if (migrate !== undefined) {
      this.migrateCells(migrate, rs.states.length);
    }
    if (rs.boundary !== prev.boundary) {
      this.retile(rs.boundary);
    }

    this._ruleset = rs;
    this.compiled = compileRule(rs);
    this.neighbourScratch = new Uint8Array(this.compiled.neighbourCount);
    this.refreshStats(this.statsState.stepMicros);
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
    keys.sort((a, b) => a - b);
    const chunkKeys = Int32Array.from(keys);
    const chunkData = new Uint8Array(keys.length * CHUNK_AREA);
    for (let i = 0; i < keys.length; i++) {
      const chunk = this.grid.rawChunk(keys[i]!);
      if (chunk) chunkData.set(chunk.data, i * CHUNK_AREA);
    }
    return { tick: this._tick, chunkKeys, chunkData, rngState: this.rng.state };
  }

  restore(s: Snapshot): void {
    const n = s.chunkKeys.length;
    if (s.chunkData.length !== n * CHUNK_AREA) {
      throw new RangeError(
        `snapshot chunkData length ${s.chunkData.length} does not match ${n} chunks of ${CHUNK_AREA}`,
      );
    }
    this.grid.clear();
    this._tick = s.tick;
    this.rng.reset(s.rngState);
    for (let i = 0; i < n; i++) {
      const key = s.chunkKeys[i]!;
      const chunk = this.grid.ensureChunk(key);
      chunk.load(s.chunkData.subarray(i * CHUNK_AREA, (i + 1) * CHUNK_AREA));
      this.grid.finishWrite(key, true);
    }
    this.refreshStats(0);
  }

  private flushTouched(): void {
    for (const key of this.touchedChunks) {
      this.grid.rawChunk(key)?.rebuildBorderMask();
      this.grid.finishWrite(key, true);
      this.pushDirty(key);
    }
    this.touchedChunks.clear();
  }

  private migrateCells(migrate: StateMigration, stateCount: number): void {
    this.touchedChunks.clear();
    this.grid.forEachRawChunk((key, chunk) => {
      const [ox, oy] = chunkToWorld(unpackChunkX(key), unpackChunkY(key));
      const fits = chunkFitsWorld(ox, oy, this._ruleset.boundary, this.width, this.height);
      let any = false;
      for (let i = 0; i < 1024; i++) {
        const x = ox + (i & 31);
        const y = oy + (i >> 5);
        if (!fits && !isCanonicalCell(x, y, this._ruleset.boundary, this.width, this.height)) {
          continue;
        }
        const prev = chunk.at(i);
        const next = migrate(prev);
        if (next < 0 || next >= stateCount || (next | 0) !== next) {
          throw new RangeError(
            `StateMigration returned ${next}, which is not in the new palette (0..${stateCount - 1})`,
          );
        }
        if (next === prev) continue;
        chunk.set(i, next);
        any = true;
      }
      if (any) this.touchedChunks.add(key);
    });
    this.flushTouched();
  }

  private retile(boundary: 'bounded' | 'toroidal' | 'infinite'): void {
    const pending: Array<{ x: number; y: number; state: StateId }> = [];
    this.grid.forEachRawChunk((key, chunk) => {
      const [ox, oy] = chunkToWorld(unpackChunkX(key), unpackChunkY(key));
      for (let i = 0; i < 1024; i++) {
        const state = chunk.data[i] ?? DEAD;
        if (state === DEAD) continue;
        pending.push({ x: ox + (i & 31), y: oy + (i >> 5), state });
      }
    });
    this.grid = new ChunkedGrid({
      boundary,
      ...(this.width > 0 ? { width: this.width } : {}),
      ...(this.height > 0 ? { height: this.height } : {}),
    });
    for (const cell of pending) this.grid.set(cell.x, cell.y, cell.state);
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
    if (!chunkFitsWorld(ox, oy, this.ruleset.boundary, this.width, this.height)) {
      this.fillHaloByRead(ox, oy);
      return;
    }
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

  /**
   * Slow halo fill for a page that straddles a world edge: every sample goes
   * through {@link normalize}, so a wall or wrap inside the 32×32 page is honoured
   * the same way as one that falls on a chunk seam.
   */
  private fillHaloByRead(ox: number, oy: number): void {
    const halo = this.halo;
    for (let hy = -1; hy <= CHUNK_SIZE; hy++) {
      const row = (hy + 1) * 34;
      for (let hx = -1; hx <= CHUNK_SIZE; hx++) {
        halo[row + (hx + 1)] = this.read(ox + hx, oy + hy);
      }
    }
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
    const fits = chunkFitsWorld(ox, oy, this.ruleset.boundary, this.width, this.height);
    let any = false;
    let borderChanged = false;
    for (let i = 0; i < 1024; i++) {
      const lx = i & 31;
      const ly = i >> 5;
      const x = ox + lx;
      const y = oy + ly;
      if (!fits && !isCanonicalCell(x, y, this.ruleset.boundary, this.width, this.height)) {
        const leftover = chunk?.data[i] ?? DEAD;
        if (leftover !== DEAD && chunk) {
          chunk.set(i, DEAD);
          any = true;
        }
        continue;
      }
      const next = back[i] ?? DEAD;
      const prev = chunk?.data[i] ?? DEAD;
      if (next === prev) continue;
      if (!chunk) {
        if (next === DEAD) continue;
        chunk = this.grid.ensureChunk(key);
      }
      chunk.set(i, next);
      this.recordTransition(prev, next);
      this.pushChange(packCell(x, y), prev, next);
      any = true;
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
    if (this.changeCount === this.coords.length) this.ensureChangeCap(this.changeCount + 1);
    this.coords[this.changeCount] = packed;
    this.from[this.changeCount] = from;
    this.to[this.changeCount] = to;
    this.changeCount += 1;
  }

  private ensureChangeCap(needed: number): void {
    if (needed <= this.coords.length) return;
    let cap = this.coords.length;
    while (cap < needed) cap *= 2;
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
