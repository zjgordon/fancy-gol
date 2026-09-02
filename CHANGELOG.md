# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository toolchain scaffold: `package.json` scripts (`dev`, `build`, `test`, `coverage`,
  `lint`, `typecheck`, `boundaries`, `verify`, …), strict TypeScript configuration, Vite +
  Vitest configuration with per-directory coverage thresholds, flat ESLint config with an
  engine-purity global ban, Prettier, and a hand-written Conventional Commits `commit-msg`
  hook. (P0-A-1, P0-A-2, P0-A-3, P0-A-4, P0-A-6)
- `scripts/check-boundaries.mjs` — hand-written layer-boundary checker enforcing the ADR-009
  dependency matrix and the `src/engine/**` global ban, with unit fixtures proving it catches
  cross-layer and forbidden-global violations. (P0-A-5)
- `src/engine/types.ts` — the engine's public type vocabulary (ADR-001): `StateId`, `StateDef`,
  `Neighborhood`, `TransitionSpec`, `RuleSet`, `ChangeSet`, `GridView`, `Snapshot`,
  `StateMigration`, and friends, pinned by compile-time `expectTypeOf` assertions. (P0-B-1)
- `src/engine/rng.ts` — a hand-written, deterministic Mulberry32 PRNG (`next`, `nextInt`,
  `fork`, `state`), verified deterministic across runs and uniform by a chi-square test.
  (P0-B-2)
- `src/engine/clock.ts` — an injectable `Clock` interface and `TestClock`, so the engine can
  measure its own step time without ever touching `performance` or `Date`. The boundary
  checker's forbidden-global list now also bans `Date` in `src/engine/**`, and no longer
  misfires on globals merely mentioned in a comment. (P0-B-3)
- `src/engine/grid/coords.ts` — chunk sizing, cell/chunk coordinate packing, and boundary-mode
  (`bounded`/`toroidal`/`infinite`) normalisation, with the `WORLD_LIMIT` (±1,048,576 cells)
  documented and enforced rather than silently exceeded. (P0-B-4)
- `src/engine/grid/chunk.ts` — a pooled, recyclable 32×32 `Chunk` maintaining its own
  population, per-state counts, and an 8-region border-occupancy mask incrementally, never by
  rescanning. (P0-C-1)
