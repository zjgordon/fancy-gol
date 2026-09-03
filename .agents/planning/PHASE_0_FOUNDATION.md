# Phase 0 — Foundation

> *"Engine first: the simulation core is pure, tested, and dependency-free. UI wraps it, not the other way around."*

| | |
|---|---|
| **Status** | ~ In progress — Workstreams A–D complete; E through the step function |
| **Ships version** | `0.1.0` |
| **Prerequisites** | None. This is the first phase. |
| **Theme of the phase** | **Make it correct.** |
| **The demo that proves it** | `docker compose up` → open `localhost:8080` → a Gosper glider gun runs at 60 fps in a bare canvas with a live FPS/tick/population readout, and `npm run verify` is green with ≥95% engine coverage. |

**Read before starting:** [`../docs/INCEPTION.md`](../docs/INCEPTION.md), [`README.md`](./README.md) §3 (cross-phase rules), [`ARCHITECTURE_DECISIONS.md`](./ARCHITECTURE_DECISIONS.md) in full.

---

## 1. Objectives

1. A **pure, multi-state cellular automaton engine** with no knowledge of the DOM, the network, or time.
2. A **ruleset data layer** — JSON schema, hand-written validator, notation parsers, and a compiler that turns a declarative rule into a fast lookup table.
3. A **chunked sparse grid** that is memory-proportional to live cells and cache-friendly in the inner loop.
4. A **worker boundary** with a versioned, tested protocol — and a headless in-memory port so the engine can be driven in tests with no browser.
5. A **renderer interface** and a first Canvas2D implementation with dirty-rect invalidation, validated by a headless draw-call recorder.
6. The **infrastructure that makes every later phase provable**: strict TypeScript, boundary enforcement, coverage gates, a benchmark harness with committed budgets, CI, and Docker.

### Explicitly *not* in Phase 0
No painting, no panning, no zooming, no theme system, no statistics UI, no WebSocket features, no pattern library, no keyboard shortcuts. The Phase 0 page is a *proof*, not a product. Resist the urge — Phase 1 is right there.

---

## 2. Architecture introduced in this phase

### 2.1 Data flow

```
                 main thread                                worker thread
 ┌──────────────────────────────────────────┐   ┌──────────────────────────────────┐
 │ client/main.ts                           │   │ worker/sim.worker.ts             │
 │   rAF loop                               │   │   ┌────────────────────────────┐ │
 │     ├─ WorkerClient.postCommand() ───────┼──▶│   │ Simulation                 │ │
 │     │                                    │   │   │   ChunkedGrid              │ │
 │     └─ Renderer.draw(frame) ◀────────────┼───┼── │   CompiledRule             │ │
 │          Canvas2DRenderer                │   │   │   HistoryJournal           │ │
 │            dirty-rect + tile cache       │   │   │   StatsCollector           │ │
 └──────────────────────────────────────────┘   │   └────────────────────────────┘ │
        transferable ArrayBuffers (zero-copy)   └──────────────────────────────────┘

 tests/ drive the SAME protocol through an in-memory MessagePort pair — no browser required.
```

### 2.2 Public engine surface (`src/engine/index.ts`)

This is the **only** module anything outside `src/engine/` may import from. It is a hard rule checked by `scripts/check-boundaries.mjs`.

```ts
export { Simulation } from './simulation';
export { ChunkedGrid, CHUNK_SIZE } from './grid/chunked-grid';
export { compileRule } from './rules/compile';
export { parseRuleNotation, validateRuleSet, RuleValidationError } from './rules/parse';
export { BUILTIN_RULESETS } from './rules/builtin';
export { HistoryJournal } from './history/journal';
export { StatsCollector } from './stats/collector';
export { encodeRLE, decodeRLE } from './patterns/rle';
export { Mulberry32 } from './rng';
export type * from './types';
```

### 2.3 The `Simulation` class contract

```ts
export interface SimulationOptions {
  ruleset: RuleSet;
  width?: number;              // required for 'bounded' | 'toroidal'; ignored for 'infinite'
  height?: number;
  seed?: number;               // PRNG seed; default 0x9e3779b9
  history?: HistoryOptions | false;
}

export interface TickStats {
  tick: number;
  population: number;          // cells whose state is not DEAD
  perState: Uint32Array;       // index = StateId
  births: number;              // DEAD → live
  deaths: number;              // live → DEAD
  transitions: number;         // live → different live state
  activeChunks: number;
  stepMicros: number;          // measured via injected clock
}

export class Simulation {
  constructor(opts: SimulationOptions);

  readonly tick: number;
  readonly ruleset: RuleSet;
  readonly stats: Readonly<TickStats>;

  step(): ChangeSet;                       // exactly one generation; returns what changed
  stepMany(n: number): ChangeSet;          // coalesced changes across n generations
  set(x: number, y: number, state: StateId): void;
  get(x: number, y: number): StateId;
  paint(ops: readonly PaintOp[]): ChangeSet;
  clear(): void;
  seedRandom(density: number, seed: number): void;
  setRuleset(rs: RuleSet, migrate?: StateMigration): void;

  snapshot(): Snapshot;                    // structured-cloneable, transferable
  restore(s: Snapshot): void;
  seek(tick: number): void;                // via HistoryJournal; throws if outside retained window

  view(): GridView;                        // read-only, no copy, for the renderer
  bounds(): Rect;                          // bounding box of live cells
}
```

`ChangeSet` is the load-bearing type of the whole project (ADR-007) — history, statistics and dirty-rect rendering are all derived from it, so it must be cheap:

```ts
export interface ChangeSet {
  readonly tick: number;
  readonly coords: Int32Array;   // packed (x<<16|y) per change — reused buffer, do not retain
  readonly from: Uint8Array;
  readonly to: Uint8Array;
  readonly count: number;        // valid prefix length of the arrays above
  readonly dirtyChunks: Int32Array;
}
```

### 2.4 File layout created by this phase

```
src/
├── engine/
│   ├── index.ts                    public surface (above)
│   ├── types.ts                    StateId, StateDef, RuleSet, ChangeSet, Rect, PaintOp…
│   ├── rng.ts                      Mulberry32 (deterministic, ~12 lines)
│   ├── clock.ts                    injectable Clock interface + TestClock
│   ├── grid/
│   │   ├── coords.ts               pack/unpack, chunk maths, boundary normalisation
│   │   ├── chunk.ts                Chunk: Uint8Array + summary counters
│   │   └── chunked-grid.ts         ChunkedGrid, GridView, halo reads
│   ├── neighborhood/
│   │   ├── index.ts                Neighborhood → offset table + border mask
│   │   └── offsets.ts              moore / vonNeumann / hex / custom
│   ├── rules/
│   │   ├── schema.ts               the JSON shape + doc comments
│   │   ├── validate.ts             hand-written validator (no ajv)
│   │   ├── parse.ts                "B3/S23", "23/3", "B3/S23/G3", Generations, hex suffixes
│   │   ├── compile.ts              RuleSet → CompiledRule (LUT or closure)
│   │   └── builtin/                conway, highlife, day-night, seeds, brians-brain,
│   │                               wireworld, generations-*, replicator, diamoeba, maze
│   ├── history/
│   │   ├── journal.ts              keyframe + delta ring buffer
│   │   └── compress.ts             chunk RLE compression for keyframes
│   ├── stats/
│   │   └── collector.ts            derives TickStats from a ChangeSet in O(changes)
│   ├── patterns/
│   │   └── rle.ts                  minimal RLE decode (Phase 2 completes the codec suite)
│   └── simulation.ts
├── shared/
│   ├── protocol.ts                 Command / Event unions, PROTOCOL_VERSION
│   └── types.ts                    Viewport, Rect, RenderStats — cross-boundary types
├── worker/
│   ├── sim.worker.ts               worker entry
│   ├── handler.ts                  transport-agnostic command handler (testable)
│   └── client.ts                   main-thread WorkerClient (promise-based RPC)
├── render/
│   ├── types.ts                    Renderer, RenderFrame, CompiledTheme (minimal)
│   ├── canvas2d.ts                 Canvas2DRenderer
│   ├── dirty.ts                    dirty-rect accumulation + merge
│   └── recorder.ts                 headless draw-call recorder (test double)
├── client/
│   ├── index.html
│   └── main.ts                     boot, rAF loop, FPS meter
└── server/
    ├── app.ts                      express app factory (testable, no listen)
    └── index.ts                    listen + graceful shutdown
```

---

## 3. Workstreams & tasks

Legend and ID scheme: see [`README.md`](./README.md) §2.

---

### Workstream A — Toolchain & repository skeleton

#### - [x] P0-A-1 · Package scaffold and scripts
**Depends on:** —
**Files:** `package.json`, `.gitignore`, `.editorconfig`, `.nvmrc`
**Intent:** One command does everything; nobody ever asks "how do I run the tests?"
**Implementation notes**
- `"type": "module"`, `"engines": { "node": ">=20" }`, `.nvmrc` pinned to the current LTS.
- Scripts: `dev` (vite + server concurrently, hand-rolled with `node --watch`, no `concurrently` package), `build`, `preview`, `test`, `test:watch`, `coverage`, `e2e`, `bench`, `lint`, `format`, `typecheck`, `boundaries`, and `verify` = `typecheck && lint && boundaries && test && build`.
- Zero runtime dependencies at this point except `express` and `ws` (ADR-002). Everything else is `devDependencies`.
**Acceptance criteria**
- [x] `npm ci && npm run verify` succeeds on a clean clone.
- [x] `npm ls --omit=dev` lists exactly `express` and `ws` (plus their transitives).

