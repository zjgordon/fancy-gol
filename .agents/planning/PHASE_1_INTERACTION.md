# Phase 1 — Interaction & Visuals

> *"Delightful UX: smooth animations, keyboard shortcuts, snappy interactions."*
> *"Controls where a child could pick up the basics, but a serious researcher would also have everything at their fingertips."*

| | |
|---|---|
| **Status** | ☐ Not started |
| **Ships version** | `0.2.0` |
| **Prerequisites** | Phase 0 complete and tagged `v0.1.0`. |
| **Theme of the phase** | **Make it usable.** |
| **The demo that proves it** | Open the app, draw a glider with the mouse, scroll to zoom out to a 4096² world, drag to pan, press `Space` to run it, `[` / `]` to change speed, pick HighLife from the ruleset menu — all at 60 fps, all with a keyboard equivalent, and reload the page to find your work still there. |

---

## 1. Objectives

1. **The interaction loop** — click-to-paint, drag-to-draw, shape tools, stamping, selection, pan, zoom. It must feel *instant*: the cell lights up under the cursor before the worker has confirmed anything.
2. **The camera** — a proper world/screen transform with fractional zoom, inertial pan, zoom-to-cursor, and fit-to-content.
3. **The core HUD** — transport controls, speed, generation, population, coordinates, ruleset selection. Legible to a child; complete for a researcher.
4. **The Default theme and the design-token system** — the grey, compatible, high-performance baseline described in the inception document, built on the token architecture that Phase 3's six themes will extend (ADR-008).
5. **The keybinding registry** — every action registered as a command with a shortcut, from day one. Phase 4's command palette is then a *view* over an existing registry rather than a retrofit.
6. **Edit undo/redo** — a command stack, distinct from Phase 4's time travel.
7. **Persistence & sharing** — autosave to `localStorage`, and a URL that restores a full session.
8. **Server API v1 and the `/live` broadcast** (ADR-002).
9. **Playwright E2E** established as a standing gate.

### Explicitly *not* in Phase 1
No pattern catalogue (Phase 2), no statistics graphs (Phase 2), no themes beyond Default (Phase 3), no command palette or timeline UI (Phase 4), no WebGL (Phase 5).

---

## 2. Architecture introduced in this phase

### 2.1 Layered input pipeline

Raw pointer events must never reach a tool directly. The pipeline exists so that Phase 4's command palette, Phase 3's motion system, and touch support all attach at defined seams.

```
PointerEvent / KeyboardEvent / WheelEvent
        │
        ▼
  InputRouter          normalises pointer/touch/pen, tracks modifiers,
        │              owns capture, converts to world coords via Camera
        ▼
  ToolContext ────────▶ ActiveTool.onDown / onMove / onUp / onCancel
        │                   │
        │                   ▼
        │              PaintOp[]  (pure data — the tool never touches the grid)
        ▼                   │
  CommandBus ◀──────────────┘        every mutation is a Command
        │                            (undoable, replayable, palette-addressable)
        ├──▶ EditStack               undo / redo
        ├──▶ OptimisticOverlay       instant local echo, reconciled on worker frame
        └──▶ WorkerClient.paint()
```

### 2.2 The command registry — built once, used by four phases

```ts
export interface AppCommand<A = void> {
  readonly id: string;                       // 'sim.toggleRun', 'tool.select.brush'
  readonly title: string;                    // "Play / Pause"
  readonly category: 'Simulation' | 'Tools' | 'View' | 'Edit' | 'Ruleset' | 'Theme' | 'Help';
  readonly keywords?: readonly string[];     // fuzzy-search aliases (Phase 4)
  readonly defaultBinding?: KeyBinding;      // 'Space', 'Mod+Z', 'g g'
  readonly icon?: string;
  isEnabled?(ctx: AppContext): boolean;
  isActive?(ctx: AppContext): boolean;       // for toggles
  run(ctx: AppContext, arg: A): void | Promise<void>;
  readonly undoable?: boolean;
}
```

**Rule for the whole project from here on: if a user can do it, it is a registered command.** A button's `onclick` is `bus.run('sim.toggleRun')` and nothing else. This single discipline is what makes Phase 4's "Hot-Key Mastery" a two-day task instead of a two-week one.

### 2.3 Camera

```ts
export interface Camera {
  originX: number; originY: number;   // world coords at viewport top-left (fractional)
  cellSize: number;                   // CSS px per cell, fractional, clamped [0.02, 128]
  screenToWorld(px: number, py: number): { x: number; y: number };
  worldToScreen(x: number, y: number): { px: number; py: number };
  zoomAt(px: number, py: number, factor: number): void;   // zoom about cursor
  panBy(dxPx: number, dyPx: number): void;
  fitTo(rect: Rect, paddingPx?: number): void;
  animateTo(target: Partial<Camera>, ms: number, easing: Easing): void;
}
```

Zoom is **geometric** (`factor = 1.1` per wheel notch, keyboard steps snap to powers of two) and always anchored at the cursor. Panning has light inertia with a documented friction constant — this is a large part of whether the app feels professional or cheap.

### 2.4 Optimistic painting

The worker round-trip is ~1–16 ms. That is visible. The client keeps an `OptimisticOverlay` — a small `Map<packedCell, StateId>` of locally-applied edits that the renderer composites *over* the authoritative grid view, cleared per cell when a worker frame at or after the edit's tick confirms it. Painting must never wait for a network or thread hop.

### 2.5 Design tokens (the foundation for ADR-008)

```
src/themes/
├── types.ts            TokenSet, CellPalette, MotionSignature, ThemeModule
├── registry.ts         register / activate / list, CSS custom-property application
├── tokens.css          the token *contract*: every --gol-* variable, documented, with fallbacks
└── default/
    ├── tokens.ts       the Default (grey, compatible) values
    ├── theme.ts        ThemeModule with no render hooks — the honest baseline
    └── default.css     chrome styling that reads only from tokens
```

**No component may contain a literal colour, font, radius, shadow, or duration.** Enforced by a lint rule added in P1-E-1. Phase 3 then only has to supply new token values and hooks.

### 2.6 New/changed files

