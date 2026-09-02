/**
 * Compiles a declarative {@link RuleSet} into the fastest per-cell decision its shape
 * allows. Rules stay data; this is where they become a lookup table or a monomorphic
 * function — chosen once, cached on the ruleset object, never rebuilt per step.
 *
 * Strategy selection (first match wins):
 *  | 2 states, totalistic, Moore r=1                         | `lut8`       |
 *  | ≤8 states, totalistic/generations, ≤24 neighbours       | `lutN`       |
 *  | `stateTable` whose dense table fits under 4 MB          | `denseTable` |
 *  | anything else                                           | `closure`    |
 *
 * The phase plan writes lutN's size as `states × (neighbours+1) × states`. After
 * collapsing per-state neighbour counts to a single alive-count, the third axis
 * is unused padding, so the table is stored as `states × (neighbours+1)` bytes
 * indexed `state * (neighbours+1) + liveCount`. Same answers, a factor-of-states
 * less memory, and a simpler hot-path index.
 */
import { compileNeighborhood, type CompiledNeighborhood } from '../neighborhood';
import type { RuleSet, StateId, TransitionRow, TransitionSpec, TurmiteRow } from '../types';
import { RuleValidationError } from './errors';

/** Cap on a compiler-built (or reused) dense transition table. 4 MiB. */
export const DENSE_TABLE_BUDGET = 4 * 1024 * 1024;

/** Neighbour-count ceiling for the `lutN` strategy. Moore r=2 is exactly 24. */
export const LUT_N_MAX_NEIGHBOURS = 24;

/** State-count ceiling for the `lutN` strategy. */
export const LUT_N_MAX_STATES = 8;

export type CompileStrategy = 'lut8' | 'lutN' | 'denseTable' | 'closure';

export interface CompileOptions {
  /**
   * Skip automatic selection and build this strategy. Used by the equivalence
   * test to produce a `closure` artefact for the same rule the auto path compiled
   * as a LUT. Throws {@link RuleValidationError} if the rule cannot use it.
   */
  readonly forceStrategy?: CompileStrategy;
}

/**
 * Packed turmite lookup, so the simulation does not scan `rows` per agent step.
 * `lookup[machineState * stateCount + cellState]` is an index into `rows`, or
 * `-1` when that pair has no rule (the agent then leaves the cell and itself
 * unchanged — a defined no-op, never a silent crash).
 */
export interface CompiledTurmite {
  readonly rows: readonly TurmiteRow[];
  readonly machineStateCount: number;
  readonly lookup: Int16Array;
}

export type NextFn = (state: StateId, neighbours: ArrayLike<number>) => StateId;

export interface CompiledRule {
  readonly strategy: CompileStrategy;
  readonly maxRadius: number;
  readonly usesRandomness: boolean;
  readonly isOuterTotalistic: boolean;
  readonly stillLifeStates: ReadonlySet<StateId>;
  /**
   * True when an all-dead neighbourhood leaves a dead cell dead. The grid uses
   * this to skip fully-empty chunk interiors — a `B0/...` rule flips it off.
   */
  readonly stableWhenIsolated: boolean;
  readonly neighborhood: CompiledNeighborhood;
  readonly stateCount: number;
  readonly neighbourCount: number;
  /** `1` if that state counts as alive for totalistic tallying, else `0`. */
  readonly aliveMask: Uint8Array;
  /**
   * LUT bytes for `lut8` / `lutN` / `denseTable`. Absent on `closure` (the
   * function *is* the artefact). Callers must not mutate this.
   */
  readonly table: Uint8Array | undefined;
  /**
   * Next state given the current state and neighbour states in the compiled
   * neighbourhood's offset order. Allocates nothing. Neighbour length must
   * equal {@link CompiledRule.neighbourCount}.
   */
  readonly next: NextFn;
  /** Present iff the rule's transition kind is `turmite`. */
  readonly turmite: CompiledTurmite | undefined;
}

export interface CompileRuleFn {
  (rs: RuleSet, opts?: CompileOptions): CompiledRule;
  readonly cache: { clear(): void };
}

