/**
 * The engine's public type vocabulary (ADR-001), and everything that crosses the worker
 * or network boundary (ADR-006, ADR-009: the `shared` layer may only import from itself,
 * so anything `src/shared/protocol.ts` needs — `RuleSet`, `PaintOp`, `ChangeSet`, … — has
 * to live here rather than in `src/engine/`). `src/engine/types.ts` re-exports this module
 * in full, so every existing `@engine/types` import keeps working unchanged.
 *
 * Mostly pure data shapes, no imports beyond itself — plus the small amount of chunk-coordinate
 * maths (`CHUNK_SIZE`, `chunkToWorld`, `localIndex`) that any layer walking a `ChunkView` needs
 * to interpret its documented packing scheme, `render/` included (ADR-009: `render/` may import
 * `shared/`, never `engine/`).
 *
 * That coordinate maths is *independently defined* here and in `engine/grid/coords.ts`, not
 * re-exported from one to the other — routing `Simulation`'s hot loop through the extra module
 * hop cost a real, reproducible ~25% regression on the 512² soup floor test (P0-E-1), proven by
 * toggling only that indirection with everything else held constant. See `grid/coords.ts`'s own
 * note; this is a deliberate exception to "one definition," not an oversight.
 */

/** An unsigned cell state id. `0` is always reserved for "dead"/background. */
export type StateId = number;

/** The reserved dead/background state. Every {@link RuleSet} must define exactly one state with this id. */
export const DEAD: StateId = 0;

/** One entry in a {@link RuleSet}'s state palette. */
export interface StateDef {
  /** The numeric id used everywhere a cell's state is stored (grid bytes, `ChangeSet`, …). */
  readonly id: StateId;
  /** Human-readable name, e.g. "alive", "dying", "electron-head", "highland". */
  readonly name: string;
  /** Semantic role driving default stats grouping and render treatment. */
  readonly kind: 'dead' | 'live' | 'decay' | 'inert';
  /** Whether this state counts toward a neighbour's live-neighbour tally. */
  readonly countsAsAlive: boolean;
}

/** The neighbour set a rule's transition function reads. */
export type Neighborhood =
  | { readonly kind: 'moore'; readonly radius: number }
  | { readonly kind: 'vonNeumann'; readonly radius: number }
  | { readonly kind: 'hex' }
  | { readonly kind: 'custom'; readonly offsets: ReadonlyArray<readonly [number, number]> };

/** One row of a {@link TransitionSpec} with `kind: 'weighted'`: a threshold on the weighted neighbour sum. */
export interface TransitionRow {
  /** Inclusive lower bound on the weighted neighbour sum for this row to apply. */
  readonly min: number;
  /** Inclusive upper bound on the weighted neighbour sum for this row to apply. */
  readonly max: number;
  /** The state a cell transitions to when its weighted sum falls in `[min, max]`. */
  readonly toState: StateId;
}

/** One row of a {@link TransitionSpec} with `kind: 'turmite'` (Langton's-Ant-class agents). */
export interface TurmiteRow {
  /** The turmite's own internal (machine) state. */
  readonly state: number;
  /** The cell state read at the turmite's current location. */
  readonly onCellState: StateId;
  /** The cell state written to that location before the turmite moves. */
  readonly writeState: StateId;
  /** Turn relative to the turmite's current heading. */
  readonly turn: 'left' | 'right' | 'uturn' | 'none';
  /** The turmite's internal state after this step. */
  readonly nextState: number;
}

/** How a rule decides a cell's next state, keyed by the shape of the rule. */
export type TransitionSpec =
  | {
      readonly kind: 'totalistic';
      readonly born: readonly number[];
      readonly survive: readonly number[];
      readonly decayStates?: number;
    }
  | {
      readonly kind: 'generations';
      readonly born: readonly number[];
      readonly survive: readonly number[];
      readonly states: number;
    }
  | { readonly kind: 'stateTable'; readonly table: Uint8Array; readonly radix: number }
  | {
      readonly kind: 'weighted';
      readonly weights: readonly number[];
      readonly thresholds: readonly TransitionRow[];
    }
  | { readonly kind: 'turmite'; readonly states: readonly TurmiteRow[] };

/**
 * A complete, declarative cellular-automaton rule. Rules are data, not code branches
 * ("Composable rulesets" — INCEPTION.md) — the engine takes this object and compiles it
 * (see `rules/compile.ts`) into the fastest strategy its shape allows.
 */
export interface RuleSet {
  /** Stable identifier, e.g. `"conway"`, `"brians-brain"`, `"user:my-rule"`. */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  /** The state palette. Ids must be contiguous from 0, with exactly one `kind: 'dead'` at id 0. */
  readonly states: readonly StateDef[];
  readonly neighborhood: Neighborhood;
  readonly transition: TransitionSpec;
  readonly boundary: 'bounded' | 'toroidal' | 'infinite';
  /** Hints for the compiler and the pattern library; not load-bearing for correctness. */
  readonly symmetry?: 'none' | 'rotational';
}

/** An axis-aligned rectangle in world (cell) coordinates. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A single cell write. Brushes, stamps and pattern placement are all UI concepts that
 * resolve to a flat list of these before crossing into the engine — the engine never hears
 * the word "brush".
 */