- `src/engine/grid/chunked-grid.ts` — the sparse `Map<number, Chunk>` grid: lazy chunk
  allocation, hysteresis-delayed empty-chunk reclamation, an `activeChunks` work-list, and a
  read-only `GridView` façade for the renderer and stats engine. (P0-C-2 — the 1M-live-cell
  memory budget is deferred to the `tests/bench` harness, P0-I-4, which doesn't exist yet.)
- `src/engine/neighborhood/**` — `Int8Array` offset tables for Moore, von Neumann, hex
  (row-parity-aware, verified symmetric), and validated custom neighbourhoods, compiled once
  per ruleset rather than per cell. `src/engine/rules/errors.ts` introduces the structured
  `RuleValidationError` a phase early, since custom-offset validation needs it and P0-D-2 will
  reuse it unchanged. (P0-C-3)
- `src/engine/rules/schema.ts` and `docs/ruleset-schema.md` — the `RuleSetDocument` shape
  (a `RuleSet` plus a schema `version`) and a complete, human-readable field-by-field
  reference with a copy-pasteable worked example for every `transition` kind: Conway, Seeds,
  and Brian's Brain (`totalistic`), a Generations demo, WireWorld (`stateTable`, generated —
  262,144 entries is not something a human hand-writes), Highlands/Liquid (`weighted`, the
  inception document's own terrain example), and Langton's Ant (`turmite`). (P0-D-1)
- `src/engine/rules/validate.ts` — a hand-written (no `ajv`) `RuleSetDocument` validator: every
  check collected into one structured `RuleValidationError`, never stopping at the first
  failure, with a real JSON-pointer `path` and a `hint` on every issue. 43 negative fixtures in
  `tests/fixtures/rules/invalid/`. Fixed a real false positive in
  `scripts/check-boundaries.mjs`'s global scanner along the way: validator prose like `'a rule
  document must be...'` was tripping the `document` ban, because the scanner only stripped
  comments, not string/template literals, before matching. (P0-D-2)
- `src/engine/rules/parse.ts` — `parseRuleNotation`/`formatRuleNotation`: one entry point that
  sniffs B/S, legacy S/B, and Generations (both `B../S../G<n>` and Golly-order) notation, plus
  a trailing V/H neighbourhood suffix, and rejects Hensel/non-totalistic notation by name
  rather than mis-parsing it. 27 table-driven cases, each canonicalising idempotently. (P0-D-3)
- `src/engine/rules/compile.ts` — `compileRule` turns a `RuleSet` into a `CompiledRule`: `lut8`
  for 2-state Moore-r1 totalistic (Conway is an 18-byte table), `lutN` for other small
  totalistic/generations rules, `denseTable` for a `stateTable` that fits under 4 MiB
  (WireWorld's 256 KiB table), and a monomorphic `closure` for everything else. Cached on
  ruleset identity (`compileRule.cache.clear()` for tests). 50,000-input equivalence against
  the forced-closure reference for every worked example and every catalogue notation. (P0-D-4)
- `src/engine/rules/builtin/**` — the 14-entry built-in catalogue: nine Life-like rules, Brian's
  Brain, WireWorld (table generated, byte-identical to the schema fixture), Star Wars,
  Bloomerang, and Highlands/Liquid. Each validates, compiles, carries tags for Phase 2's
  library, and has a published behavioural oracle. Highlands/Liquid thresholds were retuned
  (`0–6 / 7–14 / 15–24`) so a land/water wall is stable and a documented soup bands within 200
  generations; the schema worked example matches. (P0-D-5)
- `src/engine/simulation.ts` — the step function. Active chunks only; per-chunk back pages so
  neighbours still see last tick's cells; Conway-class `lut8` via a 34×34 halo into an 18-byte
  table; `ChangeSet` arrays reused across ticks. ADR-004 oracles: R-pentomino → 1103 / 116,
  acorn → 5206 / 633, glider (1,1) in 4 gens. ≥ 60 steps/sec on a 512×512 50% soup. (P0-E-1)
- Boundary modes honoured at the world extent, not only at chunk seams: a page that straddles a
  `bounded` wall or a `toroidal` wrap fills its halo through `normalize`, so a 24×24 wall inside
  a 32×32 page still kills a glider (Conway ashes: a 2×2 block on that wall, never on the far
  side). A glider on a 32×32 torus returns to its starting cells at generation 128. A 10,000-
  generation infinite glider lands at (2500, 2500) without a trailing-chunk tax — empty pages
  behind it are reclaimed, and late-run throughput stays within 20% of generation 100. (P0-E-2)
- `Simulation.paint` / `clear` / `seedRandom` / `setRuleset`. Paint returns a step-shaped
  `ChangeSet` (same reused arrays) and writes 100,000 cells in one call in under 20 ms.
  `seedRandom(0.5, seed)` is reproducible on a 1024×1024 field and lands within ±0.5% of
  target density. Switching Conway → Brian's Brain without a `StateMigration` throws a
  message that names both palettes; Conway → HighLife (same dead/alive palette) does not.
  (P0-E-3)
- `Simulation.snapshot` / `restore` is a transferable, canonical capture: sorted chunk keys,
  concatenated 1024-byte pages, tick, and unsigned RNG state. Round-trips through
  `structuredClone` and a real `postMessage` transfer (sender buffers detach). Restore loads
  pages in bulk (`Chunk.load`) rather than per-cell `set`. Property: for five rulesets,
  snapshot → restore → 100 steps matches a twin that never left. A 1M-live 1024×1024 island
  in a 4096×4096 world serialises in < 100 ms and is ≥ 90% smaller than the dense world.
  (P0-E-4)
- Hybrid history journal (ADR-007): keyframe every K ticks (default 64) plus a copied
  per-tick delta, chunk-RLE keyframes that stay raw when soup would expand, a hard byte
  ceiling (default 256 MB), and oldest-keyframe-first eviction that emits an event.
  `Simulation.seek(t)` replays from the nearest keyframe; 200 random seeks match a twin
  that never left. Seeking back 4,000 ticks with K = 64 is < 250 ms. A 1M-cell chaotic
  payload run for 10,000 ticks stays under a configured ceiling and reports evictions.
  `truncateAfter` drops discarded deltas (`bytes` falls). History is off unless opted in.
  Node unit tests run sequentially so the 512² soup floor isn't racing other files.
  (P0-F-1)
- `src/engine/stats/collector.ts` — `StatsCollector`: population, per-state counts, and
  per-tick births/deaths/transitions/activity folded from a `ChangeSet` in O(changes),
  never a grid scan (ADR-007: the delta stream already carries what the stat engine
  needs). `reset(view, tick)` is the one O(cells) pass a collector ever takes, seeding a
  baseline from the public `GridView` for anything that isn't itself a `ChangeSet`. Cross-
  checked against a full brute-force recount every checkpoint across 2,000 generations of
  Brian's Brain (three states, never settles) — exact match throughout. The <3% step-time
  budget is not yet provable in the unit suite: a JIT-prewarmed, median-of-7 measurement
  puts real overhead around 4-5%, and the tight, committed-baseline assertion this needs
  is deferred to P0-I-4's bench harness, matching P0-C-2's precedent for a bench-gated
  criterion this phase can't yet enforce precisely. A generous smoke ceiling guards
  against a gross regression until then. (P0-F-2 — `[!]` blocked on P0-I-4 for that one
  criterion)
- `src/shared/protocol.ts` — the main-thread ↔ worker wire protocol (ADR-006): the
  `Command`/`Event` unions, `PROTOCOL_VERSION`, and hand-written `parseCommand`/
  `parseEvent` runtime guards that narrow `unknown` to a typed message or a structured
  `ProtocolIssue`, never throwing. Every command carries a correlation `id`; `ready`/`ok`/
  `error` echo it back, `frame`/`stats` don't (a pushed stream, not a reply). Both guards'
  switches are exhaustive over their kind unions (`assertNever`/`assertNeverEvent`) — a
  new `Command` or `Event` variant without a case is a compile error, proven both by the
  guards themselves and by a mirrored switch in the test suite. Guards are deliberately
  shallow: a `ruleset` field is checked to be an object with the right keys, not a valid
  `RuleSet` — that's `rules/validate.ts`, an `engine/`-layer module `shared/` may not
  import (ADR-009); the worker handler (P0-G-2) runs that deeper check once a `Command`
  is already structurally accepted. (P0-G-1)
- **Refactor:** relocated the engine's type vocabulary from `src/engine/types.ts` to
  `src/shared/types.ts` — ADR-009 lets `engine/` import `shared/types`, but not the
  reverse, and the protocol above needs `RuleSet`/`PaintOp`/`Rect`/`ChangeSet`/`TickStats`
  (the last folded in from `simulation.ts`). `src/engine/types.ts` is now a re-export
  barrel, so every existing `@engine/types` import keeps working unchanged; no behaviour
  change. Also added `StatSample`, pinned to Phase 2 §2.2's exact shape now so the wire
  type never has to change under P2-C-1/C-2, only get populated.
- `src/worker/handler.ts` — the transport-agnostic worker handler: `createHandler({ post,
  scheduler, capabilities, clock? })` returns `{ handle(raw) }`. Nothing here touches a
  worker global, `self`, or a real timer — `post` is the only way it emits, and `run`'s
  free-run scheduling goes through an injected `Scheduler` (`REAL_SCHEDULER`, a thin
  `setInterval`/`clearInterval` wrapper, is exported for `sim.worker.ts` to opt into; this
  module never uses it itself), which is what lets a test drive it with an in-memory port
  and virtual time — no `Worker`, no jsdom, no real waiting. Every mutating command posts a
  correlated `{id,type:'ok'}` reply plus a separate, id-less `frame` broadcast (`step`/
  `paint` build it incrementally from the returned `ChangeSet`; `clear`/`seedRandom`/`seek`
  don't return one, so those post an honest full-world frame via `snapshot()` instead of an
  invented partial dirty-rect list). `init` deep-validates the ruleset via `rules/validate.ts`
  (an `engine/`-layer import `shared/` can't make — exactly why P0-G-1 needed the type move).
  `loadPattern` (Phase 2's RLE codec) and a cross-palette `setRuleset` (no `migrate` on the
  wire) reject with a structured error rather than pretending to work; so does `seek` without
  `history` enabled (not itself a wire option yet — Phase 4's to add). Every thrown error,
  including a misbehaving `Scheduler` throwing a non-Error, becomes `{id,type:'error'}`
  rather than an uncaught exception, including after `dispose` or a stale timer callback
  racing a just-cleared interval. (P0-G-2)
- **ADR-006 amendment:** added a `restore` command (`{ id, cmd: 'restore', snapshot: Snapshot }`)
  — the protocol had `snapshot` (worker → main, a read) but no way to push one back *into* a
  worker, which blocks recovering a killed-and-restarted worker from cached state. `restore`
  is `Simulation.restore()`'s wire equivalent, replying `ok` then a full-world `frame`, the
  same shape `clear`/`seedRandom`/`seek` already use. Required touching the already-closed
  P0-G-1 (`protocol.ts`'s `Command` union and exhaustive guard) and P0-G-2 (`handler.ts`'s
  dispatch) — both exhaustiveness switches caught every call site that needed a case, nothing
  else about either task changed. (P0-G-3)
- `src/worker/sim.worker.ts` and `src/worker/client.ts` — the real worker entry point and the
  main-thread `WorkerClient`. `sim.worker.ts`'s `bootstrap(scope, capabilities?)` wires a
  `DedicatedWorkerScope`-shaped object to `createHandler` + `REAL_SCHEDULER`; `detectCapabilities()`
  is the one place that touches `SharedArrayBuffer`/`OffscreenCanvas` (real worker wiring is two
  guarded lines at the bottom — everything else is exported and directly testable, no `Worker`
  needed). `WorkerClient` wraps anything `Worker`-shaped (`WorkerLike` — real or an in-memory
  double) and gives promise-based RPC (`send`, correlation ids assigned automatically) plus a
  coalescing `onFrame` subscription: only the latest frame is ever retained, delivered on an
  injected `FrameScheduler`'s cadence (`RAF_FRAME_SCHEDULER` by default) rather than a microtask
  — a real `postMessage` delivers every frame as its own task, so a microtask-deferred delivery
  still fires once per message, not once per burst (a test with 50 separate frame arrivals
  caught this: 50 deliveries, not 1, until delivery moved to the render loop's actual cadence).
  If the worker dies (`onerror`), the client rejects in-flight requests, spawns a replacement,
  re-`init`s from cached params, and `restore`s the last cached snapshot — no page reload.
  Buffer transfer is verified through a real `structuredClone(…, { transfer })` in the test
  double (the same detach semantics `postMessage` has), which caught a real bug along the way:
  `handler.ts`'s `postFrame` was only transferring `chunks.data.buffer`, copying
  `chunks.keys.buffer` instead of transferring it — fixed. The two-buffer ping-pong (worker-side
  buffer reuse) is deferred to Phase 5's `SharedArrayBuffer` upgrade: neither acceptance
  criterion requires it, and doing it properly means changing `handler.ts`'s allocator, not
  just adding a message. (P0-G-3)
- `src/render/types.ts` and `src/render/dirty.ts` — the renderer contract (ADR-005:
  `Viewport`/`RenderFrame`/`RenderStats`/`Renderer`) and a dirty-rect merge utility. `types.ts`
  imports `GridView`/`Rect`/`StateId` from `shared/types`, never `engine/` (`render/` may not,
  per ADR-009) — `worker/handler.ts` is what already turns a `ChangeSet` into world `Rect`s.
  `CompiledTheme`/`CellPalette` are a deliberately minimal slice of ADR-008's full `ThemeModule`,
  just enough to paint cells without a hardcoded grey; Phase 3 extends it. `dirty.ts` merges
  overlapping and edge-adjacent rects into an exact, disjoint covering set (coordinate
  compression, a row-run merge, then a vertical merge of matching runs) — proven by rasterising
  10,000 random inputs onto a grid and comparing exactly against the un-merged input. Gives up
  and signals a full repaint (`null`) once the union would exceed ~60% of the viewport or there
  are simply too many rects (a 4,096 hard cap), checked *before* the O(rects²)-ish merge runs,
  not partway through it. `DirtyAccumulator` batches across ticks, since `WorkerClient`'s own
  frame coalescing (P0-G-3) can skip several ticks' `frame` events — a render loop needs the
  union of everything skipped, not just the latest frame's own dirty list. (P0-H-1)
- **`CHUNK_BITS`/`CHUNK_SIZE`/`CHUNK_AREA`/`chunkToWorld`/`localIndex` also live in
  `shared/types.ts`** now, independently defined rather than re-exported from
  `engine/grid/coords.ts` — `render/` (P0-H-2) needs them to walk a `GridView`'s chunks and may
  only import `shared/`, never `engine/` (ADR-009). The re-export approach measurably regressed
  the engine: routing `Simulation`'s hot loop through the extra module hop cost a real,
  reproducible ~25% drop on the 512² soup floor test (P0-E-1), confirmed by toggling only that
  indirection across 8+ interleaved runs. `engine/grid/coords.ts`'s own code is unchanged from
  before this refactor. (P0-H-2's prerequisite)
- `src/render/canvas2d.ts` — the Canvas2D renderer (ADR-005). Clips to each dirty rect (or the
  whole visible viewport on a `null` full repaint), intersects it with what's actually visible,
  then walks only the chunks it touches. Batches same-state cells into per-row runs so `fillRect`
  is called once per state present, not once per cell — proven exactly: repainting a single
  changed cell costs exactly 2 draw calls (one background fill, one run), a 5-cell run also 2,
  and two different states 3, never something proportional to a chunk's 1,024 cells. Below
  `cellSize` 4 device px, switches to a pre-rasterised `ImageData` tile (one `putImageData`, a
  hand-written CSS-colour parser resolving each theme colour to RGBA once and caching it)
  instead of thousands of sub-pixel `fillRect`s. `resize()` handles `devicePixelRatio` by setting
  the canvas's actual device-pixel backing-store size directly and, for a real
  `HTMLCanvasElement`, the CSS display size separately, so nothing renders blurry. `setTheme`/
  `setViewport` are required before `draw()` — no fallback theme, no hardcoded grey. Tested
  against a hand-written, functionally real 2D-context double (`fillRect`/`putImageData` write
  into an actual RGBA buffer, not just a call log) driving a real `Simulation`/`GridView`. The
  frame-time budget and the dpr pixel-identity criteria aren't provable here — `jsdom` has no
  real canvas rasteriser and no bloat forbids adding one — and are deferred to the real bench
  harness (P0-I-4) and Phase 1's E2E suite respectively; recorded as `[!]` blocked rather than
  silently marked done. (P0-H-2)

[Unreleased]: https://github.com/ZJGordon/fancy-gol/compare/main...HEAD
