# The RuleSet schema

A `RuleSet` is the one JSON shape every rule in fancy-gol is described by — built-in or
user-authored. This document is the human-readable reference: read this, not the TypeScript,
if you're writing a rule by hand. The authoritative types live in `src/engine/types.ts`
(ADR-001) and `src/engine/rules/schema.ts`; a hand-written validator
(`src/engine/rules/validate.ts`, P0-D-2) checks every field this document describes.

## Top-level shape

```ts
interface RuleSetDocument {
  version: number;        // schema version — currently 1
  id: string;              // stable id, e.g. "conway", "user:my-rule"
  name: string;
  description?: string;
  author?: string;
  states: StateDef[];      // the state palette — see below
  neighborhood: Neighborhood;
  transition: TransitionSpec;
  boundary: 'bounded' | 'toroidal' | 'infinite';
  symmetry?: 'none' | 'rotational';
}
```

### `states`

```ts
interface StateDef {
  id: number;                                     // 0 is always "dead"
  name: string;
  kind: 'dead' | 'live' | 'decay' | 'inert';
  countsAsAlive: boolean;                          // does this state add to a neighbour's tally?
}
```

Rules, enforced by the validator:

- State ids are contiguous from `0`.
- Exactly one state has `kind: 'dead'`, and it is id `0`.
- `kind` is descriptive (drives default stats grouping and render treatment); `countsAsAlive`
  is the one field that actually changes simulation behaviour.

### `neighborhood`

```ts
type Neighborhood =
  | { kind: 'moore'; radius: number }        // 8 neighbours at radius 1, 24 at radius 2, ...
  | { kind: 'vonNeumann'; radius: number }    // 4 neighbours at radius 1 (the diamond)
  | { kind: 'hex' }                           // 6 neighbours, row-parity offset layout
  | { kind: 'custom'; offsets: [number, number][] };  // dedup'd, no [0,0], capped at 48
```

### `boundary`

`'bounded'` and `'toroidal'` require `width`/`height` to be supplied wherever the rule is
attached to a grid (not on the `RuleSet` itself — grid size is a `Simulation` option, not a
rule property, since the same rule can run on any size grid). `'infinite'` has no such
requirement, but is not actually infinite: the addressable range is ±1,048,576 cells per axis
(`WORLD_LIMIT` in `src/engine/grid/coords.ts`) — documented, not silently exceeded.

### `transition`

Five kinds, chosen by the shape of the rule:

| kind | Used for |
|---|---|
| `totalistic` | Classic B/S rules: Conway, Seeds, Brian's Brain (via `decayStates`). |
| `generations` | Totalistic birth/survival plus automatic aging through `states` levels. |
| `stateTable` | Anything else small enough for a precomputed dense lookup: WireWorld. |
| `weighted` | Per-state-weighted neighbour sums crossing thresholds: terrain-style rules. |
| `turmite` | An agent walking the grid, not a per-cell transition at all: Langton's Ant. |

#### `totalistic`

```ts
{ kind: 'totalistic', born: number[], survive: number[], decayStates?: number }
```

A dead cell (id `0`) is born if its count of `countsAsAlive` neighbours is in `born`. A cell in
the *last* live/born-into state survives (stays there) if that count is in `survive`, otherwise
it moves into decay. `decayStates` (default `0`) is how many extra states a cell passes through,
one per generation, after leaving the born/survive state, before returning to dead — this is
how Brian's Brain's "dying" phase is expressed without a bespoke transition kind.

#### `generations`

```ts
{ kind: 'generations', born: number[], survive: number[], states: number }
```

Same born/survive semantics, generalised: `states` total non-dead levels, and any cell not
freshly born or surviving ages forward by one state per generation until it reaches `states`
and dies. (`totalistic` with `decayStates` is the `states = 2` special case, kept separate
because two-state aging compiles to a much smaller lookup table — see P0-D-4.)

#### `stateTable`

```ts
{ kind: 'stateTable', radix: number, table: Uint8Array }
```

A fully dense, precomputed transition table. `radix` is the rule's state count. The index is

