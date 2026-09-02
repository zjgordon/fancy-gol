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

#### - [ ] P0-E-2 · Boundary modes
**Depends on:** P0-E-1 · **Files:** `src/engine/simulation.ts`, `src/engine/grid/coords.ts`
**Acceptance criteria**
- [ ] `bounded`: a glider aimed at a wall dies at the wall and nothing appears on the far side.
- [ ] `toroidal`: a glider on a 32×32 torus returns to its exact starting cells at generation 128.
- [ ] `infinite`: a glider run 10,000 generations produces a correct coordinate and does not degrade throughput by more than 20% versus generation 100 (proves chunk reclamation works behind the moving pattern).

#### - [ ] P0-E-3 · Paint, clear, seed, ruleset switching
**Depends on:** P0-E-1
**Implementation notes**
- `paint()` applies ops, updates counters, marks chunks dirty, and returns a `ChangeSet` identical in shape to a step's — so history and rendering treat user edits and evolution uniformly.
- `setRuleset` with a differing state palette requires a `StateMigration` (`(old: StateId) => StateId`) or throws. Silent state reinterpretation is forbidden — it would produce beautiful nonsense.
**Acceptance criteria**
- [ ] Painting 100,000 cells in one call takes < 20 ms and produces exactly 100,000 changes.
- [ ] Switching Conway → Brian's Brain without a migration throws a message naming both palettes.
- [ ] `seedRandom(0.5, seed)` is reproducible and yields density within ±0.5% of target on a 1M-cell field.

#### - [ ] P0-E-4 · Snapshot & restore
**Depends on:** P0-E-1
**Implementation notes** Snapshot is a transferable structure: a chunk-key `Int32Array`, a concatenated chunk-data `Uint8Array`, the tick, and the RNG state. It must round-trip through `structuredClone` and through a real `postMessage`.
**Acceptance criteria**
- [ ] Property test: snapshot → restore → step 100 produces state identical to step 100 without the round-trip, for 5 rulesets.
- [ ] Snapshot of a 1M-live-cell grid serialises in < 100 ms and is smaller than the naive dense size by ≥ 90%.

---

### Workstream F — History journal & statistics

#### - [ ] P0-F-1 · History journal
**Depends on:** P0-E-4 · **Files:** `src/engine/history/journal.ts`, `src/engine/history/compress.ts`
**Intent:** Built now, surfaced in Phase 4. Building it later would mean retrofitting `ChangeSet` plumbing through the worker protocol.
**Implementation notes**
- Ring buffer of keyframes (interval `K`, default 64) and per-tick deltas. Hard byte ceiling (default 256 MB); eviction is oldest-keyframe-and-its-deltas first and **emits an event** so Phase 4 can show the retained window honestly.
- Keyframes are chunk-RLE compressed (hand-written, ~60 lines — a run-length pass over `Uint8Array` beats a generic compressor for this data and costs no dependency).
- `seek(t)` clones the nearest keyframe and replays forward. Reverse-stepping is `seek(tick-1)`.
- `truncateAfter(t)` for the Phase 4 timeline fork.
**Acceptance criteria**
- [ ] `seek(t)` for 200 random `t` in the retained window reproduces state byte-identically to a fresh re-simulation.
- [ ] Memory ceiling is respected: a 1M-cell chaotic run for 10,000 ticks never exceeds the configured ceiling (measured), and reports its evictions.
- [ ] Seeking backwards 4,000 ticks completes in < 250 ms with `K = 64`.
- [ ] `truncateAfter` frees the discarded deltas (heap measurement).

#### - [ ] P0-F-2 · Statistics collector
**Depends on:** P0-E-1 · **Files:** `src/engine/stats/collector.ts`
**Implementation notes** Derives population, per-state counts, births, deaths, transitions and activity from the `ChangeSet` in O(changes) — **never** by scanning the grid. Maintains a running population so the cost is independent of grid size.
**Acceptance criteria**
- [ ] Cross-check: after 2,000 chaotic generations, incremental counters exactly equal a full brute-force grid recount.
- [ ] Collecting stats adds < 3% to step time on the 512² soup benchmark.

---

### Workstream G — Worker boundary

#### - [ ] P0-G-1 · Protocol definition
**Depends on:** P0-B-1 · **Files:** `src/shared/protocol.ts`
**Implementation notes** Exactly the `Command`/`Event` unions in ADR-006, plus `PROTOCOL_VERSION` and a hand-written runtime narrowing guard per message kind. Every command carries a correlation `id`; every reply echoes it.
**Acceptance criteria**
- [ ] Exhaustiveness: a `switch` over `Command['cmd']` fails to compile if a member is added and unhandled (`assertNever`).
- [ ] Guards reject malformed messages with a structured error rather than throwing raw.

#### - [ ] P0-G-2 · Transport-agnostic handler
**Depends on:** P0-G-1, P0-E-3 · **Files:** `src/worker/handler.ts`
**Intent:** The handler takes a `postMessage`-shaped function, not a `self`. That single choice is what makes the whole engine testable headlessly and reusable in Phase 5's OffscreenCanvas move.
**Acceptance criteria**
- [ ] The full Phase 0 command set is exercised in `tests/integration/worker-protocol.spec.ts` through an in-memory port pair, with no `Worker` and no jsdom.
- [ ] An unknown command returns a structured `error` event and does not kill the handler.
- [ ] Free-run mode (`run` at target TPS) is driven by an injected scheduler so tests can advance virtual time.