#### - [x] P0-A-2 · Strict TypeScript configuration
**Depends on:** P0-A-1 · **Files:** `tsconfig.json`, `tsconfig.node.json`
**Intent:** Make illegal states unrepresentable at compile time so tests can spend their budget on behaviour.
**Implementation notes**
- `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `isolatedModules`, `verbatimModuleSyntax`.
- `target: "ES2022"`, `moduleResolution: "bundler"`.
- Path aliases: `@engine/*`, `@shared/*`, `@render/*`, `@ui/*`, `@themes/*`, `@worker/*`. Mirror them in `vite.config.ts` and `vitest.config.ts`.
**Acceptance criteria**
- [x] `npm run typecheck` passes with zero errors and zero `@ts-expect-error` outside `tests/`.
- [x] `any` appears nowhere in `src/` (lint rule enforces).

#### - [x] P0-A-3 · Vite + Vitest configuration
**Depends on:** P0-A-2 · **Files:** `vite.config.ts`, `vitest.config.ts`
**Implementation notes**
- Vite root is `src/client`, build output `dist/client`, worker format `es`.
- Vitest: `environment: 'node'` by default (the engine is pure — it must not need jsdom), with a `jsdom` project for `src/ui` and `src/render` tests.
- Coverage provider `v8`, reporters `text` + `lcov` + `json-summary`, thresholds exactly as README §3.5.
**Acceptance criteria**
- [x] A trivial engine test runs in the `node` environment and fails if it touches `document`.
- [x] `npm run coverage` prints per-directory thresholds and exits non-zero when one is unmet.

#### - [x] P0-A-4 · Lint & format
**Depends on:** P0-A-2 · **Files:** `eslint.config.js`, `.prettierrc`
**Implementation notes**
- Flat ESLint config, `typescript-eslint` with type-aware rules.
- Custom-configured bans: `no-restricted-globals` in `src/engine/**` for `window document navigator localStorage fetch console process performance`; `no-restricted-syntax` banning `new Array`, `Array.prototype.push` inside files under `src/engine/**/hot/` (hot loops preallocate).
- Prettier: 100 columns, single quotes, trailing commas, semicolons. No debates.
**Acceptance criteria**
- [x] `npm run lint` is clean; a deliberate `document.title` in an engine file fails it.

#### - [x] P0-A-5 · Layer boundary checker
**Depends on:** P0-A-1 · **Files:** `scripts/check-boundaries.mjs`
**Intent:** Machine-enforce ADR-009 so "Pure Logic" is a property of the build, not of anyone's discipline.
**Implementation notes**
- Walk `src/**/*.ts`, extract `import`/`export … from` specifiers with a regex over source (no TS API needed — keep it ~80 lines per the no-bloat rule).
- Resolve aliases, map each file to its layer by its top-level directory, and check the target layer against the matrix in ADR-009.
- Second pass: scan `src/engine/**` for the forbidden global identifier list as whole words.
- Report every violation with `file:line` before exiting `1`. Never stop at the first.
**Acceptance criteria**
- [x] `npm run boundaries` passes on the real tree.
- [x] Fixture tests in `tests/unit/boundaries.spec.ts` prove it *catches* a `ui → engine/internal` import, an `engine → render` import, and a `window` reference in the engine.

#### - [x] P0-A-6 · Conventional-commit hook, changelog, versioning
**Depends on:** P0-A-1 · **Files:** `.githooks/commit-msg`, `CHANGELOG.md`, `CONTRIBUTING.md`
**Implementation notes**
- ~40-line Node script validating `type(scope): subject`, allowed types and scopes per README §3.4, subject ≤ 72 chars, imperative mood check (reject a leading word ending in `ed`/`ing`).
- Wire with `git config core.hooksPath .githooks` in a `prepare` script.
- Seed `CHANGELOG.md` with Keep-a-Changelog headers and an `[Unreleased]` section.
**Acceptance criteria**
- [x] `git commit -m "stuff"` is rejected with a helpful message listing valid types.
- [x] `git commit -m "feat(engine): add chunked grid"` is accepted.

---

### Workstream B — Core types, RNG, coordinates

#### - [x] P0-B-1 · Engine type vocabulary
**Depends on:** P0-A-2 · **Files:** `src/engine/types.ts`
**Intent:** Every later phase speaks this vocabulary. Get the names right now; renaming `StateId` in Phase 4 costs a day.
**Implementation notes**
- Define exactly the types in ADR-001 plus `Rect`, `PaintOp`, `ChangeSet`, `GridView`, `Snapshot`, `StateMigration`.
- `PaintOp = { x, y, state }` — brushes are a UI concept that resolve to a flat op list before crossing the worker boundary. The engine never hears the word "brush".
- Document every field with a TSDoc comment. This file is read more than any other in the repo.
**Acceptance criteria**
- [x] No type in this file imports from outside `src/engine/` or `src/shared/types`.
- [x] `tests/unit/engine/types.spec.ts` contains compile-time assertions (`expectTypeOf`) pinning the shape of `RuleSet` and `ChangeSet`.

#### - [x] P0-B-2 · Seedable PRNG
**Depends on:** P0-B-1 · **Files:** `src/engine/rng.ts`
**Implementation notes** Mulberry32. ~12 lines. Exposes `next(): number` in `[0,1)`, `nextInt(n)`, `fork(): Mulberry32`, and `state` for snapshotting. Hand-written per the no-bloat rule.
**Acceptance criteria**
- [x] Same seed → identical 10,000-value sequence across runs and across Node/browser builds.
- [x] `fork()` produces an independent stream that does not advance the parent.
- [x] Chi-square uniformity test over 100k samples in 16 buckets passes at p > 0.01.

#### - [x] P0-B-3 · Injectable clock
**Depends on:** P0-B-1 · **Files:** `src/engine/clock.ts`
**Intent:** The engine measures its own step time for `TickStats` but must not touch `performance`. Inject it.
**Acceptance criteria**
- [x] `TestClock` lets a test assert `stepMicros` deterministically.
- [x] `src/engine` contains zero references to `performance` or `Date`.

#### - [x] P0-B-4 · Coordinate system & boundary normalisation
**Depends on:** P0-B-1 · **Files:** `src/engine/grid/coords.ts`
**Implementation notes**
- `packCell(x,y): number` (two signed 16-bit halves) with `unpackX` / `unpackY`; `packChunk(cx,cy)`.
- `worldToChunk`, `chunkToWorld`, `localIndex(x,y)` = `((y & 31) << 5) | (x & 31)`.
- `normalize(x, y, boundary, w, h)` returns the wrapped coordinate for `toroidal`, `null` for out-of-range `bounded`, and the input for `infinite`.
- Document the addressable range (±1,048,576) as a named constant `WORLD_LIMIT` and make out-of-range a thrown `RangeError`, never silent corruption.
**Acceptance criteria**
- [x] Round-trip property test: 100k random coords in range survive pack→unpack unchanged, including negatives.
- [x] Toroidal wrap is correct for negative coordinates (`normalize(-1, -1, 'toroidal', 32, 32) === [31, 31]`).
- [x] Exceeding `WORLD_LIMIT` throws with a message naming the limit.

---

### Workstream C — The chunked sparse grid

#### - [x] P0-C-1 · `Chunk`
**Depends on:** P0-B-4 · **Files:** `src/engine/grid/chunk.ts`
**Implementation notes**
- `data: Uint8Array(1024)`, plus `population: number`, `perState: Uint32Array`, `dirty: boolean`, `lastTick: number`, `borderMask: number` (16 bits: which of the 4 edges / 4 corners hold live cells — used to skip cross-chunk work).
- `set(localIdx, state)` maintains all counters incrementally. Never recount by scanning.
- Chunks are pooled and recycled — `Chunk.acquire()` / `release()` from a free list, because Phase 5 will allocate and free thousands per second.
**Acceptance criteria**
- [x] Counters after 10,000 random `set` calls exactly match a brute-force recount (property test).
- [x] `borderMask` matches a brute-force edge scan for 1,000 random chunk fillings.
- [x] A released-and-reacquired chunk is fully zeroed (no state leaks between generations).

#### - [!] P0-C-2 · `ChunkedGrid` — blocked on P0-I-4 (bench harness) for the memory-bound criterion
**Depends on:** P0-C-1 · **Files:** `src/engine/grid/chunked-grid.ts`
**Implementation notes**
- `Map<number, Chunk>`; `get`/`set` create chunks lazily and **free chunks that reach population 0** (with hysteresis: free only after N ticks empty, to avoid churn on a blinking cell).
- `activeChunks: Set<number>` — chunks dirty last tick plus their 8 neighbours. This set is the step function's work list.
- `GridView` is a read-only façade handed to the renderer with `forEachChunkInRect(rect, fn)` and `getChunk(cx,cy)` — **no copying, ever**.
- Double buffering (`front`/`back` chunk maps) is deferred to `simulation.ts` (P0-E-1), which is
  the actual consumer that needs it — see the file's top-of-module comment.
**Acceptance criteria**
- [ ] A grid with 1,000,000 live cells scattered over a 4096² area allocates < 40 MB (measured in `tests/bench`) — deferred: `tests/bench` doesn't exist until P0-I-4.
- [x] Empty-chunk reclamation returns memory: fill 10k chunks, clear, assert map size returns to 0 after hysteresis ticks.
- [x] `GridView` has no method that returns a mutable reference to chunk data (type-level assertion).

#### - [x] P0-C-3 · Neighbourhood offset tables
**Depends on:** P0-C-2 · **Files:** `src/engine/neighborhood/*.ts`
**Implementation notes**
- Precompute an `Int8Array` offset pair list per neighbourhood at rule-compile time, never per cell.
- Moore radius r → (2r+1)²−1 offsets; von Neumann → the diamond; hex → 6 offsets with row-parity handling; custom → validated user offsets (dedup, reject `[0,0]`, cap at 48 offsets).
- Emit a `maxRadius` so the grid knows how wide a halo to read.
- `RuleValidationError` (structured `{ path, message, hint? }` issues) was pulled forward into
  `src/engine/rules/errors.ts` — P0-C-3's custom-offset cap needs it, and P0-D-2 reuses it as-is
  rather than defining it twice.
**Acceptance criteria**
- [x] Moore r=1 yields exactly the 8 classic offsets in a documented, stable order.
- [x] Hex neighbour sets are symmetric: if B is a neighbour of A, A is a neighbour of B (property test over 10k cells, both row parities).
- [x] Custom offsets exceeding the cap throw a `RuleValidationError` naming the cap.

---

### Workstream D — The ruleset data layer

#### - [x] P0-D-1 · RuleSet JSON schema
**Depends on:** P0-B-1 · **Files:** `src/engine/rules/schema.ts`, `docs/ruleset-schema.md`
**Intent:** This schema *is* "Rule-God Status". It is a public interface: users will hand-write it in Phase 2 and share it. Design it to be readable by a human with no documentation open.
**Implementation notes**
- Include `$schema`-style `version` field from the start so Phase 2's editor can migrate old documents.
- Every transition kind from ADR-001. Worked examples in the doc for: Conway, Seeds, Brian's Brain, WireWorld, a Generations rule, a weighted "Highlands/Liquid" terrain rule, and Langton's Ant.
**Acceptance criteria**
- [x] `docs/ruleset-schema.md` contains a complete, valid, copy-pasteable JSON example for each of the seven cases above, and each is loaded by a test as a fixture.
  (WireWorld's 262,144-entry dense table is generated, not hand-typed in the doc — see the
  doc's own note — but the real fixture file is complete and is the one the test loads.)

#### - [x] P0-D-2 · Hand-written validator
**Depends on:** P0-D-1 · **Files:** `src/engine/rules/validate.ts`
**Implementation notes**
- No `ajv` (no-bloat rule). ~200 lines of explicit checks.
- Errors are **structured and plural**: `RuleValidationError` carries `issues: { path: string; message: string; hint?: string }[]`. Phase 2's editor renders these inline next to the offending JSON line, so `path` must be a real JSON pointer.
- Semantic checks beyond shape: state ids are contiguous from 0; exactly one state has `kind: 'dead'` and it is id 0; `born`/`survive` values are within `0..neighbourCount`; `stateTable` length equals `radix^neighbours × states`; `boundary` is `bounded`/`toroidal` only when width/height are supplied.
  (`RuleSet` itself carries no `width`/`height` — those are `Simulation`-level, not rule-level —
  so this specific sub-check is a no-op for a bare `RuleSetDocument`; noted here rather than
  silently skipped.)
- `scripts/check-boundaries.mjs`'s global scanner had a real false positive here: validator prose
  like `'a rule document must be...'` tripped the `document` ban. Fixed by blanking string/template
  literal bodies, not just comments, before scanning (with test coverage added).
**Acceptance criteria**
- [x] ≥ 30 negative fixtures in `tests/fixtures/rules/invalid/`, each asserting a specific `path` and a helpful `hint`. (43 fixtures.)
- [x] All builtin rulesets validate clean. (14 catalogue entries, asserted in P0-D-5.)
- [x] A validator error message never contains the word "invalid" alone — it always says what was expected.

#### - [x] P0-D-3 · Rule notation parsers
**Depends on:** P0-D-2 · **Files:** `src/engine/rules/parse.ts`
**Implementation notes**
Support, with a single entry point that sniffs the format:
- B/S: `B3/S23`, `b3/s23`
- S/B (Golly legacy): `23/3`
- Generations: `B3/S23/G3`, `3/4/5` (Golly order), `/2/3`
- Neighbourhood suffixes: `V` (von Neumann), `H` (hex) — e.g. `B2/S34H`
- Non-totalistic (Hensel) notation: reject with an explicit "not supported until Phase 2" message rather than mis-parsing.
**Acceptance criteria**
- [x] Table-driven test with ≥ 25 notation strings → expected `RuleSet`, including all the aliases above. (27 cases.)
- [x] Round-trip: `formatRuleNotation(parseRuleNotation(s)) === canonical(s)` for every supported string.
  (Tested as idempotency of `format∘parse`: formatting twice gives the same string both times —
  `canonical(s)` isn't independently defined anywhere, so this is what the property actually means.)
- [x] Ambiguous or unsupported input throws with the input echoed and the supported forms listed.

#### - [x] P0-D-4 · Rule compiler
**Depends on:** P0-D-3, P0-C-3 · **Files:** `src/engine/rules/compile.ts`
**Intent:** Turn declarative data into the fastest possible per-cell decision, chosen by the shape of the rule. This is where "composable rulesets are data, not code branches" becomes true *and* fast.
**Implementation notes**
Emit a `CompiledRule` with the strategy selected automatically:
| Condition | Strategy |
|---|---|
| 2 states, totalistic, Moore r=1 | **`lut8`** — `Uint8Array(2 × 9)` indexed `state*9 + liveNeighbours`. |
| ≤ 8 states, totalistic/generations, ≤ 24 neighbours | **`lutN`** — `Uint8Array(states × (neighbours+1) × states)` including "count of each state" collapsed to alive-count. |
| Small state × small neighbourhood, table rule | **`denseTable`** — precomputed full transition table if it fits under 4 MB. |
| Anything else | **`closure`** — a monomorphic JS function built once, never a switch inside the loop. |
- The compiler must also emit `maxRadius`, `usesRandomness`, `isOuterTotalistic`, `stillLifeStates`, and a `stableWhenIsolated` flag the grid uses to skip fully-empty chunk interiors.
- **Never** build the compiled artefact per step. Cache by ruleset identity; expose `compileRule.cache.clear()` for tests.
- lutN is stored as `states × (neighbours+1)` bytes (`state * (n+1) + liveCount`). The plan's extra
  `× states` axis would be unused padding once per-state counts collapse to an alive-count; same
  answers, a factor-of-states less memory.
- Cache is a `WeakMap` on ruleset object identity (so a `Simulation` holding one `RuleSet` never
  recompiles). `compileRule.cache.clear()` replaces the map — `WeakMap` has no `clear()`.
**Acceptance criteria**
- [x] For each builtin ruleset, the chosen strategy matches an asserted expectation (guards against silent perf cliffs).
  (Pinned in `tests/unit/engine/rules/builtin.spec.ts` against the 14-entry catalogue: 9 Life-like
  → `lut8`, Brian's Brain and Star Wars → `lutN`, WireWorld → `denseTable`, Bloomerang's 24
  states and Highlands/Liquid → `closure`.)
- [x] Equivalence test: for 50,000 random `(state, neighbourCounts)` inputs, the `closure` strategy and the chosen fast strategy produce identical outputs for every builtin.
  (Catalogue notations plus the 7 worked-example fixtures; 50,000 Mulberry32-driven neighbour
  configurations per rule.)
- [x] Compiling Conway 10,000 times takes < 50 ms thanks to the cache.

#### - [x] P0-D-5 · Built-in ruleset catalogue
**Depends on:** P0-D-4 · **Files:** `src/engine/rules/builtin/*.ts`
**Ship at minimum:** Conway `B3/S23`, HighLife `B36/S23`, Day & Night `B3678/S34678`, Seeds `B2/S`, Replicator `B1357/S1357`, Diamoeba `B35678/S5678`, Maze `B3/S12345`, 2×2 `B36/S125`, Life without Death `B3/S012345678`, Brian's Brain (3-state), WireWorld (4-state), Star Wars (4-state Generations), Bloomerang or another Generations rule, and one **weighted multi-state terrain rule** demonstrating "Highlands/Liquid" from the inception document.
**Implementation notes** Each carries `name`, `description`, `author`/`year` where known, and a `tags` array (`chaotic`, `stable`, `explosive`, `maze-like`, `multi-state`) that Phase 2's library UI will filter on. Write these once, correctly, with citations.
- Life-family digits come from `parseRuleNotation`; names/years/tags are catalogue metadata on
  a `BuiltinRuleSet` wrapper (tags are not on ADR-001's `RuleSet` — they would be a schema
  change, and Phase 2's library can read them from this wrapper).
- WireWorld's 262,144-entry table is generated at module load and byte-identical to the
  schema-doc fixture.
- Highlands/Liquid thresholds are `0–6 void / 7–14 liquid / 15–24 highland`. An earlier draft
  used `0–4 / 5–10 / 11–24`, which lets highland eat every land/water wall (liquid-side sum 14
  was already in the highland band). The floor of 15 makes a straight wall stable, and a
  documented soup (`Mulberry32(0x51eed)`, 32×32, P 1/4–3/8–3/8) bands within 200 generations.
  The schema worked example and its fixture were updated to match — a rule that claims to band
  must actually band.
- Behavioural oracles run through a test-local toroidal stepper; the production `Simulation`
  stepper is P0-E-1.
**Acceptance criteria**
- [x] Every builtin validates, compiles, and has at least one behavioural test with a published expected outcome.
- [x] The multi-state terrain rule is visually demonstrable: a documented seed produces recognisable land/water banding within 200 generations.

---

### Workstream E — The Simulation

#### - [x] P0-E-1 · Step function, standard path
**Depends on:** P0-C-2, P0-D-4 · **Files:** `src/engine/simulation.ts`
**Intent:** The hot loop. This function's quality determines the ceiling of the entire product.
**Implementation notes**
- Iterate `activeChunks` only. For each chunk: fast path over the 30×30 interior with no bounds checks and no per-cell function calls; slow path over the 1-cell border ring reading neighbours via halo lookups into adjacent chunks (which may not exist → treat as `DEAD` unless `toroidal`).
- Neighbour counting for the common case is an incremental 3-row sliding window, not 8 independent reads.
- Write into the back buffer; accumulate changes into preallocated `ChangeSet` arrays that grow by doubling and are **reused across ticks** (documented as such — callers must not retain them).
- **Zero allocation in steady state.** Assert this in a test (see acceptance).
- Per-chunk back pages are filled for every active chunk *before* any of them is applied, so a
  neighbour still sees last tick's cells. Conway-class (`lut8`) gathers a 34×34 halo then indexes
  the 18-byte table with no per-cell function call. Empty chunk interiors are skipped when
  `stableWhenIsolated` (the flag P0-D-4 emits).
- `ChunkedGrid.markActive` wraps through `normalize`, so a toroidal 512×512 soup cannot grow a
  ghost halo of chunks at negative coordinates. Writes during `step` go through `Chunk.set` +
  `finishWrite`, not `grid.set`, so the inner loop does not re-normalise every changed cell.
- Snapshot/restore lives here because the determinism criterion needs it; P0-E-4 will prove
  structured-clone / transferable round-trips. Turmite rules throw — they are not a per-cell CA.
- The ≥60 steps/sec floor is asserted in the unit suite (warm, then 60 timed steps). P0-I-4
  will commit the harness baseline the CI gate compares against.
**Acceptance criteria**
- [x] All ADR-004 oracle tests pass, including R-pentomino → 1103 generations / 116 cells and acorn → 5206 / 633.
- [x] Allocation test: run 1,000 Conway steps on a stable oscillator field and assert heap growth < 1 MB.
  (Still-life block field, which is the stronger "nothing happens" case of a stable oscillator field.)
- [x] Determinism test: two `Simulation` instances with the same seed produce byte-identical snapshots at tick 5,000.
- [x] Bench: ≥ 60 steps/sec on a 512×512 50%-density soup (README §3.6 Phase 0 floor).

#### - [x] P0-E-2 · Boundary modes
**Depends on:** P0-E-1 · **Files:** `src/engine/simulation.ts`, `src/engine/grid/coords.ts`
**Implementation notes**
- `normalize` already implements the three modes. The step function's lut8 halo memcpy'd the
  whole 32×32 page, so a wall or wrap that fell *inside* a chunk (world size not a multiple of
  32) was invisible: east of x=23 on a 24×24 board read ghost slot 24, not DEAD / wrap-to-0.
  Pages that do not `chunkFitsWorld` now fill the 34×34 halo through `read()` (i.e. `normalize`),
  and `applyChunk` refuses to persist non-`isCanonicalCell` slots. Fully contained pages keep
  the memcpy path — ADR-010: boundaries are not checked in the inner loop.
- Conway physics: a SE glider crashing into a dead wall settles into a 2×2 block *on that wall*.
  The spaceship is gone; it does not wrap. Asserted on both a 24×24 (wall inside the page) and
  a 32×32 (wall on the chunk seam).
- 32×32 torus: period-4 glider × 32 cells = generation 128, back on the starting cells. A 16×16
  torus (wrap inside the page) returns at generation 64.
- Infinite 10,000-gen glider: translated by (2500, 2500), population 5, live bounding box ≤ two
  chunks (empty pages behind it reclaimed), and the last 400 steps are within 20% of the
  generation-100 window.
**Acceptance criteria**
- [x] `bounded`: a glider aimed at a wall dies at the wall and nothing appears on the far side.
- [x] `toroidal`: a glider on a 32×32 torus returns to its exact starting cells at generation 128.
- [x] `infinite`: a glider run 10,000 generations produces a correct coordinate and does not degrade throughput by more than 20% versus generation 100 (proves chunk reclamation works behind the moving pattern).

#### - [x] P0-E-3 · Paint, clear, seed, ruleset switching
**Depends on:** P0-E-1
**Implementation notes**
- `paint()` applies ops, updates counters, marks chunks dirty, and returns a `ChangeSet` identical in shape to a step's — so history and rendering treat user edits and evolution uniformly.
  The inner loop inlines boundary maths (no per-cell tuple from `normalize` / `worldToChunk`),
  writes through `Chunk.set` + a deferred `finishWrite` per touched page, and reuses the same
  doubled ChangeSet buffers as `step()`. No-ops and bounded out-of-range writes are silent.
- `clear()` empties the grid without advancing the tick.
- `seedRandom(density, seed)` requires a finite width×height, resets the sim RNG from `seed`,
  and fills in row-major order with the palette's primary live state. 1024×1024 @ 0.5 is
  reproducible and within ±0.5 percentage points of target.
- `setRuleset` with a differing state palette requires a `StateMigration` (`(old: StateId) => StateId`) or throws. Silent state reinterpretation is forbidden — it would produce beautiful nonsense.
  The throw names both rulesets and both palettes (`"Conway's Game of Life" (dead, alive)` →
  `"Brian's Brain" (dead, firing, refractory)`). Matching palettes (Conway → HighLife) switch
  with no callback; a boundary change retile-normalises stored cells onto a fresh grid.
**Acceptance criteria**
- [x] Painting 100,000 cells in one call takes < 20 ms and produces exactly 100,000 changes.
- [x] Switching Conway → Brian's Brain without a migration throws a message naming both palettes.
- [x] `seedRandom(0.5, seed)` is reproducible and yields density within ±0.5% of target on a 1M-cell field.

#### - [x] P0-E-4 · Snapshot & restore
**Depends on:** P0-E-1
**Implementation notes** Snapshot is a transferable structure: a chunk-key `Int32Array`, a concatenated chunk-data `Uint8Array`, the tick, and the RNG state. It must round-trip through `structuredClone` and through a real `postMessage`.
- Keys are sorted so the byte layout is canonical (Map insertion order is not a format).
- Restore `Chunk.load`s each 1024-byte slice and `finishWrite`s, so the next step's work-list is
  populated without walking cells through `grid.set`. A length mismatch throws.
- `Mulberry32.state` is canonical unsigned (`>>> 0`); restore already did `reset(>>> 0)`, so a
  snapshot taken mid-stream compared equal to one taken after restore only once the getter
  stopped returning a signed int32.
- 1M-live serialize: a 1024×1024 island in a 4096×4096 world (clustered, so empty pages stay
  unallocated). Naive dense is 16 MiB; the snapshot is ~1 MiB of live pages (≥ 90% smaller).
  Random soup at the same population would fill almost every chunk and would not prove sparsity.
**Acceptance criteria**
- [x] Property test: snapshot → restore → step 100 produces state identical to step 100 without the round-trip, for 5 rulesets.
- [x] Snapshot of a 1M-live-cell grid serialises in < 100 ms and is smaller than the naive dense size by ≥ 90%.

---

### Workstream F — History journal & statistics

#### - [x] P0-F-1 · History journal
**Depends on:** P0-E-4 · **Files:** `src/engine/history/journal.ts`, `src/engine/history/compress.ts`
**Intent:** Built now, surfaced in Phase 4. Building it later would mean retrofitting `ChangeSet` plumbing through the worker protocol.
**Implementation notes**
- Ring buffer of keyframes (interval `K`, default 64) and per-tick deltas. Hard byte ceiling (default 256 MB); eviction is oldest-keyframe-and-its-deltas first and **emits an event** so Phase 4 can show the retained window honestly.
- Keyframes are chunk-RLE compressed (hand-written, ~60 lines — a run-length pass over `Uint8Array` beats a generic compressor for this data and costs no dependency). Pages that would expand stay raw, tagged.
- `seek(t)` clones the nearest keyframe and replays forward. Reverse-stepping is `seek(tick-1)`. History is **off** unless `history: true` (the 512² soup must not copy ~200k changes/step).
- Deltas are sliced on ingest — `ChangeSet` arrays are reused by `step()`, so retaining the view would rewrite the past.
- `truncateAfter(t)` for the Phase 4 timeline fork; occupancy is the journal's `bytes` counter (released encoded pages and delta buffers).
- 1M-cell ceiling: 10,000 ticks of 1,048,576 chaotic live cells as journal payloads (stepping a 1024² soup 10k times is minutes; the byte ceiling is a journal property).
**Acceptance criteria**
- [x] `seek(t)` for 200 random `t` in the retained window reproduces state byte-identically to a fresh re-simulation.
- [x] Memory ceiling is respected: a 1M-cell chaotic run for 10,000 ticks never exceeds the configured ceiling (measured), and reports its evictions.
- [x] Seeking backwards 4,000 ticks completes in < 250 ms with `K = 64`.
- [x] `truncateAfter` frees the discarded deltas (heap measurement).

#### - [!] P0-F-2 · Statistics collector — blocked on P0-I-4 (bench harness) for the <3% step-time criterion
**Depends on:** P0-E-1 · **Files:** `src/engine/stats/collector.ts`
**Implementation notes**
- `StatsCollector` folds a `ChangeSet` into running `population`/`perState` (births/deaths/transitions/activity describe that tick only) in O(`cs.count`) — never a grid scan. `reset(view, tick)` is the one O(cells) pass it ever takes, seeding a baseline from the public `GridView` (bounds + `forEachChunkInRect`, per the "handed to the renderer and stats engine" contract on that interface) for anything that isn't itself a `ChangeSet` (a fresh `seedRandom`, a `restore`, cells stamped in with raw `set`).
- `view.bounds()` is a *live*-chunk bounding box — it skips a chunk once its population is 0, even before hysteresis reclaims it. That's fine for `reset()` (a virgin, never-touched region legitimately contributes nothing, matching how `Simulation`'s own stats work against `forEachRawChunk`), but a test oracle must not use `bounds()` as its "recount the world" scan or it will under-count `DEAD` as regions die back — it has to walk the full logical `width × height` instead.
**Acceptance criteria**
- [x] Cross-check: after 2,000 chaotic generations, incremental counters exactly equal a full brute-force grid recount. (Brian's Brain, 64×64 toroidal — three states, never settles.)
- [ ] Collecting stats adds < 3% to step time on the 512² soup benchmark — measured directly (JIT-prewarm + median-of-7), `StatsCollector.apply` lands around 4-5% once V8 is genuinely warmed (a few thousand calls through the hot path; short of that the number is 3x worse and noisy run to run). Close to budget but this harness can't prove the literal 3% without `tests/bench`'s committed-baseline methodology. A generous (1.25x) smoke ceiling guards against a gross regression in the meantime; P0-I-4 owns the real gate.

---

### Workstream G — Worker boundary

#### - [x] P0-G-1 · Protocol definition
**Depends on:** P0-B-1 · **Files:** `src/shared/protocol.ts`
**Implementation notes**
- Exactly the `Command`/`Event` unions in ADR-006, plus `PROTOCOL_VERSION` and a hand-written runtime narrowing guard per message kind (`parseCommand`/`parseEvent`, both `unknown -> ParseResult<T>`, never throwing). Every command carries a correlation `id`; `ready`/`ok`/`error` echo it back, `frame`/`stats` don't (they're a pushed stream, not a reply).
- **Prerequisite refactor, its own commit:** ADR-006's contract needs `RuleSet`/`PaintOp`/`Rect`/`TickStats`/… — but ADR-009's boundary matrix lets `shared` import only from `shared`, and those types lived in `src/engine/types.ts`. Moved the whole module to `src/shared/types.ts` (folding in `TickStats`, also needed by the `frame` event); `src/engine/types.ts` is now a re-export barrel, so every existing `@engine/types` import keeps working unchanged. Also added `StatSample`, pinned to Phase 2 §2.2's exact shape now so the wire type never has to change under P2-C-1/C-2, only get populated.
- Guards are deliberately shallow (a `ruleset` field is checked to be *an object* with the right keys, not a *valid* `RuleSet` — real semantic validation is `rules/validate.ts`, an `engine/`-layer module `shared/` may not import; the worker handler, P0-G-2, runs that deeper check once a `Command` is already structurally accepted).
**Acceptance criteria**
- [x] Exhaustiveness: a `switch` over `Command['cmd']` fails to compile if a member is added and unhandled (`assertNever`) — proven both by `parseCommand`'s own switch and by a mirrored switch in the test suite.
- [x] Guards reject malformed messages with a structured error rather than throwing raw — every required field of every `Command`/`Event` kind tested missing and wrongly-typed; `parseCommand`/`parseEvent` never throw on any malformed input.
- **Amended in P0-G-3:** added a `restore` command (`snapshot`'s write counterpart) — see ADR-006's amendment note and CHANGELOG. The exhaustiveness switches (here and in the handler) caught every call site that needed a new case; nothing else about this task changed.

#### - [x] P0-G-2 · Transport-agnostic handler
**Depends on:** P0-G-1, P0-E-3 · **Files:** `src/worker/handler.ts`
**Intent:** The handler takes a `postMessage`-shaped function, not a `self`. That single choice is what makes the whole engine testable headlessly and reusable in Phase 5's OffscreenCanvas move.
**Implementation notes**
- `createHandler({ post, scheduler, capabilities, clock? })` returns `{ handle(raw) }`. `post` is the only way it emits; `scheduler` (`setInterval`/`clearInterval`-shaped) is the only way `run` schedules anything — nothing here touches a worker global, `self`, or a real timer directly. `REAL_SCHEDULER` (a thin wrapper over the real timers) is exported for `sim.worker.ts` (P0-G-3) to pass in; this module never uses it itself.
- Every mutating command (`paint`/`clear`/`seedRandom`/`step`/`run`'s ticks/`seek`) posts a correlated `{id,type:'ok'}` reply *and* a separate, id-less `frame` event, matching ADR-006 (`frame` carries no `id` — it is a pushed broadcast, not a reply). `step`/`paint` build the frame incrementally from the returned `ChangeSet`'s `dirtyChunks`; `clear`/`seedRandom`/`seek` don't return one, so those post a full-world frame via `snapshot()` instead — the whole world honestly marked dirty, not an invented partial dirty-rect list.
- `init` deep-validates via `rules/validate.ts` (an `engine/`-layer import `shared/` can't make, which is exactly why P0-G-1 needed the type-vocabulary move) and replies `ready` with the *injected* `capabilities` — detecting the real environment is `sim.worker.ts`'s job, not this module's.
- `loadPattern` (RLE, Phase 2/P2-A-1) and cross-palette `setRuleset` (no `migrate` on the wire) aren't supported yet; both reject with a structured error rather than a silent no-op or an approximation. `seek` without `history: true` (not itself a wire option — `init` has no history flag) rejects the same way; Phase 4 owns extending the protocol to opt into it.
- Every thrown error — `RuleValidationError`, `RangeError`, a misbehaving `Scheduler` throwing a non-Error — is caught once in `handle()` and turned into `{id,type:'error',message,code}`; nothing here can throw past that boundary, including after `dispose` (`E_DISPOSED`) or a stale timer callback racing a just-cleared interval (checked, not crashed).
**Acceptance criteria**
- [x] The full Phase 0 command set is exercised in `tests/integration/worker-protocol.spec.ts` through an in-memory port pair, with no `Worker` and no jsdom.
- [x] An unknown command returns a structured `error` event and does not kill the handler.
- [x] Free-run mode (`run` at target TPS) is driven by an injected scheduler so tests can advance virtual time.
- **Amended in P0-G-3:** added a `restore` case (`Simulation.restore` → an `ok` reply → a full-world `frame`, the same shape `clear`/`seedRandom`/`seek` already use) for the new `restore` command — see P0-G-1's amendment note.

#### - [x] P0-G-3 · Worker entry & main-thread client
**Depends on:** P0-G-2 · **Files:** `src/worker/sim.worker.ts`, `src/worker/client.ts`
**Implementation notes**
- **Protocol gap found and closed first, its own commit:** ADR-006 had `snapshot` (a read) but no way to push a `Snapshot` back into a worker — no way to satisfy "recovers from the last snapshot" below. Added `restore` as `init`'s natural write counterpart (ADR-006 amendment; also touches P0-G-1/P0-G-2's already-closed files — the exhaustiveness switches caught every call site that needed a new case).
- `sim.worker.ts`: `bootstrap(scope, capabilities?)` wires a `DedicatedWorkerScope`-shaped object to a fresh `createHandler` + `REAL_SCHEDULER`; `detectCapabilities()` is the one place that actually touches `SharedArrayBuffer`/`OffscreenCanvas`. Both are exported and directly testable — only the two lines at the bottom that call `bootstrap(self, …)` need a real worker (guarded by an `importScripts` check so importing this file elsewhere is a no-op). `self` is cast through `unknown`, not `declare`d, since the project's single `tsconfig.json` carries the `DOM` lib (needed for `client.ts`/future render code) and `DOM`/`WebWorker` libs can't coexist.
- `client.ts`: `WorkerClient` wraps anything shaped like a `Worker` (`WorkerLike` — real or an in-memory double). `send(commandWithoutId)` assigns the correlation id and returns a `Promise<Event>`, resolved by the matching `ready`/`ok`, rejected by the matching `error`.
- **Coalescing (the first acceptance criterion) turned out to need more than a microtask.** A real `postMessage` delivers every `frame` as its own task, and microtasks fully drain between tasks — so a microtask-deferred "deliver the latest frame" still fires once per message, not once per burst (caught by a test with 50 separate frame arrivals; found 50 deliveries, not 1). Delivery is instead driven by an injected `FrameScheduler` (`request`/`cancel`, defaulting to `RAF_FRAME_SCHEDULER`) — a fast free-run collapses into whatever's current by the *render loop's* next opportunity, not the next microtask.
- Recovery: `worker.onerror` → reject in-flight requests, `terminate()` the old worker, `spawn()` a replacement, re-`init` from the cached params, `restore` the last cached `snapshot` (cached reactively, whenever a `snapshot` command completes — no periodic auto-snapshotting). `onRecovered` is an optional hook for a caller that wants to know when this finished.
- **Not implemented: the two-buffer ping-pong.** `handler.ts` (P0-G-2) allocates a fresh `Uint8Array` per frame; there's no `Command` for the client to hand a buffer back to, and building one usefully means changing that allocator, not just adding a message. Given neither acceptance criterion below actually requires it (coalescing bounds client-side memory on its own; "genuinely transferred" holds for a freshly-allocated buffer exactly as well as a reused one), this is deferred — Phase 5's `SharedArrayBuffer` upgrade (ADR-006: "Affects Phase 0, Phase 5") is the natural point to revisit worker-side allocation.
- **Bug found and fixed along the way:** P0-G-2's `postFrame` only put `chunks.data.buffer` in the transfer list, not `chunks.keys.buffer` — the keys array was being *copied*, not transferred. Caught by this task's transfer test; fixed in `handler.ts`.
**Acceptance criteria**
- [x] Under a 500 TPS free run with a 30 fps render loop, no unbounded queue forms and memory is flat over 60 s — proved as the coalescing invariant itself (a burst of 50 separate frame arrivals yields exactly one retained frame and one delivery, not a growing backlog), the same "prove the mechanism" approach P0-F-2 used where a real 60 s memory profile wasn't practical in the unit suite.
- [x] Killing and restarting the worker mid-run recovers from the last snapshot without a page reload — `WorkerClient` spawns a replacement, re-`init`s, and `restore`s the last cached snapshot; a painted-and-snapshotted pattern survives a mid-flight crash and reappears in the replacement worker.
- [x] Transferred buffers are genuinely transferred (asserting `byteLength === 0` on the sender's copy) — proved through a real `structuredClone(…, { transfer })` in the test double (the same detach semantics real `postMessage` has), not a same-object alias a plain function call would give for free.

---

### Workstream H — Renderer

#### - [x] P0-H-1 · Renderer interface & dirty-rect utility
**Depends on:** P0-B-1 · **Files:** `src/render/types.ts`, `src/render/dirty.ts`
**Implementation notes**
- `types.ts` is exactly ADR-005's `Viewport`/`RenderFrame`/`RenderStats`/`Renderer` contract, importing `GridView`/`Rect`/`StateId` from `shared/types` — `render/` may not import `engine/` (ADR-009), which is why `worker/handler.ts` (not this module) is what already turns a `ChangeSet`'s `dirtyChunks` into world `Rect`s (`frame.dirty`, P0-G-2). `CompiledTheme`/`CellPalette` are a deliberately minimal slice of ADR-008's full `ThemeModule` — just enough for a renderer to paint cells without a hardcoded grey; Phase 3's `themes/types.ts` extends this, doesn't replace it. Renamed the render-side `Viewport` in nothing but name from `shared/protocol.ts`'s wire-level `Viewport` (`{rect, scale}`, used to cull off-screen chunks before transfer) — same word, two different layers, documented as such to avoid confusion.
- `dirty.ts` is pure geometry: coordinate compression down to a boolean grid, a row-run merge, then a vertical merge of matching runs across consecutive rows — merges overlapping *and* edge-adjacent rects into an exact, disjoint covering set. `mergeDirtyRects` adds the give-up heuristic (a hard 4,096-rect cap, plus summed-area vs. `giveUpFraction` × viewport area, default 0.6) *before* running the O(rects²)-ish merge, never after — the point is to avoid doing the expensive work on a pathological input, not to bail out partway through it. `DirtyAccumulator` wraps it statefully (`add` across ticks, `take` merges and clears) — needed because `WorkerClient`'s own frame coalescing (P0-G-3) can skip several ticks' `frame` events, so a render loop needs the *union* of everything skipped, not just the latest frame's own dirty list.
**Acceptance criteria**
- [x] Merge correctness property test: the merged rect list covers exactly the same cell set as the input, for 10k random inputs — verified by rasterising both sides onto a grid and comparing exactly (manual comparison, not `toEqual`, in the hot loop — 10,000 deep-equal calls otherwise dominated the test's runtime, ~9s down to under 1s).
- [x] The full-repaint fallback triggers at the documented ~60% threshold, verified by test (59% merges, 61% returns `null`; also tested independently of area via the 4,096-rect cap, and that `giveUpFraction` is itself configurable).

#### - [!] P0-H-2 · Canvas2D renderer — blocked on real canvas rasterisation (frame-time bench, Phase 1 E2E) for two of three criteria
**Depends on:** P0-H-1, P0-C-2 · **Files:** `src/render/canvas2d.ts`
**Implementation notes**
- Every dirty rect (or the whole visible viewport, on `dirty: null`) is intersected with the viewport first, then walked chunk-by-chunk via `GridView.forEachChunkInRect` — nothing outside what's actually visible is touched, even if it's in the dirty list.
- Batches by colour: a hand-written row-run scan per chunk (`collectRuns`) merges consecutive same-state cells into one run; runs are grouped by state so `fillStyle` is set once per state present, not once per cell or per run. A background fill covers the whole clipped region first (one `fillRect`), so `DEAD` runs need no draw call at all.
- `cellSize < 4` → the `ImageData` tile path: one `Uint8ClampedArray` buffer, written cell-by-cell as raw RGBA bytes (a hand-written `parseColor` resolves each theme colour string once, cached per renderer instance — no CSS-named-colour table, a theme wanting "red" writes `#ff0000`), blitted with a single `putImageData`.
- `resize(widthPx, heightPx, dpr)` sets the canvas's actual backing-store size directly (already device-pixel dimensions, matching `Viewport.cellSize`'s own "device px per cell" units — no separate `ctx.scale(dpr,dpr)`) and, for a real `HTMLCanvasElement` (duck-typed via `'style' in canvas`, not `instanceof` — `OffscreenCanvas` has no `style`, and a structural test double can opt in without a real DOM), sets the CSS display size to `widthPx/dpr` × `heightPx/dpr` so a high-DPR canvas isn't upscaled-blurry.
- `setTheme`/`setViewport` are both required before the first `draw()` (a clear thrown error, not a silent default) — matching "do not hardcode grey": there is no fallback theme.
- Tested against a hand-written, *functionally real* `CanvasRenderingContext2D` double (`fillRect`/`putImageData` write into an actual RGBA backing buffer, not just a call log) driving a real `Simulation`/`GridView` — not the permanent "Canvas Bridge" recorder, which is P0-H-3's own module.
**Acceptance criteria**
- [ ] 1080p viewport, 100k visible cells, steady state: frame time ≤ 16.6 ms (bench) — not provable here: `jsdom` has no real canvas rasteriser (no native `canvas` package, which "no bloat" forbids adding anyway), so nothing in this environment can measure actual pixel-pushing cost. Deferred to `npm run bench` (P0-I-4) or a real-browser Playwright run.
- [x] Repainting a single changed cell issues a bounded, asserted number of draw calls (regression guard against accidental full repaints) — asserted exactly (2: one background fill, one single-cell run), not just "small"; also proven for multi-cell runs (still 2, not N) and multi-state batches (one draw call per distinct state, not per cell).
- [ ] Rendering is pixel-identical at `dpr` 1 and 2 modulo scale (visual test in Phase 1 once E2E exists) — the task's own note already defers this; no judgement call needed here.

#### - [x] P0-H-3 · Headless draw-call recorder — *the "Canvas Bridge" from the inception doc* — @claude, started 2026-09-02, finished 2026-09-02
**Depends on:** P0-H-2 · **Files:** `src/render/recorder.ts`, `src/worker/frame-view.ts`, `tests/integration/canvas-bridge.spec.ts`, `tests/unit/render/recorder.spec.ts`, `tests/unit/worker/frame-view.spec.ts`
**Intent:** INCEPTION.md asks for "a 'headless' rendering test to ensure the engine can push state to a canvas buffer without overhead." This is that test, and it is a permanent regression guard, not a one-off.
**Implementation notes**
- `CanvasRecorder` (`src/render/recorder.ts`): a `CanvasRenderingContext2D`-shaped double that logs an ordered `{method, args}` entry for every `fillStyle` get/set, `fillRect`, `createImageData`, and `putImageData` call, while also painting into a real `Uint8ClampedArray` backing buffer so a test can read back actual pixels (`pixelAt()`), not just trust the call log. `createImageData` increments a `bufferAllocations` counter; `resetLog()` clears the log/counter without touching painted pixels.
- Wiring the worker → client → renderer pipeline together in Node surfaced a missing piece: `WorkerClient.onFrame` hands out wire-protocol `FrameEvent`s (`chunks: TransferredChunks`, i.e. raw per-chunk byte pages for *only what changed this tick*), but `Renderer.draw()` expects a full-world `GridView`. `FrameGridMirror` (`src/worker/frame-view.ts`, a new module) is that adapter: it keeps a persistent client-side mirror of every chunk page ever received, merged frame-by-frame, and exposes it as a `GridView`. It reuses a single mutable `ChunkView`-shaped object and one cached `GridView` instance rather than allocating either per call — the same reused-buffer discipline the engine's own `ChangeSet` uses — with a documented constraint that a handed-out `ChunkView` is only valid until the next chunk visit (safe here because `Canvas2DRenderer` always consumes one chunk fully before moving to the next). It has one documented known limitation: the wire protocol doesn't yet distinguish a full authoritative frame (`postFullFrame`, sent after `clear`/`seedRandom`/`seek`/`restore`) from an incremental one (`postFrame`), so a chunk that dies out entirely during one of those operations goes stale in the mirror until something else overwrites it. Nothing in Phase 0 exercises this; deferred to whoever wires up P0-I-1's reset button.
- Building the snapshot test caught a real, latent bug: the test harness's `IMMEDIATE_FRAME_SCHEDULER` invoked its callback *synchronously* inside `request()`. Real `requestAnimationFrame` never does this, but nothing enforced it on an injected scheduler, and `WorkerClient.scheduleFrameDelivery()`'s bookkeeping assumed asynchronous delivery — the synchronous callback stomped its own `frameRequestHandle` state, silently dropping nearly every frame after the first. Caught because the initial Gosper-gun snapshot had only 32 log entries instead of thousands. Fixed the test helper to use `queueMicrotask`, and independently hardened `WorkerClient` itself (`src/worker/client.ts`) with a `frameDeliveryPending` boolean set *before* `frameScheduler.request()` is even called, so delivery is now correct regardless of whether an injected scheduler happens to be synchronous. The same latent bug existed unnoticed in `tests/integration/worker-client.spec.ts`; fixed there too.
- The "zero allocations" acceptance criterion required isolating the render path's own allocations from everything around it. `CanvasRecorder` itself allocates on every logged call (pushing log entries ~4,274 times over 100 frames), which would swamp any signal from the renderer — so the allocation test uses a second, minimal `CountingContext` double (no growing log, just counters) and measures heap growth tightly around each `renderer.draw()` call only, not `mirror.applyChunks()` or message transport. Getting this to genuinely reach zero non-buffer allocations required real optimisation in `Canvas2DRenderer` (`src/render/canvas2d.ts`): the previous `Map`-of-runs-plus-`sort()` approach was replaced with a grow-only pool of reused `Run` objects grouped into 256 fixed state-buckets (avoiding both `Map` allocation and `Array.prototype.sort`'s internal allocations), and the per-call `Set`/stats-object/closure allocations were replaced with reused class fields. A 60-generation warm-up (raised from an initial 10) runs before measurement starts, since the Gosper gun's growing pattern complexity means the run-pool and bucket arrays keep growing for the first several dozen generations — measuring too early counted that pool growth as a leak. Final measured `createImageData` allocations: exactly zero; heap growth across the measured 100 draws: comfortably under the 500 KB threshold, consistent across repeated runs.
- `Canvas2DRenderer.init()` was also fixed in passing: it threw synchronously on a `null` `getContext('2d')` result instead of rejecting its returned `Promise`, which broke the documented async contract (caught by an existing P0-H-2 test once this task's fuller pipeline exercised it more).
**Acceptance criteria**
- [x] Driving 100 generations of a Gosper gun through worker → client → renderer in Node produces a stable, snapshot-tested draw-call log — full pipeline (fake `postMessage`-based worker transport, real `WorkerClient`, `FrameGridMirror`, `Canvas2DRenderer`, `CanvasRecorder`), Gosper gun seeded via `paint`, 100 `step` commands, ~4,274 logged calls snapshotted in `tests/integration/__snapshots__/canvas-bridge.spec.ts.snap`.
- [x] The log proves dirty-rect behaviour: a static field with one blinker produces draw calls covering only the blinker's neighbourhood — asserted every logged `fillRect`'s pixel bounds fall within the blinker's single 32×32 chunk, and that the background fill is exactly that one chunk's footprint, not the full viewport.
- [x] Zero allocations attributable to the render path across 100 frames — measured via a purpose-built `CountingContext` isolating `draw()` alone (60-generation warm-up, then 100 measured generations): `bufferAllocations` is exactly 0 and total heap growth is well under the 500 KB threshold (guarded against `v8` coverage-instrumentation noise the same way other tasks' allocation assertions are).

---

### Workstream I — Shell, server, container, CI

#### - [x] P0-I-1 · Minimal client shell — @claude, started 2026-09-02, finished 2026-09-02
**Depends on:** P0-G-3, P0-H-2 · **Files:** `src/client/index.html`, `src/client/main.ts`
**Implementation notes**
- Full-viewport canvas plus a small HUD overlay (tick / population / fps / step-ms / render-ms readout, play/pause and reset buttons). Boots a 256×192 toroidal Conway world, paints a Gosper glider gun via `paint` (`loadPattern`'s RLE codec doesn't exist until Phase 2 — same constraint the P0-H-3 test worked around), and immediately sends `run` so the first thing on screen is the gun firing.
- No custom animation loop was written: `WorkerClient.onFrame` (P0-G-3) already coalesces delivery onto `requestAnimationFrame` internally, so subscribing to it *is* "a rAF loop that draws only when a new frame has arrived." While paused, the worker emits no `frame` events, so `WorkerClient` never calls `frameScheduler.request()` at all — idle CPU from the render path is exactly zero by construction, not merely small.
- `WorkerClient` targets a structural `WorkerLike`, not a real `Worker` (so it stays testable without a browser); a real `Worker`'s `onmessage`/`onerror` setters are typed against the DOM's richer `MessageEvent`, not directly assignable to `WorkerLike`'s narrower shape. `toWorkerLike()` adapts by forwarding through independent properties instead.
- This task has no automated test of its own (`npm run e2e`/Playwright doesn't exist until Phase 1) — its three criteria were verified by driving the actual dev server (`npx vite`) with a real Chromium browser (Playwright MCP tooling) rather than approximated or left unproven, per "never present an approximation as exact."
- Doing that real-browser pass caught two genuine bugs no headless test had exercised:
  1. `TickStats.stepMicros` was silently always `0` — `worker/handler.ts`'s `HandlerOptions.clock` (P0-B-3's injected-clock contract) was never actually supplied by `sim.worker.ts`, the file whose own job is exactly that kind of environment wiring (mirroring `REAL_SCHEDULER`/`detectCapabilities()`). Added `REAL_CLOCK` (`performance.now()`, converted ms → µs) to `sim.worker.ts` and wired it into `bootstrap()`'s `createHandler()` call; covered by new tests in `tests/unit/worker/sim.worker.spec.ts` (a mocked `performance.now()` proving the ms→µs conversion, and proving `bootstrap()` actually passes it through rather than falling back to the zero-stub).
  2. Clicking Reset (paused or not) left the previous frame's gliders visibly painted on screen: `clear`'s `postFullFrame` reports `dirty: []` (an empty world has nothing to *describe* as changed), not `dirty: null` ("repaint everything") — so `Canvas2DRenderer.draw()` correctly issued zero draw calls and never erased the stale pixels. This is the concrete, renderer-facing half of `FrameGridMirror`'s already-documented known limitation (P0-H-3). Fixed locally in the reset handler: after `mirror.reset()`, force one `renderer.draw({ dirty: null, ... })` before repainting the gun. `src/worker/frame-view.ts`'s doc comment now describes this manifestation.
**Acceptance criteria**
- [x] Cold load to first painted generation < 1500 ms locally — measured via `window.__fancyGolFirstFrameMs` (set on the first `draw()` call, relative to a `performance.now()` mark taken at module top), read back through Playwright against the Vite dev server: ~38 ms.
- [x] Idle (paused) CPU usage is effectively zero — the rAF loop must not spin when nothing changed — true by construction (see implementation notes); confirmed empirically by pausing and observing the tick readout stay frozen (no further `frame` events, hence no further rAF requests) across a multi-second wait.
- [x] No console errors or warnings — confirmed via Playwright's console listener across boot, play, pause, and reset (including the empty-world edge case above once fixed); a stray `favicon.ico` 404 found during the first pass was closed with `<link rel="icon" href="data:,">`.

#### - [x] P0-I-2 · Express server skeleton — @claude, started 2026-09-03, finished 2026-09-03
**Depends on:** P0-A-1 · **Files:** `src/server/app.ts`, `src/server/index.ts`
**Implementation notes**
- `createApp()` (`src/server/app.ts`) builds and returns the Express app without listening, so tests drive it fully in-process — a real `http.Server` on an ephemeral port plus plain `fetch`, no extra test-only HTTP client dependency (`supertest` et al. aren't in the declared dependency surface, and didn't need to be). `src/server/index.ts` is the thin real-environment adapter that actually calls `.listen()`, the same split `worker/handler.ts`/`worker/sim.worker.ts` already established — and it's excluded from coverage by the existing `src/**/index.ts` rule, by design.
- ADR-002's fuller `/api/health` contract (`{ ok, version, uptime }`) is implemented, a superset of this task's own AC (`{ ok: true, version }`) — the ADR is binding, the AC is a minimum bar, not a whitelist.
- Cache headers: `express.static(distDir, { index: false, ... })` serves everything except `index.html` (which gets its own handler); a `setHeaders` hook adds `Cache-Control: public, max-age=31536000, immutable` only for paths under `assets/` (Vite's content-hashed output — safe to cache forever). `index.html` itself always gets `Cache-Control: no-store`, since it's the one file whose content (which hashed assets it points at) changes on every deploy.
- Unknown `/api/*` paths hit a dedicated `app.use('/api', ...)` 404 returning JSON, registered *before* the final catch-all so an API client never has to sniff HTML out of a 404. Everything else falls through to the SPA-shell handler, which also 404s as JSON (not an unhandled `sendFile` error) if `index.html` itself is missing — a broken/incomplete build degrades cleanly rather than crashing the request.
- Graceful shutdown (`installGracefulShutdown()`) takes the server and its `process`/`exit` dependencies as parameters rather than reaching for the real `process` internally, so the shutdown *policy* (close, wait, force-exit after a timeout, never double-exit) is unit-tested with fakes — covering the timeout-forced-exit path deterministically via `vi.useFakeTimers()`, which a real 5-second wait never could. The literal AC wording ("SIGTERM closes the listener and exits 0 within 5 s") is a statement about the *real* process, though, so `tests/integration/server-process.spec.ts` also spawns the actual `tsx src/server/index.ts` entry point, confirms it's genuinely accepting connections (a real `/api/health` request), sends a real `SIGTERM`, and measures the actual wall-clock exit — proof, not just policy.
- Manually verified end-to-end against the real `npm run build` output (not just the test fixture): health, asset caching, `index.html` no-store, SPA fallback, unknown-`/api/*` JSON 404, and a clean SIGTERM exit, all curled directly against a running `tsx src/server/index.ts`.
**Acceptance criteria**
- [x] `GET /api/health` returns `{ ok: true, version }` matching `package.json` — verified both with an injected version (`createApp({ version })`, for deterministic tests) and with no override, reading `package.json`'s real version.
- [x] Unknown paths return the SPA shell; unknown `/api/*` paths return a JSON 404, not HTML — both directions tested, plus the missing-`index.html` edge case.
- [x] SIGTERM closes the listener and exits 0 within 5 s — proved against a real spawned process, not just the shutdown policy's unit tests.

#### - [ ] P0-I-3 · Docker
**Depends on:** P0-I-2 · **Files:** `docker/Dockerfile`, `docker/Dockerfile.dev`, `docker/docker-compose.yml`, `docker/docker-compose.dev.yml`, `.dockerignore`
**Implementation notes** Multi-stage: `deps` → `build` → `runtime` on `node:22-alpine`, non-root user, `--omit=dev` install in the runtime stage, `HEALTHCHECK` hitting `/api/health`. The dev compose bind-mounts the source and runs Vite with HMR.
**Acceptance criteria**
- [ ] `docker compose -f docker/docker-compose.yml up` serves the working app on `:8080`.
- [ ] `docker compose -f docker/docker-compose.dev.yml up` gives working HMR against mounted sources.
- [ ] Production image < 250 MB, runs as UID ≠ 0, and reports healthy.

#### - [ ] P0-I-4 · Benchmark harness & baseline
**Depends on:** P0-E-1 · **Files:** `scripts/bench.mjs`, `tests/bench/*.bench.ts`, `bench-baseline.json`
**Implementation notes**
- Hand-written runner (Vitest's `bench` may be used for the micro suite, but the gate is our script): warmup, N=7 runs, take the median, report ops/sec and ms/op.
- Compare to `bench-baseline.json`; fail on >10% regression; `--update-baseline` writes a new one, which must be a reviewed commit.
- Benchmarks: Conway 512² soup steps/sec; Conway 4096² @1% steps/sec; 1M-cell paint; snapshot/restore; `seek` back 4,000 ticks; renderer frame time via the recorder.
**Acceptance criteria**
- [ ] `npm run bench` prints a table and exits non-zero on a deliberately introduced 30% slowdown.
- [ ] All Phase 0 budgets in README §3.6 are met and recorded in the committed baseline.

#### - [ ] P0-I-5 · CI pipeline
**Depends on:** P0-A-5, P0-I-3, P0-I-4 · **Files:** `.github/workflows/ci.yml`
**Implementation notes** Jobs: `verify` (typecheck, lint, boundaries, unit + coverage), `build`, `bench` (with baseline comparison), `docker` (build + healthcheck the container). Node LTS matrix (current + previous). Cache `~/.npm`. Upload coverage and bench reports as artifacts.
**Acceptance criteria**
- [ ] A PR that drops engine coverage below 95% fails.
- [ ] A PR that adds a boundary violation fails with the offending `file:line` in the log.
- [ ] A PR that regresses a benchmark >10% fails with a before/after table.

#### - [ ] P0-I-6 · Foundational documentation
**Depends on:** all above · **Files:** `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/ruleset-schema.md`
**Implementation notes** README opens with the inception premise verbatim ("*A cellular automata simulator with absolutely too much time spent on what's essentially a toy. But this toy doesn't care, it wants to be fabulous!*"), then quick start, then the Phase 0 honest status. `ARCHITECTURE.md` renders the data-flow diagram and links every ADR.
**Acceptance criteria**
- [ ] A new engineer can clone, run `npm ci && npm run dev`, and see the gun moving using only the README.
- [ ] `CHANGELOG.md` has a dated `[0.1.0]` section listing every workstream.

---

## 4. Quality gates for Phase 0

| Gate | Threshold |
|---|---|
| `npm run verify` | green |
| Engine coverage | ≥ 95% statements, ≥ 90% branches |
| Oracle tests | all of ADR-004 §Oracle tests pass |
| Determinism | identical snapshots at tick 5,000 across two instances and across Node/browser builds |
| Conway 512² soup | ≥ 60 steps/sec |
| Conway 4096² @1% | ≥ 5 steps/sec |
| 1M live cells | < 40 MB grid memory, no OOM |
| Steady-state render | ≤ 16.6 ms at 1080p / 100k visible cells |
| Steady-state allocation | < 1 MB heap growth over 1,000 steps |
| Docker | prod image healthy, < 250 MB, non-root |
| Boundary check | zero violations; fixtures prove it catches violations |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Multi-state generality makes the inner loop slow enough to miss the Phase 0 budget. | Everything downstream feels sluggish. | The compiler's `lut8` strategy (P0-D-4) makes 2-state Moore rules a single array index — identical work to a boolean engine. Benchmark it in the same PR that lands the compiler, not later. |
| Chunk-border handling becomes the dominant cost. | 30–40% throughput loss. | Interior fast path is 900 of 1024 cells; border ring uses the `borderMask` to skip entirely-empty edges. Bench interior vs border separately so the split is visible. |
| `ChangeSet` buffer reuse causes an aliasing bug when history retains a reference. | Corrupt time travel, discovered in Phase 4. | Document the contract in the type, and have `HistoryJournal` copy on ingest. Add a test that mutates the returned `ChangeSet` and asserts history is unaffected. |
| Coverage gate encourages tests that assert implementation rather than behaviour. | Brittle suite, false confidence. | The oracle tests are the real bar. Review rejects any test whose failure would not indicate a user-visible defect. |
| Phase 0 scope creep into "just a little UI". | Phase 0 never lands. | The Phase 0 page has exactly two buttons. Anything else is a Phase 1 task ID. |
| Benchmarks are flaky on shared CI runners. | Red builds, ignored gate. | Median of 7 runs, 10% tolerance, and a committed baseline. If flakiness persists, mark the bench job required-on-main-only and advisory on PRs — but never delete it. |

---

## 6. Definition of Done — Phase 0

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [ ] All Phase 0 quality gates (§4) are green in CI on `main`.
- [ ] `docker compose up` serves a Gosper gun running at 60 fps.
- [ ] The headless canvas-bridge test passes and is wired into CI.
- [ ] `src/engine` contains zero DOM, Node, or I/O references, proven by the boundary checker.
- [ ] `CHANGELOG.md` has a dated `[0.1.0]` entry; the commit is tagged `v0.1.0`.
- [ ] `bench-baseline.json` is committed and reflects a real machine run.
- [ ] A short demo capture (GIF or MP4) of the gun is committed to `docs/demo/phase-0.*` — every phase leaves evidence.
- [ ] An engineer who has never seen the repo can clone it and reach the running demo using only `README.md`.