```
table[state * radix**neighbourCount + Σ neighbourState_i * radix**i]
```

where neighbour `i` is enumerated in the compiled neighbourhood's own offset order (see
`src/engine/neighborhood/offsets.ts`). This is exact and unambiguous, but its size is
`states * radix ** neighbourCount` — fine for a handful of states and a small neighbourhood,
but WireWorld's real 8-neighbour, 4-state table has 262,144 entries. Nobody hand-writes that:
it's generated. See the WireWorld example below.

#### `weighted`

```ts
{ kind: 'weighted', weights: number[], thresholds: { min: number; max: number; toState: number }[] }
```

`weights[stateId]` is how much a neighbour in that state contributes to a cell's weighted
neighbour sum. Every cell's *next* state is the `toState` of whichever `thresholds` row's
`[min, max]` contains that sum — independent of the cell's own current state. This is
deliberately the simplest possible generalisation of "totalistic" to weighted, non-binary
terrain: see Highlands/Liquid below.

#### `turmite`

```ts
{ kind: 'turmite', states: { state: number; onCellState: number; writeState: number; turn: 'left'|'right'|'uturn'|'none'; nextState: number }[] }
```

Not a per-cell rule at all: a turmite is an agent with its own internal `state`, sitting on one
cell, heading in one of 4 directions. Each step it looks up the row matching its current
`(state, onCellState)`, writes `writeState` to the cell under it, turns, and moves forward one
cell into its new heading, becoming `nextState`. Langton's Ant is the classic 1-internal-state
case.

---

## Worked examples

Every example below is a complete, valid `RuleSetDocument` — copy, paste, and (once P0-D-2's
validator exists) it validates clean. Each is also a fixture at
`tests/fixtures/rules/valid/<id>.json`, loaded by `tests/unit/engine/rules/schema.spec.ts`.

### Conway's Game of Life (`totalistic`)

```json
{
  "version": 1,
  "id": "conway",
  "name": "Conway's Game of Life",
  "description": "The original: a cell is born with exactly 3 live neighbours and survives with 2 or 3.",
  "author": "John Conway, 1970",
  "states": [
    { "id": 0, "name": "dead", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "alive", "kind": "live", "countsAsAlive": true }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": { "kind": "totalistic", "born": [3], "survive": [2, 3] },
  "boundary": "toroidal"
}
```

### Seeds (`totalistic`, no survival)

```json
{
  "version": 1,
  "id": "seeds",
  "name": "Seeds",
  "description": "Explosive: every live cell dies each generation; a dead cell with exactly 2 live neighbours is born.",
  "author": "Brian Silverman / Mirek Wojtowicz",
  "states": [
    { "id": 0, "name": "dead", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "alive", "kind": "live", "countsAsAlive": true }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": { "kind": "totalistic", "born": [2], "survive": [] },
  "boundary": "toroidal"
}
```

### Brian's Brain (`totalistic` + `decayStates`)

```json
{
  "version": 1,
  "id": "brians-brain",
  "name": "Brian's Brain",
  "description": "3-state: a dead cell with exactly 2 live neighbours fires; a firing cell always dies to refractory; a refractory cell always returns to dead. No cell ever survives.",
  "author": "Brian Silverman, 1990s",
  "states": [
    { "id": 0, "name": "dead", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "firing", "kind": "live", "countsAsAlive": true },
    { "id": 2, "name": "refractory", "kind": "decay", "countsAsAlive": false }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": { "kind": "totalistic", "born": [2], "survive": [], "decayStates": 1 },
  "boundary": "toroidal"
}
```

### A Generations rule (`generations`)

```json
{
  "version": 1,
  "id": "generations-demo",
  "name": "Generations Demo",
  "description": "An illustrative 3-state Generations rule: Conway-like birth/survival, but a cell that dies ages through one 'fading' state before returning to dead, instead of dying instantly.",
  "states": [
    { "id": 0, "name": "dead", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "alive", "kind": "live", "countsAsAlive": true },
    { "id": 2, "name": "fading", "kind": "decay", "countsAsAlive": false }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": { "kind": "generations", "born": [3], "survive": [2, 3], "states": 3 },
  "boundary": "toroidal"
}
```