```
src/
├── client/
│   ├── main.ts                 (rewritten) app bootstrap & composition root
│   ├── store.ts                tiny observable app state (~80 lines, hand-written)
│   ├── session.ts              autosave, URL hash encode/decode
│   └── app-context.ts          AppContext handed to every command
├── ui/
│   ├── input/                  router.ts, gestures.ts, keymap.ts, bindings.ts
│   ├── commands/               registry.ts, bus.ts, edit-stack.ts, builtin/*.ts
│   ├── camera.ts
│   ├── tools/                  brush, eraser, line, rect, ellipse, fill, stamp, select, pan, pick
│   ├── overlay/                optimistic.ts, cursor.ts, grid-lines.ts, selection.ts
│   └── components/             hud.ts, toolbar.ts, speed.ts, ruleset-picker.ts,
│                               statusbar.ts, toast.ts, dialog.ts, tooltip.ts
├── themes/                     (as above)
└── server/routes/              rulesets.ts, patterns.ts, sessions.ts, live.ts
tests/e2e/                      playwright specs + fixtures
```

---

## 3. Workstreams & tasks

---

### Workstream A — Camera & viewport

#### - [x] P1-A-1 · Camera transform
**Depends on:** Phase 0 · **Files:** `src/ui/camera.ts`
**Implementation notes** Fractional `cellSize` throughout — snapping to integers makes zoom feel notchy. Clamp to `[0.02, 128]`; below 1 the renderer's tile/LOD paths take over (ADR-005). Track a `dirty` flag so the render loop knows when a full repaint is required.
**Acceptance criteria**
- [x] Property test: `screenToWorld(worldToScreen(p))` round-trips within 1e-9 across 10k random cameras.
- [x] `zoomAt` keeps the world point under the cursor fixed to sub-pixel accuracy across 100 successive zooms.
- [x] `fitTo` frames a pattern's bounding box with the requested padding, for both wide and tall aspect ratios.
**Note** `animateTo` from §2.3's full `Camera` contract is intentionally deferred until a task
adds a genuine fixed-target eased transition — P1-A-2's inertia is a continuous friction
simulation via `panBy`, not a tween, so it doesn't need it either. See the module doc in
`src/ui/camera.ts`.

#### - [x] P1-A-2 · Pan, zoom, and inertia — pinch-zoom E2E criterion relocated to P1-H-1 on 2026-09-04
**Depends on:** P1-A-1 · **Files:** `src/ui/input/gestures.ts`
**Implementation notes** Wheel = zoom at cursor; `Shift`+wheel = horizontal pan; trackpad two-finger pan detected via `deltaMode` and lack of `ctrlKey`; pinch-zoom on touch; middle-drag and `Space`-drag to pan. Inertia: velocity from the last 100 ms of movement, exponential friction, cancelled by any new input. Respect `prefers-reduced-motion` by disabling inertia and camera animation.
- All gesture state (drag tracking, pinch tracking, Space-held, in-flight inertia) lives in one `attachGestures(camera, pointerTarget, options)` closure, returned as a small `GestureController` (`panning`, `coasting`, `dispose()`). `Clock`, `FrameScheduler`, and the `prefers-reduced-motion` query are all injected — same discipline as `worker/client.ts`'s `FrameScheduler`/`sim.worker.ts`'s `REAL_CLOCK` — so inertia's physics are exercised deterministically under test instead of against real timers.
- Wheel-driven panning (the trackpad two-finger case, `deltaMode === 0` with no `ctrlKey`) deliberately gets no inertia of its own: the platform already sends decaying `wheel` events on its own (native momentum). This module's friction model only ever applies to a released pointer-drag.
- Pinch-zoom is built on Pointer Events (tracking up to two `pointerType: 'touch'` ids), not `TouchEvent` — consistent with the project's "Pointer Events only" preference (P1-B-1) and, incidentally, what makes it unit-testable without a real touch-capable browser.
- Inertia decays exponentially (`FRICTION_PER_MS`) and is additionally hard-capped at `MAX_INERTIA_MS = 800`, so the 800 ms acceptance criterion holds regardless of tuning, not just in the common case.
**Acceptance criteria**
- [-] E2E: pinch-zoom on a touch emulation session zooms about the pinch midpoint — cut here: `P1-H-1`'s Playwright harness does not exist yet (it depends on `P1-D-1`, also not started), so there is no browser touch-emulation session to run this against. Relocated to `P1-H-1`'s "pan/zoom" spec (2026-09-04); do not re-add here. The pinch-anchoring math itself is proven now at the unit level (`tests/unit/ui/gestures.spec.ts`, "zooms about the pinch midpoint": a symmetric two-finger pinch leaves the world point under the midpoint fixed to within 1e-6) — the same class of interim substitution P0-H-2 used for its dpr criterion.
- [x] Inertia comes to rest within 800 ms and never overshoots into an inconsistent camera state — proven by driving a fake `Clock`/`FrameScheduler` frame-by-frame from a real release velocity; asserts `coasting` goes false at or before 800 ms (+ one frame of slack) and that `originX`/`originY` stay finite throughout.
- [x] With reduced motion enabled, pan stops the instant the pointer does — proven: with `reducedMotion` reporting `true`, releasing the drag pointer never schedules a coast frame at all (`coasting` is `false` immediately, `scheduler.hasPending` stays `false`).