#### - [ ] P0-G-3 · Worker entry & main-thread client
**Depends on:** P0-G-2 · **Files:** `src/worker/sim.worker.ts`, `src/worker/client.ts`
**Implementation notes**
- `WorkerClient` gives a promise-based RPC over the correlation ids, plus an `onFrame` subscription. It owns backpressure: if a frame arrives while the previous is unrendered, **coalesce** — never queue frames.
- Frames transfer chunk buffers; the client must return buffers to the worker (a two-buffer ping-pong) so neither side allocates per frame.
**Acceptance criteria**
- [ ] Under a 500 TPS free run with a 30 fps render loop, no unbounded queue forms and memory is flat over 60 s.
- [ ] Killing and restarting the worker mid-run recovers from the last snapshot without a page reload.
- [ ] Transferred buffers are genuinely transferred (asserting `byteLength === 0` on the sender's copy).

---

### Workstream H — Renderer

#### - [ ] P0-H-1 · Renderer interface & dirty-rect utility
**Depends on:** P0-B-1 · **Files:** `src/render/types.ts`, `src/render/dirty.ts`
**Implementation notes** `dirty.ts` accumulates changed chunk keys into world rects and merges overlapping/adjacent rects, with a heuristic that gives up and returns `null` (full repaint) once the union exceeds ~60% of the viewport — merging 4,000 rects costs more than repainting.
**Acceptance criteria**
- [ ] Merge correctness property test: the merged rect list covers exactly the same cell set as the input, for 10k random inputs.
- [ ] The full-repaint fallback triggers at the documented threshold, verified by test.

#### - [ ] P0-H-2 · Canvas2D renderer
**Depends on:** P0-H-1, P0-C-2 · **Files:** `src/render/canvas2d.ts`
**Implementation notes**
- Clip to dirty rects, then iterate only chunks intersecting them via `GridView.forEachChunkInRect`.
- Batch by colour: build per-state path/rect runs and issue one fill per state per rect, not one `fillRect` per cell.
- `cellSize < 4` → render via a pre-rasterised offscreen tile whose pixels are written through `ImageData` (one `putImageData` beats thousands of `fillRect`s).
- Handle `devicePixelRatio` correctly; never render blurry.
- Cell colours come from a `CompiledTheme` — a minimal one in Phase 0, the full ADR-008 module in Phase 3. Do not hardcode grey into the renderer.
**Acceptance criteria**
- [ ] 1080p viewport, 100k visible cells, steady state: frame time ≤ 16.6 ms (bench).
- [ ] Repainting a single changed cell issues a bounded, asserted number of draw calls (regression guard against accidental full repaints).
- [ ] Rendering is pixel-identical at `dpr` 1 and 2 modulo scale (visual test in Phase 1 once E2E exists).

#### - [ ] P0-H-3 · Headless draw-call recorder — *the "Canvas Bridge" from the inception doc*
**Depends on:** P0-H-2 · **Files:** `src/render/recorder.ts`, `tests/integration/canvas-bridge.spec.ts`
**Intent:** INCEPTION.md asks for "a 'headless' rendering test to ensure the engine can push state to a canvas buffer without overhead." This is that test, and it is a permanent regression guard, not a one-off.
**Implementation notes** A `CanvasRenderingContext2D`-shaped recorder capturing an ordered log of calls and arguments. It also counts allocations by wrapping the buffer accessors.
**Acceptance criteria**
- [ ] Driving 100 generations of a Gosper gun through worker → client → renderer in Node produces a stable, snapshot-tested draw-call log.
- [ ] The log proves dirty-rect behaviour: a static field with one blinker produces draw calls covering only the blinker's neighbourhood.
- [ ] Zero allocations attributable to the render path across 100 frames.

---

### Workstream I — Shell, server, container, CI

#### - [ ] P0-I-1 · Minimal client shell
**Depends on:** P0-G-3, P0-H-2 · **Files:** `src/client/index.html`, `src/client/main.ts`
**Implementation notes** Full-viewport canvas, a rAF loop that draws only when a new frame has arrived, and a small readout of tick / population / fps / step-ms / render-ms. Boots with a Gosper glider gun so the very first thing anyone sees is the thing moving. Two buttons only: play/pause and reset.
**Acceptance criteria**
- [ ] Cold load to first painted generation < 1500 ms locally.
- [ ] Idle (paused) CPU usage is effectively zero — the rAF loop must not spin when nothing changed.
- [ ] No console errors or warnings.

#### - [ ] P0-I-2 · Express server skeleton
**Depends on:** P0-A-1 · **Files:** `src/server/app.ts`, `src/server/index.ts`
**Implementation notes** `createApp()` returns an app without listening, so tests can drive it in-process. Serves `dist/client` with correct cache headers (hashed assets immutable, `index.html` no-store) and implements `GET /api/health`. Graceful SIGTERM shutdown. **No API routes yet** — Phase 1 owns those.
**Acceptance criteria**
- [ ] `GET /api/health` returns `{ ok: true, version }` matching `package.json`.
- [ ] Unknown paths return the SPA shell; unknown `/api/*` paths return a JSON 404, not HTML.
- [ ] SIGTERM closes the listener and exits 0 within 5 s.

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