### WireWorld (`stateTable`) — generated, not hand-written

WireWorld needs all four states' worth of a genuinely dense 8-neighbour table —
`4 * 4**8 = 262,144` entries. Writing that by hand would defeat the point of this document
being readable, so instead of inlining it, here is the exact generator (deterministic, run
once to produce `tests/fixtures/rules/valid/wireworld.json`, the real fixture the schema test
loads):

```ts
const RADIX = 4; // 0 empty, 1 electron head, 2 electron tail, 3 conductor
const NEIGHBOURS = 8; // must enumerate in mooreOffsets(1)'s own order

function nextState(state: number, neighbourStates: number[]): number {
  if (state === 0) return 0; // empty stays empty
  if (state === 1) return 2; // head -> tail
  if (state === 2) return 3; // tail -> conductor
  const headCount = neighbourStates.filter((s) => s === 1).length;
  return headCount === 1 || headCount === 2 ? 1 : 3; // conductor -> head iff 1 or 2 head neighbours
}

// table[state * RADIX**NEIGHBOURS + sum(neighbourStates[i] * RADIX**i)] = nextState(state, neighbourStates)
// for every state in [0, RADIX) and every neighbourStates combination in RADIX**NEIGHBOURS.
```

Everything except `transition.table` is exactly as compact as the other examples:

```json
{
  "version": 1,
  "id": "wireworld",
  "name": "WireWorld",
  "description": "A 4-state digital-logic simulator: electrons (head/tail pairs) flow along conductor wires.",
  "author": "Brian Silverman, 1987 (as described by A. K. Dewdney)",
  "states": [
    { "id": 0, "name": "empty", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "electron-head", "kind": "live", "countsAsAlive": true },
    { "id": 2, "name": "electron-tail", "kind": "decay", "countsAsAlive": false },
    { "id": 3, "name": "conductor", "kind": "inert", "countsAsAlive": false }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": { "kind": "stateTable", "radix": 4, "table": "/* 262,144 Uint8Array entries — see tests/fixtures/rules/valid/wireworld.json */" },
  "boundary": "bounded"
}
```

### Highlands / Liquid (`weighted`) — the terrain example

```json
{
  "version": 1,
  "id": "highlands-liquid",
  "name": "Highlands / Liquid",
  "description": "A weighted terrain rule: every cell's next state is decided by the weighted sum of its neighbours (highlands count for more than liquid), independent of the cell's own current state. From random noise this settles into recognisable land/water banding — the 'Rule-God Status' weighted-terrain example from the inception document.",
  "states": [
    { "id": 0, "name": "void", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "liquid", "kind": "live", "countsAsAlive": true },
    { "id": 2, "name": "highland", "kind": "live", "countsAsAlive": true }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": {
    "kind": "weighted",
    "weights": [0, 1, 3],
    "thresholds": [
      { "min": 0, "max": 4, "toState": 0 },
      { "min": 5, "max": 10, "toState": 1 },
      { "min": 11, "max": 24, "toState": 2 }
    ]
  },
  "boundary": "toroidal"
}
```

### Langton's Ant (`turmite`)

```json
{
  "version": 1,
  "id": "langtons-ant",
  "name": "Langton's Ant",
  "description": "A single agent (turmite) walks the grid: on a white square, turn right, flip it black, step forward; on a black square, turn left, flip it white, step forward. Simple local rules, famously complex emergent behaviour (a 'highway' after ~10,000 steps).",
  "author": "Chris Langton, 1986",
  "states": [
    { "id": 0, "name": "white", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "black", "kind": "live", "countsAsAlive": true }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": {
    "kind": "turmite",
    "states": [
      { "state": 0, "onCellState": 0, "writeState": 1, "turn": "right", "nextState": 0 },
      { "state": 0, "onCellState": 1, "writeState": 0, "turn": "left", "nextState": 0 }
    ]
  },
  "boundary": "infinite"
}
```