let autoCache = new WeakMap<RuleSet, CompiledRule>();

/**
 * Compile `rs` into a {@link CompiledRule}. Cached on object identity — the same
 * `RuleSet` instance returns the same artefact. Forced-strategy compiles are
 * not cached (they would collide with the auto-selected one).
 */
export const compileRule: CompileRuleFn = Object.assign(
  (rs: RuleSet, opts?: CompileOptions): CompiledRule => {
    const force = opts?.forceStrategy;
    if (force === undefined) {
      const hit = autoCache.get(rs);
      if (hit !== undefined) return hit;
      const compiled = compileUncached(rs, undefined);
      autoCache.set(rs, compiled);
      return compiled;
    }
    return compileUncached(rs, force);
  },
  {
    cache: {
      clear(): void {
        autoCache = new WeakMap();
      },
    },
  },
);

/** Pick the automatic strategy for a rule of this shape. Exported for tests. */
export function selectCompileStrategy(rs: RuleSet, neighbourCount: number): CompileStrategy {
  const stateCount = rs.states.length;
  const kind = rs.transition.kind;
  const n = rs.neighborhood;

  if (
    kind === 'totalistic' &&
    stateCount === 2 &&
    n.kind === 'moore' &&
    n.radius === 1 &&
    neighbourCount === 8
  ) {
    return 'lut8';
  }

  if (
    (kind === 'totalistic' || kind === 'generations') &&
    stateCount <= LUT_N_MAX_STATES &&
    neighbourCount <= LUT_N_MAX_NEIGHBOURS
  ) {
    return 'lutN';
  }

  if (kind === 'stateTable' && denseTableBytes(stateCount, neighbourCount) <= DENSE_TABLE_BUDGET) {
    return 'denseTable';
  }

  return 'closure';
}

function denseTableBytes(stateCount: number, neighbourCount: number): number {
  // radix ** neighbourCount * states, aborting early rather than overflowing
  // Number past 2^53 (a 24-neighbour 8-state table is already far past the budget).
  let combos = 1;
  for (let i = 0; i < neighbourCount; i++) {
    combos *= stateCount;
    if (combos > DENSE_TABLE_BUDGET) return DENSE_TABLE_BUDGET + 1;
  }
  const bytes = combos * stateCount;
  return bytes > DENSE_TABLE_BUDGET ? DENSE_TABLE_BUDGET + 1 : bytes;
}