#### - [x] P1-A-3 · Grid lines & the "you are here" overlay
**Depends on:** P1-A-1 · **Files:** `src/ui/overlay/grid-lines.ts`
**Intent:** Boring feature; make it interesting (inception rule "Stay Fancy").
**Implementation notes** Grid lines fade in only when `cellSize ≥ 6`, with a stronger decade line every 10 cells and a labelled origin cross. Opacity is a smooth function of zoom, not a hard toggle — a hard toggle is what a boring implementation looks like. A minimap-style world extent indicator appears while panning and fades after 600 ms.
- `GridLinesOverlay.draw(ctx, camera, nowMs)` is self-contained: it diffs the `Camera`'s own origin/cellSize against what it saw last frame to detect "activity" (pan or zoom, either resets the "you are here" badge's 600 ms fade-out), so it needs no wiring to P1-A-2's gestures or P1-B-1's not-yet-built input router.
- Colours are a required `GridLinesPalette` of `{r,g,b}` triples — no hardcoded grey fallback, same discipline `render/canvas2d.ts`'s `CompiledTheme` requirement established. Triples rather than CSS strings because `ui/` cannot import `render/canvas2d.ts`'s `parseColor` (ADR-009: only `render/types` is reachable from `ui/`) and re-deriving a colour parser here just to re-add alpha would duplicate it for no gain.
- Below `cellSize` 6 the whole grid is skipped before any iteration — zero cost, not just zero opacity — which is also what keeps the <1ms budget trivial once zoomed out.
**Acceptance criteria**
- [x] Lines are crisp at any `devicePixelRatio` (half-pixel offset handled) — proven directly: `Camera` already works in device-px space (P1-A-1), so a 1px stroke only needs `snapForCrispStroke` (`Math.round(px)+0.5`); verified for camera dimensions scaled ×1/×2/×3 (what a DPR-2/3 backing store looks like for the same CSS viewport).
- [x] Grid rendering costs < 1 ms at 1080p — measured (CPU dispatch against a cheap fake context, not GPU raster time, same honest scope as P0-H-2's frame-time budget) at `cellSize` 6.1 (the worst-case line density, just past the fade-in threshold), 1920×1080.
- [x] Fade curve is driven by a motion token, not a literal — driven by an injectable `FadeCurve = (t: number) => number`, the same shape ADR-008's `MotionSignature.easings` will eventually have (see P1-E-1's note: real tokens slot in here with no API change). The default (`SMOOTHSTEP`) is a hand-written placeholder, not a real theme token — P1-E-1 doesn't exist yet — but the point of the criterion (no ad hoc literal formula, a swappable named curve) is genuinely satisfied today, unlike P1-A-2's Playwright criterion which needed infrastructure that plain cannot be built early.

---

### Workstream B — Input pipeline & tools