export interface PaintOp {
  readonly x: number;
  readonly y: number;
  readonly state: StateId;
}

/**
 * What changed in one step or paint operation. The load-bearing type of the whole project
 * (ADR-007): history, statistics and dirty-rect rendering are all derived from it.
 *
 * The arrays are reused across ticks and grow by doubling — only the first `count` entries
 * of each are valid. Callers that need to retain a `ChangeSet` past the next `step()` call
 * must copy it; the engine does not.
 */
export interface ChangeSet {
  readonly tick: number;
  /** Packed `(x << 16) | (y & 0xffff)` per change. */
  readonly coords: Int32Array;
  readonly from: Uint8Array;
  readonly to: Uint8Array;
  /** Valid prefix length of `coords`/`from`/`to`. */
  readonly count: number;
  /** Packed chunk coordinates (see `grid/coords.ts`) touched by this change set. */
  readonly dirtyChunks: Int32Array;
}

/** A read-only, no-copy view onto one 32×32 chunk of the grid, for renderers and stats. */
export interface ChunkView {
  readonly cx: number;
  readonly cy: number;
  /** Count of cells whose state is not {@link DEAD}. */
  readonly population: number;
  /** Read a single cell by its local index within the chunk (`(y & 31) << 5 | (x & 31)`). */
  at(localIndex: number): StateId;
}

/** Chunk sizing (ADR-010) and the pure coordinate maths — {@link chunkToWorld}, {@link localIndex} — that compute `ChunkView`'s own documented local-index scheme. `engine/` re-exports these unchanged from `grid/coords.ts`; `render/` (which may only import `shared/`, ADR-009) imports them directly to walk a `GridView` without any engine import. Boundary-aware maths (wrapping, world-limit clamping, the packed chunk-key scheme) stays engine-internal — a renderer only ever sees a `GridView`'s already-resolved chunks, never a raw simulation coordinate that might need it. */
export const CHUNK_BITS = 5;
export const CHUNK_SIZE = 32; // 2 ** CHUNK_BITS
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE; // 1024
const CHUNK_MASK = CHUNK_SIZE - 1; // 31

/** The world coordinate of a chunk's top-left cell. */
export function chunkToWorld(cx: number, cy: number): readonly [x: number, y: number] {
  return [cx * CHUNK_SIZE, cy * CHUNK_SIZE];
}

/** A cell's index within its chunk's flat `Uint8Array(1024)` — the scheme `ChunkView.at()` documents. */
export function localIndex(x: number, y: number): number {
  return ((y & CHUNK_MASK) << CHUNK_BITS) | (x & CHUNK_MASK);
}

/**
 * A read-only, no-copy façade over the grid, handed to the renderer and stats engine.
 * No method on this interface may return a mutable reference to chunk data.
 */
export interface GridView {
  readonly boundary: 'bounded' | 'toroidal' | 'infinite';
  get(x: number, y: number): StateId;
  /** The bounding box of live cells. */
  bounds(): Rect;
  forEachChunkInRect(rect: Rect, fn: (chunk: ChunkView) => void): void;
  getChunk(cx: number, cy: number): ChunkView | undefined;
}

/**
 * A transferable, structured-clone-safe capture of a `Simulation`'s state (ADR-007/P0-E-4).
 * Round-trips through `structuredClone` and `postMessage` with no loss.
 */
export interface Snapshot {
  readonly tick: number;
  /** One packed chunk coordinate per live chunk, same order as `chunkData` slices. */
  readonly chunkKeys: Int32Array;
  /** Every live chunk's 1024 bytes, concatenated in `chunkKeys` order. */
  readonly chunkData: Uint8Array;
  /** The PRNG's internal state, for deterministic replay after restore. */
  readonly rngState: number;
}

/**
 * Maps state ids from an old {@link RuleSet} to a new one. Required by `setRuleset` whenever
 * the new ruleset's state palette differs from the old one — silent reinterpretation of a
 * live cell's state id under a new palette is forbidden.
 */
export type StateMigration = (old: StateId) => StateId;

/**
 * A `Simulation`'s per-tick numbers (ADR-006's `frame` event carries one). `perState` is
 * indexed by {@link StateId}; only entries `0..states.length-1` are meaningful for a given
 * ruleset, the rest are always zero.
 */
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

/**
 * One sample of the stat engine's time series (ADR-006's `stats` event; Phase 2 §2.2 pins
 * this exact shape). `StatsCollector` (P0-F-2) already produces `tick`/`population`/
 * `perState`/`births`/`deaths`/`transitions`/`activity`; `density`/`bbox`/`centroid`/
 * `entropy`/`hash` are P2-C-1/P2-C-2's to compute — declared now so the wire shape never
 * has to change shape under Phase 2, only get populated.
 */
export interface StatSample {
  tick: number;
  population: number;
  perState: Uint32Array;
  births: number;
  deaths: number;
  transitions: number;
  /** Changed cells this tick. */
  activity: number;
  /** Population / bounded area, or / bbox area when infinite. */
  density: number;
  bbox: Rect;
  centroid: { x: number; y: number };
  /** Shannon entropy over a 16×16 block-occupancy histogram (P2-C-2). */
  entropy: number;
  /** Zobrist hash of live state, for cycle detection (P2-C-3). */
  hash: number;
}