function compileUncached(rs: RuleSet, force: CompileStrategy | undefined): CompiledRule {
  const neighborhood = compileNeighborhood(rs.neighborhood);
  const neighbourCount = neighborhood.count;
  const stateCount = rs.states.length;
  const auto = selectCompileStrategy(rs, neighbourCount);
  const strategy = force ?? auto;

  if (force !== undefined && force !== 'closure' && force !== auto) {
    // `closure` is always legal (it is the reference implementation). Forcing a
    // LUT the auto path would not pick is a test/programmer error, not a rule error.
    throw new RuleValidationError([
      {
        path: '/transition',
        message: `cannot compile this rule with strategy "${force}"`,
        hint: `automatic selection chose "${auto}"; only that LUT, or "closure", is available`,
      },
    ]);
  }

  const aliveMask = new Uint8Array(stateCount);
  for (let i = 0; i < stateCount; i++) {
    aliveMask[i] = rs.states[i]?.countsAsAlive === true ? 1 : 0;
  }

  const normalized = normalizeTransition(rs.transition);
  const semantic = makeSemanticNext(normalized, neighbourCount, aliveMask, stateCount);
  const turmite =
    normalized.kind === 'turmite' ? compileTurmite(normalized.states, stateCount) : undefined;

  let table: Uint8Array | undefined;
  let next: NextFn;

  switch (strategy) {
    case 'lut8': {
      table = buildAliveCountLut(semantic, aliveMask, 2, 8);
      next = makeLutNext(table, aliveMask, 9);
      break;
    }
    case 'lutN': {
      table = buildAliveCountLut(semantic, aliveMask, stateCount, neighbourCount);
      next = makeLutNext(table, aliveMask, neighbourCount + 1);
      break;
    }
    case 'denseTable': {
      /* v8 ignore start -- defensive: selectCompileStrategy already gated this. */
      if (normalized.kind !== 'stateTable') {
        throw new RuleValidationError([
          {
            path: '/transition',
            message: 'denseTable strategy requires a stateTable transition',
          },
        ]);
      }
      /* v8 ignore stop */
      table = coerceTable(normalized.table);
      next = makeStateTableNext(table, stateCount, neighbourCount);
      break;
    }
    case 'closure': {
      table = undefined;
      next = semantic;
      break;
    }
    /* v8 ignore next 8 -- CompileStrategy is a closed union; the never-check is for exhaustiveness. */
    default: {
      const exhaustive: never = strategy;
      throw new RuleValidationError([
        {
          path: '/transition',
          message: `unknown compile strategy "${String(exhaustive)}"`,
        },
      ]);
    }
  }

  const isolated = new Uint8Array(neighbourCount);
  const stillLifeStates = new Set<StateId>();
  for (let s = 0; s < stateCount; s++) {
    if (next(s, isolated) === s) stillLifeStates.add(s);
  }

  return {
    strategy,
    maxRadius: neighborhood.maxRadius,
    usesRandomness: false,
    isOuterTotalistic: normalized.kind === 'totalistic' || normalized.kind === 'generations',
    stillLifeStates,
    stableWhenIsolated: stillLifeStates.has(0),
    neighborhood,
    stateCount,
    neighbourCount,
    aliveMask,
    table,
    next,
    turmite,
  };
}

function normalizeTransition(t: TransitionSpec): TransitionSpec {
  if (t.kind !== 'stateTable') return t;
  const table = coerceTable(t.table);
  return table === t.table ? t : { kind: 'stateTable', radix: t.radix, table };
}

function coerceTable(table: Uint8Array | ArrayLike<number>): Uint8Array {
  return table instanceof Uint8Array ? table : Uint8Array.from(table);
}

/**
 * The reference next-state function for a transition kind. LUT strategies are
 * filled from this and then looked up independently, so an indexing bug cannot
 * hide behind a shared code path.
 */
function makeSemanticNext(
  t: TransitionSpec,
  neighbourCount: number,
  aliveMask: Uint8Array,
  stateCount: number,
): NextFn {
  switch (t.kind) {
    case 'totalistic':
      return makeTotalisticNext(
        t.born,
        t.survive,
        t.decayStates ?? 0,
        neighbourCount,
        aliveMask,
        stateCount,
      );
    case 'generations':
      // Generations aging is totalistic birth/survival plus a decay chain of
      // length `states - 2`. The palette length is the source of truth.
      return makeTotalisticNext(
        t.born,
        t.survive,
        Math.max(0, stateCount - 2),
        neighbourCount,
        aliveMask,
        stateCount,
      );
    case 'stateTable':
      return makeStateTableNext(coerceTable(t.table), t.radix, neighbourCount);
    case 'weighted':
      return makeWeightedNext(t.weights, t.thresholds);
    case 'turmite':
      // Cells do not evolve on their own; the agent is applied separately.
      return (state) => state;
    /* v8 ignore next 8 -- TransitionSpec is a closed union; the never-check is for exhaustiveness. */
    default: {
      const exhaustive: never = t;
      throw new RuleValidationError([
        {
          path: '/transition/kind',
          message: `unknown transition kind "${JSON.stringify(exhaustive)}"`,
        },
      ]);
    }
  }
}