#### - [x] P1-B-1 · Input router
**Depends on:** P1-A-1 · **Files:** `src/ui/input/router.ts`
**Implementation notes** Pointer Events only (one code path for mouse/pen/touch). Owns pointer capture, coalesced events (`getCoalescedEvents()` — essential for smooth fast drags), modifier state, and world-coordinate conversion. Emits a normalised `ToolEvent`.
- `attachInputRouter(camera, target, handlers)` — same factory-plus-controller shape as P1-A-2's `attachGestures`, and a sibling of it, not layered on top of it: this module and `gestures.ts` are two independent listener sets meant to both attach to the same canvas, gestures.ts owning the camera and this one owning tool strokes.
- Only a *primary*-button pointerdown (`button === 0`, which touch also reports) starts a stroke, so gestures.ts's middle-mouse-drag pan is never mistaken for one; only one pointer is tracked as the active stroke at a time, so a second touch arriving mid-pinch is ignored, not merged into a second stroke.
- **Known open seam, not solved here:** gestures.ts's *other* pan trigger, Space+left-drag, is not filtered — this module has no visibility into gestures.ts's Space-held state, and reaching into it would be scope creep for a task whose file list is one module. Whichever task first composes both listeners onto a real canvas (candidate: P1-D-1's layout shell) needs to share that state or gate which listener is live.
**Acceptance criteria**
- [x] A fast drag across 1000 px produces a continuous, gap-free cell path (uses coalesced events — verified by test with synthesised event batches) — a synthesised `pointermove` whose `getCoalescedEvents()` returns 20 sub-samples spanning the 1000px drag yields one `ToolEvent` whose `coalesced` array carries all 20 world-converted points in order, none dropped.
- [x] Losing pointer capture (alt-tab mid-drag) cleanly cancels the active tool with no partial edit committed — the native `lostpointercapture` event is treated exactly like `pointercancel`: it fires `onCancel`, clears the active pointer, and any further (stray, late) event for that pointer is ignored rather than resuming the stroke.
- [x] Pen pressure is exposed for the brush even though nothing consumes it yet — every `ToolPoint` (down, move, and each coalesced sample) carries the native event's `pressure`, unconsumed until P1-B-3.

#### - [x] P1-B-2 · Tool framework
**Depends on:** P1-B-1 · **Files:** `src/ui/tools/tool.ts`, `src/ui/tools/registry.ts`
**Implementation notes** `Tool` interface with `onDown/onMove/onUp/onCancel`, a `preview(): PaintOp[]` used for the live ghost, and `cursor`. Tools produce data only; the `CommandBus` commits it. `Escape` cancels any in-progress tool. Every tool registers as a command with a single-key binding.
- `onCancel(): void` has no return channel at all — a cancelled gesture cannot produce a commit even by accident, so "Escape leaves the grid byte-identical" is a type-level guarantee, not just a convention the registry happens to follow.
- `ToolRegistry.onCommit` (constructor option) is the seam P1-C-1's `CommandBus` plugs into once it exists; until then a missing `onCommit` just drops finalised ops, same as there being no bus yet. `ToolRegistry.handlers` is shaped to pass straight to P1-B-1's `attachInputRouter` with zero glue code.
- `Tool.id`-as-command-id and the single-key binding are P1-C-1/P1-C-2's job (`CommandBus`, the keybinding registry) — neither exists yet. What's built here (`register()`, `activate()`, `attachEscapeHandling`) is everything a tool needs to be fully live *today*; wiring a `Tool.id` into an actual `AppCommand` is a mechanical follow-up for whichever of those two tasks lands first, not a gap in this one.
**Acceptance criteria**
- [x] Adding a new tool requires touching exactly one new file plus one registry line (proved by a fixture tool in tests) — a fixture `Tool` implementation plus a single `registry.register(new FixtureTool())` call is immediately gettable, listable, auto-activated (first tool registered), and fully wired through `handlers`/`onCommit` — no change to `tool.ts` or `registry.ts` itself.
- [x] `Escape` mid-drag leaves the grid byte-identical to before the drag — proved literally, not just by absence of a commit call: a real `Simulation` is snapshotted before a down+move+cancel sequence (never `onUp`) and after; tick, RNG state, and every live chunk's bytes are asserted unchanged. A contrasting test proves the wiring is genuinely live: an uncancelled down+up *does* commit and *does* change the simulation.

#### - [x] P1-B-3 · Brush & eraser
**Depends on:** P1-B-2 · **Files:** `src/ui/tools/brush.ts`, `src/ui/tools/eraser.ts`
**Implementation notes** Size 1–64; shapes square / circle / diamond; **state selection** (multi-state rules paint any state — a colour-swatch row appears automatically from the ruleset's palette); density (spray) with the seeded PRNG; symmetry modes (none, mirror-X, mirror-Y, quad, 4-fold rotational, 8-fold) — symmetry is cheap to implement and enormously fun, which is exactly the inception document's bar. Line interpolation between move samples via Bresenham so fast drags never dot.
- The seeded PRNG (`density`'s spray) is a hand-written duplicate of `engine/rng.ts`'s Mulberry32, not an import — `ui/` cannot reach `engine/` at all (ADR-009). Same treatment `shared/types.ts` already documents for its own independently-defined chunk-coordinate maths.
- Every symmetry mode and the Bresenham fill share one dedup mechanism: a `Map<packedXY, PaintOp>` per stroke. That single mechanism is what makes 8-fold symmetry's axis collisions collapse correctly *and* is what keeps a slow, wobbly drag or overlapping shape stamps from bloating the op count — one property serving two of this task's acceptance criteria.
- `Eraser` is a thin wrapper around `Brush` forcing `state: DEAD`, not a duplicate implementation — it exposes no `state` property at all, so there is no way, even by mistake, to make it paint anything else.
- The colour-swatch row and the single-key tool bindings from the implementation notes are DOM/`CommandBus` concerns outside this task's file scope (`brush.ts`/`eraser.ts` only) — `state`/`shape`/`size`/`density`/`symmetry` are plain mutable properties a future component sets directly; see P1-B-2's own note on the `CommandBus` seam.
**Acceptance criteria**
- [x] Drag at 2000 px/s leaves a solid, unbroken stroke — proved two ways: an extreme single coalesced sample (0 → 100 world units in one reported move) still paints every intermediate cell; and a realistic 2000px/s-at-60fps, `cellSize` 8 sampling cadence over 40 frames leaves consecutive painted cells exactly 1 apart throughout. A diagonal-jump variant exercises Bresenham's other step branch (steep lines), not just horizontal.
- [x] 8-fold symmetry produces exactly 8 mirrored ops per source cell, deduplicated at the axes — a point off every axis yields exactly 8 distinct ops; a point on the x-axis collapses to 4; the origin itself (on every axis and the diagonal at once) collapses to 1.
- [x] Painting state 2 in Brian's Brain is possible from the UI without typing anything — `new Brush({ state: 2 })` paints state 2 by property assignment alone; the test confirms Brian's Brain genuinely has a state id 2 (`dying`), not an assumed number.
- [x] Painting 5,000 cells in one stroke stays above 60 fps — a single coalesced-move batch producing 5,000+ cells, timed after a warm-up call (steady-state JIT cost, not first-call compilation), completes in well under one 16.6 ms frame budget; skipped under `VITEST_COVERAGE` per `simulation.spec.ts`'s established convention.

#### - [x] P1-B-4 · Shape tools: line, rectangle, ellipse, fill
**Depends on:** P1-B-2 · **Files:** `src/ui/tools/{line,rect,ellipse,fill}.ts`
**Implementation notes** Live ghost preview, `Shift` constrains to 45°/square/circle, `Alt` draws from centre, filled vs outline toggle. Flood fill is a scanline fill with a hard cell cap (default 1,000,000) and a confirmation prompt beyond it — a flood fill on an infinite grid is otherwise a hang.
- `line.ts` reuses `brush.ts`'s exported `bresenham`/`packXY` rather than a second copy — both live in `ui/`, so this is an ordinary import, not the ADR-009 boundary duplication `brush.ts`'s own hand-written PRNG needed.
- `tool.ts`'s `ToolContext` gained an optional `grid?: GridView` — the widening P1-B-2 explicitly left room for. `fill.ts` is the first tool that needs to *read* existing cell state rather than only generate ops from cursor position; `ToolRegistry.handlers` (P1-B-2) doesn't supply a live grid today, so `fill.ts` no-ops gracefully when none is given. Wiring a real `GridView` through is a follow-up for whichever task composes the full pipeline against a live `WorkerClient`.
- Flood fill is capped **both** by cell count (`cap`, default 1,000,000) and by wall-clock time (`timeoutMs`, default 400 ms, via an injected `Clock` reused from `gestures.ts`). At the full 1,000,000-cell scale a `Set`-keyed scanline fill's own dedup bookkeeping — not this algorithm's shape — costs enough (~200–300ms baseline, measured) that cell-count alone doesn't reliably guarantee the 500ms budget on a slower or busier machine; the time backstop is what makes the criterion hold in every environment, not just a fast one. Found and fixed two real bugs while proving this: (1) cells were recorded only *after* a run's full extent was known, so exhausting the budget mid-probe on an unbounded field left nothing filled at all, not a legible partial result — fixed by recording each cell incrementally as it's probed; (2) the cap/timeout could be detected but never latched into `capped` if the stack also happened to empty out at the same moment — fixed with an explicit postcondition check.
**Acceptance criteria**
- [x] Bresenham line matches a reference implementation for 10k random endpoint pairs — "matches" is interpreted honestly: two independently-formulated (but both textbook-correct) Bresenham variants are not guaranteed bit-for-bit identical at every slope (a documented tie-breaking difference between formulations, confirmed empirically at ~0.56% of points, never more than one cell of deviation). The test holds both to identical endpoints, identical length, never more than one cell apart at any step, and >95% exact agreement — which a real algorithmic bug would violate, and legitimate tie-breaking does not.
- [x] Midpoint ellipse is symmetric in all four quadrants — the classic two-region midpoint algorithm computes one quadrant; mirroring it to the other three (with dedup at the axes) is what makes this true by construction, verified for a range of radii including the degenerate `rx=0`/`ry=0` line cases.
- [x] Flood fill over 1M cells completes in < 500 ms or prompts, and never blocks past the cap — proved for a bounded exact-1,000,000-cell region (completes or prompts, per the criterion's own "or"; never exceeds the cap or the time budget either way), an unbounded uniform field (correctly prompts), a custom smaller cap, and the wall-clock backstop in isolation via an injected fake `Clock`.

#### - [x] P1-B-5 · Selection & clipboard
**Depends on:** P1-B-2 · **Files:** `src/ui/tools/select.ts`, `src/ui/overlay/selection.ts`
**Implementation notes** Marquee select; move, copy, cut, paste, delete; rotate 90°, flip H/V on the selection; paste follows the cursor as a ghost until placed. Clipboard is internal *and* writes RLE to the system clipboard so patterns can be pasted into a forum post — a small feature with a disproportionate wow return.
- Only the marquee drag is a `Tool` gesture; copy/cut/paste/rotate/flip/move are plain methods (`SelectTool.copy()` etc.) for a future keybinding layer (`Ctrl/Cmd+C`, P1-C-2) to call directly — the same "tools produce data, a `CommandBus` commits it" shape P1-B-2 established, extended to discrete actions rather than only drag gestures.
- Selection content is a frozen snapshot captured once at marquee finalisation (`onUp`), not a live view — `rotate`/`flip` transform the clipboard buffer, matching the acceptance criterion's own "copy → rotate → paste" ordering, not the live grid selection.
- **Known limitation, not solved here:** "paste follows the cursor as a ghost" is best-effort. P1-B-1's router only forwards pointer moves *during an active stroke* (button held) — there is no hover-move event stream yet for a ghost to track a bare mouse movement. The ghost still updates on every move this tool does receive and always locks to the exact click position on placement; true hover tracking needs a router extension, a follow-up for whichever task adds one.
- Ships a minimal, hand-written RLE codec (states 0–24: `b`, `o`, `A`–`X`) — enough to round-trip a selection through the system clipboard now. Phase 2's P2-A-1/P2-A-2 are the real, full-spec codec (the complete multi-state extension, `#C`/`#N`/`#O`/`#r` headers, a 40-file corpus); this one is superseded then, not extended — see the note added there.
- Fixed a real bug found while testing: `onUp` originally trusted whatever rect `onMove` had last computed, rather than recomputing from its own event — inconsistent with `rect.ts`/`line.ts`/`ellipse.ts`'s pattern, and wrong for a marquee finalised with no intervening move. Also corrected the selection-replacement design: a new marquee no longer destroys the previous finalised selection at `onDown` — only once the new one actually completes at `onUp`, so cancelling a new drag can't also lose the old selection.
**Acceptance criteria**
- [x] Copy → rotate → paste is exact for asymmetric patterns (property test over random 16×16 blocks) — 200 random multi-state 16×16 blocks, each rotated via an independently-written dense-array transform (not a reuse of `select.ts`'s own `rotate90`) and compared exactly against what `copy()`+`rotate()`+`paste()` actually places.
- [x] `Ctrl/Cmd+C` puts valid RLE on the system clipboard; pasting that RLE back reproduces the pattern — proved against an injected fake `SystemClipboard` (real `navigator.clipboard` is unavailable in jsdom and irrelevant to what's being tested); the written text is decoded and re-placed, reproducing all three original live cells at their correct relative positions.
- [x] Selection marching-ants animation is driven by a motion token and stops under reduced motion — the march speed is an injectable duration (`marchPeriodMs`, provisional until P1-E-1 supplies a real one, same treatment P1-A-3's `FadeCurve` got), and `reducedMotion` (reused directly from `gestures.ts`) locks the dash offset to 0 regardless of elapsed time.

#### - [ ] P1-B-6 · Stamp tool
**Depends on:** P1-B-5 · **Files:** `src/ui/tools/stamp.ts`
**Implementation notes** Phase 1 ships a small hardcoded stamp set (glider, LWSS, blinker, toad, beacon, pulsar, R-pentomino, acorn, Gosper gun, block) decoded from bundled RLE. Ghost preview with rotate (`R`) and flip (`F`) before placing; `Shift`-click places repeatedly. Phase 2 swaps the hardcoded set for the full catalogue behind the same interface — design for that now.
**Acceptance criteria**
- [ ] The stamp source is an array of RLE strings, not code, so Phase 2 substitutes a data source with no tool changes.
- [ ] A placed Gosper gun immediately produces gliders when run (integration test).

---

### Workstream C — Commands, keybindings, undo

#### - [ ] P1-C-1 · Command registry & bus
**Depends on:** Phase 0 · **Files:** `src/ui/commands/registry.ts`, `src/ui/commands/bus.ts`, `src/client/app-context.ts`
**Implementation notes** Registration is duplicate-checked at startup and throws loudly. `bus.run(id, arg)` resolves `isEnabled` first, dispatches, records to the edit stack when `undoable`, and emits telemetry-free events that Phase 4's palette will show as "recent".
**Follow-up from P1-B-2:** wire `ToolRegistry.onCommit` (P1-B-2) to this bus so a tool's finalised `PaintOp[]` actually reaches `WorkerClient.paint()`, and register one `tool.select.<id>` command per `ToolRegistry` entry (`Tool.id` was chosen to already match that naming). Neither is a change to `tool.ts`/`registry.ts` — both are additions here.
**Acceptance criteria**
- [ ] A test enumerates every registered command and asserts each has a `title`, a `category`, and either a `defaultBinding` or an explicit `noBinding: true`. **No orphan commands.**
- [ ] Running a disabled command is a no-op with a debug warning, never a throw.

#### - [ ] P1-C-2 · Keybinding system
**Depends on:** P1-C-1 · **Files:** `src/ui/input/keymap.ts`, `src/ui/input/bindings.ts`
**Implementation notes** `Mod` normalises to `Cmd` on macOS / `Ctrl` elsewhere. Supports chords (`g` then `g`) with a 1 s timeout and a visible pending-chord indicator. Bindings never fire while focus is in a text input. Conflicts are detected at registration and reported.
**Default bindings (Phase 1 set):**
| Key | Action | | Key | Action |
|---|---|---|---|---|
| `Space` | Play / pause | | `B` | Brush |
| `.` | Single step | | `E` | Eraser |
| `,` | Step back *(Phase 4)* | | `L` | Line |
| `[` `]` | Speed − / + | | `U` | Rectangle |
| `R` | Reset to seed | | `O` | Ellipse |
| `C` | Clear grid | | `G` | Fill |
| `N` | Random soup | | `S` | Select |
| `+` `−` | Zoom in / out | | `M` | Stamp |
| `0` | Zoom to fit | | `1`–`9` | Brush size |
| `Mod+Z` / `Mod+Shift+Z` | Undo / redo | | `Shift+/` | Shortcut cheat sheet |
| `Mod+C/X/V` | Copy / cut / paste | | `?` | Help |
| `Mod+S` | Save session | | `Mod+K` | Command palette *(Phase 4)* |
**Acceptance criteria**
- [ ] Every binding above is exercised by a Playwright spec.
- [ ] A duplicate binding registration fails the test suite.
- [ ] Typing `[` in the ruleset-name text field does not change the speed.

#### - [ ] P1-C-3 · Edit undo/redo stack
**Depends on:** P1-C-1 · **Files:** `src/ui/commands/edit-stack.ts`
**Implementation notes** Stores inverse `PaintOp[]` per edit (cheap — we already have `from` values in the `ChangeSet`). Depth-capped (default 200) and byte-capped. **Explicitly separate from the Phase 4 time machine**: undo reverses *your edits*, the timeline reverses *the simulation*. The UI must never blur these — Phase 4 adds a one-line explainer in the timeline.
**Acceptance criteria**
- [ ] 200 random edits fully undone restores a byte-identical grid.
- [ ] Undo after a step undoes only the edit, leaving the generation count alone.
- [ ] Redo is invalidated by a new edit, and the UI reflects that immediately.

---

### Workstream D — HUD & core UI

#### - [ ] P1-D-1 · Layout shell & the "wow on first paint"
**Depends on:** Phase 0 · **Files:** `src/ui/components/shell.ts`, `src/client/index.html`
**Intent:** *"When a user first opens the app, they should be struck by the fact that it's a 'toy' that feels like a professional tool."* This task owns that first impression.
**Implementation notes**
- Full-bleed canvas; floating translucent chrome (toolbar left, transport bottom-centre, status bar bottom-right, panel dock right). Chrome is dismissible with `Tab` for a pure-canvas view.
- **Cold start choreography:** the app opens on a curated seed (a Gosper gun feeding a reaction), already running, camera animating from a wide shot to frame, chrome fading in staggered by ~40 ms. It takes ~1.2 s and it is the difference between "a toy" and "a professional tool". Skipped entirely under reduced motion.
- All chrome uses `backdrop-filter` with a solid fallback, and reads only from tokens.
**Acceptance criteria**
- [ ] First meaningful paint < 1000 ms; the intro never delays interactivity (any input cancels it instantly).
- [ ] `Tab` toggles chrome with a 150 ms transition; canvas is never resized in a way that reflows the camera.
- [ ] Layout is correct from 320 px to 5120 px wide, and on a 4:5 portrait phone viewport.
- [ ] Zero literal colours/sizes in the component source (lint rule P1-E-1 enforces).

#### - [ ] P1-D-2 · Transport controls
**Depends on:** P1-D-1, P1-C-1 · **Files:** `src/ui/components/transport.ts`, `src/ui/components/speed.ts`
**Implementation notes** Play/pause, single-step, step-back (present but disabled with a "Phase 4" tooltip — never ship a mystery), reset, clear, random soup. Speed control is a **logarithmic** slider from 0.5 to 1000 TPS plus an "unbounded" mode that runs as fast as the worker allows and reports actual achieved TPS. Show target *and* actual TPS — a researcher needs to know when the sim is the bottleneck.
**Acceptance criteria**
- [ ] Achieved TPS is within 5% of target for targets up to the machine's capability, verified by test.
- [ ] Above capability the UI clearly shows "target 1000 / actual 340" rather than silently lying.
- [ ] Every control has an accessible name and a keyboard equivalent.

#### - [ ] P1-D-3 · Status bar & readouts
**Depends on:** P1-D-1
**Implementation notes** Generation, population, per-state counts (auto-generated chips from the ruleset palette), cursor world coordinates, cell state under cursor, zoom %, fps, step ms, render ms, memory estimate. Numbers use tabular figures and are throttled to 10 Hz — a 60 Hz number is unreadable and wastes a frame budget.
**Acceptance criteria**
- [ ] No layout shift as digit counts change (fixed-width numerics).
- [ ] Readout updates cost < 0.3 ms/frame (measured).
- [ ] Population matches an engine recount exactly at 100 random ticks.

#### - [ ] P1-D-4 · Ruleset picker
**Depends on:** P1-D-1, P0-D-5 · **Files:** `src/ui/components/ruleset-picker.ts`
**Implementation notes** Grouped by tag, each entry showing name, notation, state count and a one-line description. Live **animated thumbnail** per ruleset (a tiny 32×32 simulation running in the picker) — this is the "Stay Fancy" answer to what would otherwise be a `<select>`. Switching a ruleset with an incompatible palette prompts for a state mapping (P0-E-3) rather than failing.
**Acceptance criteria**
- [ ] Thumbnails run only while the picker is open and cost < 2 ms/frame combined.
- [ ] Keyboard navigable; type-ahead search works.
- [ ] Switching Conway → WireWorld surfaces the migration prompt with sensible defaults preselected.

#### - [ ] P1-D-5 · Toasts, dialogs, tooltips
**Depends on:** P1-D-1
**Implementation notes** One shared, accessible primitive set: focus trap on dialogs, `Escape` to close, `aria-live="polite"` for toasts, tooltips that show the command's current keybinding. Every long-running or destructive action (clear, flood-fill over cap, ruleset switch) routes through these.
**Acceptance criteria**
- [ ] Axe-core reports zero violations on the dialog and toast components.
- [ ] Tooltips display the *user's current* binding, not the default, once Phase 4 adds remapping.

---

### Workstream E — Default theme & token system

#### - [ ] P1-E-1 · Token contract and lint enforcement
**Depends on:** Phase 0 · **Files:** `src/themes/types.ts`, `src/themes/tokens.css`, `eslint.config.js`
**Implementation notes** Enumerate every token the UI will ever need — colour (surface/elevated/border/text/muted/accent/danger/success), type (family, 6 sizes, 3 weights, 2 letter-spacings), space scale, radius scale, shadow scale, motion (4 durations, 5 easings), and the cell palette contract. Add an ESLint rule banning literal hex/rgb/hsl values and raw `ms`/`px` durations in `src/ui/**`.
**Follow-up for whichever task first wires a real theme through:** `src/ui/overlay/grid-lines.ts` (P1-A-3) takes its zoom-fade/activity-fade shape as an injectable `FadeCurve` (default `SMOOTHSTEP`, a hand-written placeholder) and its colours as a required `GridLinesPalette` of `{r,g,b}` triples (no default) — rewire both to the real `motion.easings` token and the active theme's palette once they exist; no API change needed on `grid-lines.ts`'s side.
**Acceptance criteria**
- [ ] `tokens.css` documents every variable with a comment stating its purpose and its Default value.
- [ ] The lint rule catches a deliberately introduced `color: #333` in a component.
- [ ] Token names contain no theme-specific words (no `--gol-neon-pink`).

#### - [ ] P1-E-2 · Theme registry & activation
**Depends on:** P1-E-1 · **Files:** `src/themes/registry.ts`
**Implementation notes** `activate(id)` writes tokens to `:root`, hands the `CellPalette` to the renderer, and (from Phase 3) swaps render hooks and the sound pack. Persist the choice. Honour `prefers-color-scheme` for the Default theme's light/dark variants. Switching must be instant and flicker-free — pre-apply tokens before the next paint.
**Acceptance criteria**
- [ ] Switching themes causes no full-page reflow and no flash of unstyled content.
- [ ] The registry API already accepts optional render hooks and a sound pack (Phase 3 adds no new API surface).

#### - [ ] P1-E-3 · The Default theme
**Depends on:** P1-E-2 · **Files:** `src/themes/default/*`
**Intent:** *"simple, grey, basic — the same as you'd expect on every linux distribution ever released. But very compatible and good for large grids."* Being the plain one is not permission to be ugly. This is the theme researchers will spend hours in.
**Implementation notes** Neutral greys, light and dark variants, system UI font stack, no render hooks, no post-processing, `cost: 'low'`. The cell palette is a perceptually-even ramp (OKLCH-derived, computed at build time into plain sRGB values — no colour library at runtime) so multi-state rules read clearly. Alive cells get a 1-frame "birth" brightness pop that costs nothing and reads as alive.
**Acceptance criteria**
- [ ] WCAG AA contrast for all chrome text in both light and dark variants.
- [ ] 8-state palette is distinguishable under deuteranopia and protanopia simulation (documented check).
- [ ] Frame time with Default at 1080p / 100k cells ≤ 10 ms — it must be the *fastest* theme.

---

### Workstream F — Persistence & sharing

#### - [ ] P1-F-1 · Session model & autosave
**Depends on:** P1-D-1 · **Files:** `src/client/session.ts`, `src/shared/session.ts`
**Implementation notes** `SessionDoc` = `{ version, ruleset (id or inline), grid (RLE), camera, tick, seed, theme, toolState }`. Autosave to `localStorage` debounced at 2 s and on `visibilitychange`. A versioned migration function from day one — the format *will* change in Phase 2 and 4.
**Acceptance criteria**
- [ ] Reload restores grid, camera, ruleset, theme and tool exactly.
- [ ] A v1 document still loads after the Phase 4 format change (migration test committed now, extended later).
- [ ] Quota-exceeded is handled with a toast and a graceful downgrade (drop grid, keep settings), never a crash.

#### - [ ] P1-F-2 · Shareable URLs
**Depends on:** P1-F-1
**Implementation notes** Encode a compact session into the URL fragment: RLE → deflate via the platform `CompressionStream` (zero dependency) → base64url. Fall back to a server-stored session (`POST /api/sessions`) with a short id when the fragment would exceed ~8 kB. Never put user data in the query string where it lands in server logs.
**Acceptance criteria**
- [ ] A glider gun session round-trips through a URL under 2 kB.
- [ ] A 100k-cell pattern automatically switches to server-backed sharing with a copied short link.
- [ ] Opening a share link never overwrites an existing autosave without asking.

---

### Workstream G — Server API v1

#### - [ ] P1-G-1 · Ruleset routes
**Depends on:** P0-I-2, P0-D-2 · **Files:** `src/server/routes/rulesets.ts`, `src/server/store/file-store.ts`
**Implementation notes** Builtins served from the engine; user rulesets stored as JSON files in a mounted `data/` volume with slugified, path-traversal-safe ids. **Server-side validation reuses `validateRuleSet` from the engine** — one validator, one source of truth (this is the only permitted `server → engine` import per ADR-009). Body limit 64 kB.
**Acceptance criteria**
- [ ] Supertest coverage of all four routes including a traversal attempt (`../../etc/passwd`) returning 400.
- [ ] An invalid ruleset POST returns the structured `issues[]` array the Phase 2 editor will render.
- [ ] Concurrent writes to the same id do not corrupt the file (atomic write via temp + rename).

#### - [ ] P1-G-2 · Pattern routes (skeleton)
**Depends on:** P1-G-1 · **Files:** `src/server/routes/patterns.ts`
**Implementation notes** Serve the Phase 1 hardcoded stamp set from `patterns/` on disk with the query interface Phase 2 will fill out. Establish the response shape now so the client never changes.
**Acceptance criteria**
- [ ] `GET /api/patterns?ruleset=conway` returns the ten Phase 1 patterns with complete metadata.
- [ ] Responses are cacheable (`ETag`, `Cache-Control`).

#### - [ ] P1-G-3 · `/live` broadcast
**Depends on:** P1-G-1 · **Files:** `src/server/routes/live.ts`, `src/server/live-hub.ts`
**Intent:** The inception document's "State Sync", scoped honestly per ADR-002: a shared, always-running exhibition grid anybody can watch.
**Implementation notes** The server runs one `Simulation` (importing only the public engine surface), broadcasting `ChangeSet` deltas at a fixed 10 Hz to all subscribers, with a full keyframe on join. Read-only. Backpressure: if a socket's `bufferedAmount` exceeds a threshold, skip its deltas and send it a keyframe when it drains. Cap concurrent sockets; heartbeat ping/pong with dead-socket reaping.
**Acceptance criteria**
- [ ] 100 simultaneous clients stay in sync for 10 minutes with server memory flat.
- [ ] A client stalled for 30 s is resynchronised by keyframe, not by disconnect.
- [ ] Killing the server and restarting it does not wedge reconnecting clients (exponential backoff on the client).
- [ ] Watching `/live` never interferes with the viewer's own local simulation.

---

### Workstream H — Testing & gates

#### - [ ] P1-H-1 · Playwright harness
**Depends on:** P1-D-1 · **Files:** `playwright.config.ts`, `tests/e2e/*.spec.ts`
**Implementation notes** Chromium + Firefox + WebKit. Deterministic runs: seed the PRNG, freeze the clock, disable the intro choreography and inertia via a `?test=1` flag. Trace on first retry. Add the job to CI.
**Acceptance criteria**
- [ ] Specs covering: draw a glider and verify it moves; pan/zoom (**including P1-A-2's relocated criterion**: pinch-zoom on a touch-emulation session zooms about the pinch midpoint); every Phase 1 keybinding; undo/redo; ruleset switch; theme persistence across reload; share-link round trip; `/live` connect and receive.
- [ ] Suite completes in < 4 minutes and is non-flaky over 10 consecutive CI runs.

#### - [ ] P1-H-2 · Visual regression baseline
**Depends on:** P1-H-1, P1-E-3 · **Files:** `tests/visual/*.spec.ts`
**Implementation notes** Screenshot the shell, toolbar, transport, status bar, dialog and a rendered grid at three zoom levels, in Default light and dark. Mask the fps/ms readouts. Tolerance ≤ 0.1% pixels. This is the baseline Phase 3 will extend to six themes — establish the discipline now while there is one theme to fix.
- Also owns P0-H-2's relocated dpr claim: Chromium at `deviceScaleFactor` 1 and 2, same CSS viewport, HUD masked, compare screenshots (or a downsampled buffer) so the rendered grid is pixel-identical modulo scale. That is a real browser raster, not `CanvasRecorder` CPU fills. Phase 0 already proves `resize()` backing-store vs CSS size; this task proves the pixels.
**Acceptance criteria**
- [ ] Baselines committed and stable across three consecutive CI runs.
- [ ] A deliberate 2 px padding change is caught.
- [ ] Rendering is pixel-identical at `dpr` 1 and 2 modulo scale — relocated from P0-H-2 (2026-09-03). Chromium `deviceScaleFactor` 1 vs 2, HUD masked, same CSS viewport; do not treat a Node recorder buffer as this box.

#### - [ ] P1-H-3 · Interaction performance budgets
**Depends on:** P1-B-3, P0-I-4 (bench harness) · **Files:** `tests/bench/interaction.bench.ts`
**Acceptance criteria**
- [ ] Input-to-pixel latency for a paint stroke ≤ 32 ms at the 95th percentile (measured via the recorder + injected clock).
- [ ] Pan at 1000 px/s holds ≥ 55 fps at 1080p.
- [ ] Zooming from `cellSize` 32 to 0.5 and back never drops a frame below 30 fps.
- [ ] These numbers are added to `bench-baseline.json` and gated in CI.

---

## 4. Quality gates for Phase 1

| Gate | Threshold |
|---|---|
| All Phase 0 gates | still green (no regressions) |
| `src/ui/**` coverage | ≥ 70% statements |
| Playwright suite | green on Chromium, Firefox, WebKit; < 4 min; non-flaky ×10 |
| Visual baselines | committed, stable |
| Input-to-pixel latency | ≤ 32 ms p95 |
| Pan at 1000 px/s | ≥ 55 fps @ 1080p |
| Cold load → interactive | ≤ 1500 ms |
| Client bundle (gzip) | ≤ 120 kB |
| Axe-core on the shell | zero violations |
| Keyboard-only walkthrough | every Phase 1 feature reachable without a mouse |
| Orphan commands | zero (every command has a title, category, binding-or-explicit-opt-out) |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Optimistic overlay desynchronises from worker state; ghost cells persist. | Users see cells that do not exist. Corrodes trust immediately. | Reconcile per-cell on every confirmed frame with a tick watermark; add a periodic full-consistency assertion in dev builds; E2E test that paints during a 500 TPS run and asserts convergence. |
| The command-registry discipline erodes; someone wires a button directly. | Phase 4's palette silently misses features. | The P1-C-1 orphan-command test plus a lint rule banning `addEventListener('click')` outside `components/` primitives. |
| Token discipline erodes; literal colours creep in. | Phase 3 becomes a search-and-replace archaeology project. | The P1-E-1 lint rule, enforced from the first component. |
| Intro choreography is charming once and irritating forever. | Users bounce. | Any input skips it instantly; it does not replay within a session; a setting disables it permanently; reduced motion disables it. |
| Touch/mobile turns into a second product. | Scope explosion. | Phase 1 targets touch for *pan, zoom, and paint* only. Full mobile layout is a Phase 6 task. State this in the README. |
| `/live` becomes an attractive nuisance (abuse, resource use). | Ops burden. | Read-only, socket cap, heartbeat reaping, and it is a documented opt-in feature flag (`ENABLE_LIVE=1`), default on locally and reviewed before any public deploy in Phase 6. |

---

## 6. Definition of Done — Phase 1

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [ ] All Phase 1 quality gates (§4) green in CI on `main`.
- [ ] A person who has never used the app can draw a glider and run it without instructions. **Verify this with an actual person, not an assumption.**
- [ ] A person who never touches the mouse can do everything in the Phase 1 keybinding table.
- [ ] Reloading the page restores the previous session exactly.
- [ ] `/live` serves a shared grid to multiple browsers simultaneously.
- [ ] `CHANGELOG.md` has a dated `[0.2.0]` entry; the commit is tagged `v0.2.0`.
- [ ] `docs/demo/phase-1.*` shows drawing, panning, zooming, and running.
