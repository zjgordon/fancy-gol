# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Phase 1 — Interaction (*Make it usable.*), in progress.

### Added

- `Camera` (`src/ui/camera.ts`): the world/screen transform for Phase 1's interaction layer
  (§2.3). Fractional `cellSize` clamped to `[0.02, 128]` (ADR-005's density-LOD floor),
  `screenToWorld`/`worldToScreen`, cursor-anchored `zoomAt`, `panBy`, and `fitTo` for framing a
  pattern's bounding box with padding. Exposes a `dirty` flag so the render loop repaints only
  when the transform actually changed. `animateTo` from the full §2.3 contract landed later, in
  P1-D-1, once the cold-start choreography gave it a genuine fixed-target transition to drive.
  (P1-A-1)
- `attachGestures` (`src/ui/input/gestures.ts`): wheel-zoom-at-cursor, Shift+wheel and trackpad
  two-finger pan, pinch-zoom (via Pointer Events, not `TouchEvent`), middle-drag/Space-drag pan,
  and an inertial coast on release — exponential friction, hard-capped at 800 ms, cancelled by
  any new input. Respects `prefers-reduced-motion` by skipping the coast entirely. `Clock`,
  `FrameScheduler`, and the reduced-motion query are all injected, so the physics are
  deterministic under test. (P1-A-2)
- `GridLinesOverlay` (`src/ui/overlay/grid-lines.ts`): world-space grid lines that fade in
  smoothly (not a hard toggle) once `cellSize` reaches 6, a stronger line every 10 cells, a
  labelled origin cross, and a "you are here" badge that appears on any pan/zoom and fades out
  600ms after the camera stops changing. The fade shape is an injectable `FadeCurve`, not a
  literal — a hand-written `SMOOTHSTEP` stands in for a real theme token until P1-E-1 exists.
  Colours are a required `{r,g,b}` palette; no hardcoded grey fallback. (P1-A-3)
- `attachInputRouter` (`src/ui/input/router.ts`): the Pointer-Events-only entry point for tool
  strokes — owns pointer capture, forwards every `getCoalescedEvents()` sub-sample from a fast
  drag (not just the event's final position), and converts every point to world coordinates via
  a `Camera`. A native `lostpointercapture` (alt-tab mid-drag) is treated exactly like a cancel,
  so no partial edit can ever reach a consumer from a drag that never properly ended. Pen
  pressure is carried on every point, unconsumed until P1-B-3. (P1-B-1)
- `Tool` interface and `ToolRegistry` (`src/ui/tools/tool.ts`, `src/ui/tools/registry.ts`):
  tools produce `PaintOp[]` data only — `onCancel` has no return channel at all, so a cancelled
  gesture cannot commit even by accident. The registry owns which tool is active, relays
  `router.ts`'s `ToolEvent`s to it, and cancels the active tool on Escape. Adding a tool is one
  new file plus one `register()` call; `onCommit` is the seam P1-C-1's `CommandBus` plugs into
  once it exists. (P1-B-2)
- `Brush` and `Eraser` (`src/ui/tools/brush.ts`, `src/ui/tools/eraser.ts`): size 1–64, three
  footprint shapes (square/circle/diamond), spray density via a seeded PRNG, Bresenham
  interpolation between move samples so a fast drag never dots, and six symmetry modes
  (none/mirror-x/mirror-y/quad/rotate-4/rotate-8) sharing one per-stroke dedup mechanism that
  also keeps overlapping stamps from bloating the op count. Paints any `StateId` by property
  assignment — multi-state rules need no dedicated UI to reach state 2+. `Eraser` is a thin
  `Brush` wrapper forced to `DEAD`, exposing no way to paint anything else. (P1-B-3)
- `LineTool`, `RectTool`, `EllipseTool`, `FillTool` (`src/ui/tools/{line,rect,ellipse,fill}.ts`):
  Shift constrains a line to 45°/a rectangle to a square/an ellipse to a circle; Alt draws from
  centre; rect/ellipse offer filled or outline-only. `EllipseTool` uses the classic midpoint
  ellipse algorithm (one quadrant, mirrored). `FillTool` is a scanline flood fill capped both by
  cell count (default 1,000,000) and by wall-clock time, so the 500ms budget holds regardless of
  machine speed, not just in a fast environment; `ToolContext` gained an optional `grid?:
  GridView` for it — the extension point P1-B-2 left open, used for the first time here.
  (P1-B-4)
- `SelectTool` and `SelectionOverlay` (`src/ui/tools/select.ts`, `src/ui/overlay/selection.ts`):
  marquee select, copy/cut/paste/delete/move, rotate 90°/flip H/V on the clipboard buffer, and a
  minimal hand-written RLE codec so a selection round-trips through the system clipboard.
  Copy/cut/paste/rotate/flip are plain methods for a future keybinding layer to call, not pointer
  gestures. The selection outline's marching-ants animation is driven by an injectable duration
  and stops entirely under `prefers-reduced-motion`. (P1-B-5)
- `StampTool` (`src/ui/tools/stamp.ts`): a data-driven stamp library — glider, LWSS, blinker,
  toad, beacon, pulsar, R-pentomino, acorn, Gosper glider gun, block — as plain RLE text, not
  code, with a swappable `library` constructor option Phase 2 will use for the full catalogue.
  Every pattern's cell coordinates were checked against a real `Simulation` before being bundled
  (correct oscillator period, correct spaceship translation, and — for the Gosper gun — genuine
  glider emission) rather than trusted from memory. Placement is sparse (only a stamp's own live
  cells become ops, unlike paste's dense selection-bounding-box overwrite); Shift-click keeps the
  same stamp selected for repeated placement. (P1-B-6)
- `CommandRegistry`, `CommandBus`, and `createAppContext` (`src/ui/commands/{registry,bus}.ts`,
  `src/client/app-context.ts`): every user-triggerable action is a registered `AppCommand` —
  registration throws loudly on a duplicate id or on neither a `defaultBinding` nor an explicit
  `noBinding: true`. `bus.run()` resolves `isEnabled` first; a disabled command is a no-op with a
  debug-level log, never a throw. `createAppContext()` wires up all eight Phase 1 tools and
  registers their `tool.select.<id>` commands with the exact default bindings (`B`/`E`/`L`/`U`/
  `O`/`G`/`S`/`M`) P1-C-2's table already names. `AppContext` is declared in `registry.ts`, not
  `app-context.ts` — `ui/` cannot import `client/` (ADR-009). (P1-C-1)
- `Keymap` and the Phase 1 default-bindings table (`src/ui/input/keymap.ts`,
  `src/ui/input/bindings.ts`): `Mod` normalises to `Cmd`/`Ctrl` per platform; chords (`g g`) with
  a 1s timeout, injected timers for deterministic testing; bindings never fire while focus is in
  a text input or `contentEditable` element; a duplicate (or canonicalisation-collision) binding
  throws at registration. `PHASE_1_BINDINGS` lists every table entry as data even though most of
  their commands (`sim.*`, `view.*`, `edit.*`, …) don't exist yet — `attachDefaultBindings` skips
  what isn't registered, so each lands live the moment its command does, no file change needed.
  `Shift+/` and `?` are the same physical key and were merged into one binding rather than left
  to collide. Fixed a real parsing bug caught by the table's own tests: a bare `+` (zoom in) was
  misparsed as an empty modifier, since `+` is also the modifier-separator character. (P1-C-2)
- `EditStack` and `editFromChangeSet` (`src/ui/commands/edit-stack.ts`): records each committed
  edit as a `{forward, inverse}` `PaintOp[]` pair; `undo()`/`redo()` only ever return ops to
  apply, never touching a grid themselves. Depth-capped (default 200) and byte-capped, both
  configurable. A new edit always invalidates pending redo. `editFromChangeSet` unpacks a real
  `ChangeSet` using the exact packing `engine/grid/coords.ts` implements (a hand-written
  duplicate — `ui/` cannot reach `engine/`), copying eagerly since the engine reuses a
  `ChangeSet`'s typed arrays on the next `paint()`/`step()`. Explicitly separate from the Phase 4
  time machine by construction: neither this stack nor `Simulation.paint()` ever touches `tick`.
  (P1-C-3)
- Layout shell and cold-start choreography (`src/ui/components/shell.ts`, `src/client/index.html`
  — rewritten, `src/client/main.ts` — rewritten as the real composition root): full-bleed canvas
  with floating translucent chrome (toolbar left, transport bottom-centre, status bar
  bottom-right, panel dock right), `backdrop-filter` with a solid `@supports not` fallback,
  `Tab`-dismissible with a 150ms transition that never touches canvas size. On boot the app opens
  already running on the curated Gosper-gun world, the camera animating from a wide shot to a
  framed view (`Camera.animateTo`, ~1.2s, `EASE_OUT_CUBIC`) while chrome fades in staggered ~40ms
  per region — skipped entirely under `prefers-reduced-motion`, and cancelled instantly (jumping
  straight to the end state) by any real pointer/keyboard/wheel input, so the intro never delays
  interactivity. `main.ts` also closes three seams earlier tasks left open for "whichever task
  first assembles the full client": `createAppContext`'s `onPaint` now reaches a real
  `WorkerClient.paint()`; `attachGestures` and `attachInputRouter` are composed on the same
  canvas, gated so a Space+drag pans instead of also starting a paint stroke (`GestureController`
  gained a `spaceHeld` getter for this); and the Phase 1 tool-select keybindings are wired to a
  real `CommandBus`. Interim design tokens (`--gol-*` custom properties) live in `index.html`
  pending P1-E-1's real token contract in `src/themes/` — every consumer rule reads a token, none
  holds a literal colour, proven by a static source check standing in for P1-E-1's eventual lint
  rule. `EditStack`/undo-redo and the fill tool's live-grid read stay deliberately unwired — both
  already recorded as follow-ups in their owning modules' doc comments, and out of this task's
  scope. (P1-D-1)
- Transport bar and speed control (`src/ui/components/transport.ts`, `src/ui/components/speed.ts`):
  play/pause, single step (disabled while running), reset, clear, random soup, and a visible but
  disabled step-back button ("Coming in Phase 4" — never a silent gap). Every button is a
  registered `sim.*` `AppCommand` (`src/ui/commands/builtin/sim.ts`, new — the first task to use
  the `ui/commands/builtin/*.ts` path Phase 1's own architecture doc already anticipated), which
  is what gives all seven `sim.*` keybindings (`Space`/`.`/`[`/`]`/`R`/`C`/`N`) a live keyboard
  equivalent for free — they were already sitting unregistered in `bindings.ts`'s table since
  P1-C-2. Speed is a logarithmic slider from 0.5–1000 TPS plus an "unbounded" toggle that runs as
  fast as the scheduler allows; the readout always shows target *and* actual TPS from independent
  sources, so a rate the machine can't keep up with reads honestly (e.g. "target 1000 / actual
  340") instead of silently reporting the target. `TpsMeter` measures actual TPS from delivered
  tick deltas over wall-clock time, immune to `WorkerClient`'s `requestAnimationFrame` coalescing.
  `AppContext` gained an optional `sim: SimControl` field — optional so `createAppContext()`'s
  existing tools-only construction needed no change at all; a `requireSim` guard turns a command
  run without one into a thrown error, never a silent no-op. `shared/protocol.ts`'s `run.tps` now
  accepts `+Infinity` (a real, structured-clone-safe value, not a sentinel string) for "unbounded"
  — `worker/handler.ts` needed no other change, since `1000 / Infinity === 0` already schedules at
  the shortest interval the platform allows. (P1-D-2)

## [0.1.0] — 2026-09-04

Phase 0 — Foundation (*Make it correct.*). Workstreams **A–I**: toolchain (A), core types /
RNG / clock / coordinates (B), chunked grid (C), ruleset schema · validator · parsers ·
compiler · catalogue (D), simulation (E), history and statistics (F), worker protocol (G),
renderer and canvas bridge (H), client shell · Express · Docker · CI · this documentation (I).

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
  frame-time budget is gated by P0-I-4 as labelled CPU/recorder time. The dpr 1-vs-2
  pixel-identity criterion is a Playwright visual, not a jsdom claim: relocated to P1-H-2
  (2026-09-03) so Phase 0 can close without silently ticking it or pulling E2E into
  Foundation. `resize()` backing-store vs CSS size stays unit-tested here. (P0-H-2)
- `src/render/recorder.ts` — `CanvasRecorder`, a `CanvasRenderingContext2D`-shaped double that
  logs every `fillStyle`/`fillRect`/`createImageData`/`putImageData` call while painting into a
  real `Uint8ClampedArray` backing buffer, so a test can assert on both the call log and actual
  pixels. `src/worker/frame-view.ts` — `FrameGridMirror`, the adapter `WorkerClient.onFrame`'s
  per-tick `TransferredChunks` needed but didn't have: a persistent client-side mirror of every
  chunk page seen so far, merged frame-by-frame and exposed as the full-world `GridView` the
  renderer expects, reusing a single `ChunkView`/`GridView` object rather than allocating either
  per call. Together with a Gosper gun driven through the real worker → client → renderer
  pipeline in Node, this is INCEPTION.md's "headless rendering test to ensure the engine can push
  state to a canvas buffer without overhead" — `tests/integration/canvas-bridge.spec.ts` — proving
  a stable, snapshot-tested draw-call log (~4,274 calls over 100 generations), dirty-rect
  locality (a lone blinker's draw calls stay inside its one chunk, not the full viewport), and
  zero allocations attributable to `Canvas2DRenderer.draw()` itself once isolated from the test
  harness's own logging overhead. (P0-H-3)
- `src/client/index.html`/`src/client/main.ts` — the first real, in-browser client: a
  full-viewport canvas, a HUD readout (tick/population/fps/step-ms/render-ms), and play/pause and
  reset buttons, wired to a real `Worker` running a 256×192 toroidal Conway world seeded with a
  Gosper glider gun, running the moment the page loads. No custom render loop: subscribing to
  `WorkerClient.onFrame` *is* "a rAF loop that draws only when a new frame has arrived," since
  frame coalescing already defers to `requestAnimationFrame` internally — while paused, the worker
  emits no `frame` events, so the client never even requests one, making idle CPU exactly zero by
  construction. Verified in a real Chromium instance (Playwright) against the Vite dev server —
  Phase 1 hasn't wired up `npm run e2e` yet — since this task's acceptance criteria are about real
  browser behaviour a headless test can't stand in for. (P0-I-1)
- `src/server/app.ts`/`src/server/index.ts` — the Express server skeleton (ADR-002). `createApp()`
  serves the built client with correct cache headers (Vite's hashed `assets/` files get
  `immutable`, `index.html` always `no-store`), implements `GET /api/health` (`{ ok, version,
  uptime }`), and 404s unknown `/api/*` paths as JSON rather than falling through to the SPA
  shell's HTML — including when `index.html` itself is missing (a broken/incomplete build degrades
  to a clean 404 instead of an unhandled error). `installGracefulShutdown()` closes the listener on
  `SIGTERM`, force-exiting after a timeout if a stuck connection never lets `close()` finish; the
  policy is unit-tested with fakes (including the timeout path, via fake timers), and the literal
  "closes within 5s" acceptance criterion is separately proved against a real spawned process sent
  a real `SIGTERM`. No API routes yet — Phase 1 owns those. (P0-I-2)
- `docker/Dockerfile`, `docker/Dockerfile.dev`, `docker/docker-compose{,.dev}.yml`, `.dockerignore`
  — a three-stage production image (`deps` → `build` → `runtime` on `node:22-alpine`, non-root,
  `--omit=dev` in the runtime stage, a dependency-free `HEALTHCHECK` against `/api/health` using
  Node's own `fetch`) and a dev image running `npm run dev` against a bind-mounted source tree.
  Required a compiled server, which didn't exist yet: added `tsconfig.server.json` and a
  `build:server` script (folded into `build`, so `npm run verify` now also catches a broken server
  compile), and a `start` script. `vite.config.ts`'s dev server binds all interfaces (`host: true`)
  and allows every `Host` header (`allowedHosts: true`) so Vite 8 does not 403 the published port
  when reached by hostname rather than `localhost`. Compose files set explicit project names and
  image tags (`fancy-gol:latest` / `fancy-gol:dev`) so building one does not overwrite the other.
  **Revalidated 2026-09-03 against a working Docker daemon:** `docker compose -f docker/docker-compose.yml
  up` serves the Gosper gun on `:8080`; production image 241 MB (`docker images`), runs as
  `uid=1000(node)`, reports `healthy`. **Bind-mount HMR closed the same day** after the sandbox
  remounted the agent worktree into dind at `/workspace`: `docker compose -f docker/docker-compose.dev.yml
  up --build` serves Vite on `:5173`; editing `src/client/index.html` on the agent produced Vite
  `page reload index.html` and Playwright at `http://sandbox-dind:5173/` showed the new HUD
  label with no image rebuild. Published ports still listen on the dind host, not this shell's
  `127.0.0.1`. (P0-I-3)
- `scripts/bench.mjs` — hand-written performance gate (warmup, median of 7, ASCII table).
  Compares to committed `bench-baseline.json`, fails on a missed Phase 0 budget or a >10%
  regression, `--update-baseline` records a new one (refuses to write a failing run),
  `--inject-slowdown 1.3` proves the 30% slowdown AC. Cases cover Conway 512² soup
  (250 steps/sec), 4096² @1% (440 steps/sec), 1M-cell paint, 1M live cells over 4096²
  (32.00 MB of sparse pages, closing P0-C-2), snapshot/restore, seek-4000, stats overhead
  (well under 3%, closing P0-F-2), 1080p CPU frame time via `CanvasRecorder` (~12 ms,
  labelled, closing P0-H-2's frame-time criterion), Gosper-gun dirty-rect main-thread
  block, client JS gzip (22 kB), and the recorded cold-load figure from P0-I-1/P0-I-3.
  The unit-suite 512² ≥60 assert is now a ≥20 smoke; the real floor lives here. (P0-I-4)
- `.github/workflows/ci.yml` — the CI pipeline, four jobs on every push to `main` and every PR:
  `verify` (typecheck, lint, boundaries, `vitest run --coverage`, then a dashboard-staleness
  check) and `build` each run on a Node LTS matrix (current `22`, previous `20`, matching
  `.nvmrc` and the `engines` floor); `bench` runs `npm run bench` against the committed
  `bench-baseline.json` on Node 22; `docker` builds `docker/Dockerfile`'s production image,
  runs it, polls `docker inspect`'s health status to `healthy`, and probes `/api/health`
  directly, always dumping container logs and tearing the container down afterwards. Coverage
  and the bench baseline are uploaded as artifacts. The three failure-mode acceptance criteria
  (coverage regression, boundary violation, bench regression) all rest on gates already proven
  in-repo by P0-A-5's and P0-I-4's own fixtures — CI only wires them in. The `docker` job's
  build-run-healthcheck sequence was hand-verified end-to-end against this sandbox's remote
  dind daemon before being committed. (P0-I-5)
- Foundational docs: a short root `README.md` (inception premise, `npm ci && npm run dev`,
  honest Phase 0 status), `docs/ARCHITECTURE.md` (data-flow diagram and every ADR), an expanded
  `CONTRIBUTING.md` that points at `.agents/dashboard.html` and the agent contract, and a
  dated `[0.1.0]` changelog, and `docs/demo/phase-0.gif` of the running gun. The ruleset field
  guide remains `docs/ruleset-schema.md` (P0-D-1). (P0-I-6)

### Changed

- P0-H-2's leftover dpr 1-vs-2 pixel-identity criterion is cut from Phase 0 and owned by
  P1-H-2 (Playwright `deviceScaleFactor`, HUD masked). The Phase 0 task is closed: frame
  time, draw-call bounds, and `resize()` CSS-vs-backing-store maths stay here; the visual
  claim was never a jsdom test. (P0-H-2 → P1-H-2)

### Fixed

- `WorkerClient`'s frame-coalescing (`src/worker/client.ts`) assumed a `FrameScheduler.request()`
  callback always fires asynchronously, as real `requestAnimationFrame` does — but nothing
  enforced that on an injected scheduler, and a synchronous callback silently dropped nearly every
  frame after the first by racing its own bookkeeping. Found via P0-H-3's canvas-bridge pipeline
  test (a 100-generation snapshot had only 32 entries instead of thousands); hardened with a
  `frameDeliveryPending` flag set before `request()` is even called, so delivery is now correct
  regardless of scheduler synchronicity. The same latent assumption was fixed in the test
  helpers of both `tests/integration/worker-client.spec.ts` and the new canvas-bridge suite.
- `Canvas2DRenderer.init()` (`src/render/canvas2d.ts`) threw synchronously on a `null`
  `getContext('2d')` result instead of rejecting its returned `Promise`, breaking its documented
  async contract. (P0-H-3)
- `TickStats.stepMicros` was silently always `0`: `worker/handler.ts`'s injected-clock contract
  (P0-B-3) was never actually supplied by `sim.worker.ts`, whose own job is exactly this kind of
  environment wiring (the same pattern as its `REAL_SCHEDULER`/`detectCapabilities()`). Found by
  running the client shell in a real browser and watching the "step" readout stay pinned at
  `0.00 ms`. Added `REAL_CLOCK` (`performance.now()`, converted ms → µs) and wired it into
  `bootstrap()`. (P0-I-1)
- Clicking the client shell's Reset button correctly cleared the simulation and the client's
  chunk mirror, but left the previous frame's gliders visibly painted on the canvas: `clear`'s
  `postFullFrame` reports `dirty: []`, not `dirty: null`, for a now-fully-empty world (there's
  nothing to *describe* as changed), so the renderer correctly issued zero draw calls and never
  erased the stale pixels — the renderer-facing half of `FrameGridMirror`'s already-documented
  known limitation (P0-H-3). Fixed locally: the reset handler now forces one full `draw()` right
  after resetting the mirror, before repainting the gun. (P0-I-1)

[Unreleased]: https://github.com/ZJGordon/fancy-gol/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ZJGordon/fancy-gol/releases/tag/v0.1.0