function makeTotalisticNext(
  born: readonly number[],
  survive: readonly number[],
  decayStates: number,
  neighbourCount: number,
  aliveMask: Uint8Array,
  stateCount: number,
): NextFn {
  const bornAt = toFlagTable(born, neighbourCount);
  const surviveAt = toFlagTable(survive, neighbourCount);
  const hasDecay = decayStates > 0 && stateCount > 2;

  return (state, neighbours) => {
    const live = countAlive(neighbours, aliveMask);
    if (state === 0) return bornAt[live] === 1 ? 1 : 0;
    if (state === 1) {
      if (surviveAt[live] === 1) return 1;
      return hasDecay ? 2 : 0;
    }
    const aged = state + 1;
    return aged < stateCount ? aged : 0;
  };
}

function makeWeightedNext(
  weights: readonly number[],
  thresholds: readonly TransitionRow[],
): NextFn {
  const w = Float64Array.from(weights);
  return (state, neighbours) => {
    let sum = 0;
    const n = neighbours.length;
    for (let i = 0; i < n; i++) {
      sum += w[neighbours[i] ?? 0] ?? 0;
    }
    for (let r = 0; r < thresholds.length; r++) {
      const row = thresholds[r];
      if (row !== undefined && sum >= row.min && sum <= row.max) return row.toState;
    }
    return state;
  };
}

function makeStateTableNext(table: Uint8Array, radix: number, neighbourCount: number): NextFn {
  const powers = new Float64Array(neighbourCount);
  let p = 1;
  for (let i = 0; i < neighbourCount; i++) {
    powers[i] = p;
    p *= radix;
  }
  const stride = p; // radix ** neighbourCount
  return (state, neighbours) => {
    let idx = 0;
    for (let i = 0; i < neighbourCount; i++) {
      idx += (neighbours[i] ?? 0) * (powers[i] ?? 0);
    }
    return table[state * stride + idx] ?? 0;
  };
}

function makeLutNext(lut: Uint8Array, aliveMask: Uint8Array, stride: number): NextFn {
  return (state, neighbours) => lut[state * stride + countAlive(neighbours, aliveMask)] ?? 0;
}

function buildAliveCountLut(
  semantic: NextFn,
  aliveMask: Uint8Array,
  stateCount: number,
  neighbourCount: number,
): Uint8Array {
  const stride = neighbourCount + 1;
  const lut = new Uint8Array(stateCount * stride);
  const aliveState = firstAliveState(aliveMask);
  const neighbours = new Uint8Array(neighbourCount);
  for (let s = 0; s < stateCount; s++) {
    for (let live = 0; live <= neighbourCount; live++) {
      fillAliveCount(neighbours, live, aliveState);
      lut[s * stride + live] = semantic(s, neighbours);
    }
  }
  return lut;
}

function firstAliveState(aliveMask: Uint8Array): StateId {
  for (let i = 0; i < aliveMask.length; i++) {
    if (aliveMask[i] === 1) return i;
  }
  return 1;
}

function fillAliveCount(neighbours: Uint8Array, live: number, aliveState: StateId): void {
  for (let i = 0; i < neighbours.length; i++) neighbours[i] = i < live ? aliveState : 0;
}

function countAlive(neighbours: ArrayLike<number>, aliveMask: Uint8Array): number {
  let live = 0;
  const n = neighbours.length;
  for (let i = 0; i < n; i++) {
    live += aliveMask[neighbours[i] ?? 0] ?? 0;
  }
  return live;
}

function toFlagTable(values: readonly number[], neighbourCount: number): Uint8Array {
  const flags = new Uint8Array(neighbourCount + 1);
  for (const v of values) {
    if (v >= 0 && v <= neighbourCount) flags[v] = 1;
  }
  return flags;
}

function compileTurmite(rows: readonly TurmiteRow[], stateCount: number): CompiledTurmite {
  let machineStateCount = 1;
  for (const row of rows) {
    const max = Math.max(row.state, row.nextState) + 1;
    if (max > machineStateCount) machineStateCount = max;
  }
  const lookup = new Int16Array(machineStateCount * stateCount);
  lookup.fill(-1);
  rows.forEach((row, i) => {
    const idx = row.state * stateCount + row.onCellState;
    if (idx >= 0 && idx < lookup.length) lookup[idx] = i;
  });
  return { rows, machineStateCount, lookup };
}
