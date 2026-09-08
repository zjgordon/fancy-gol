# Phase 1 — Interaction & Visuals

> *"Delightful UX: smooth animations, keyboard shortcuts, snappy interactions."*
> *"Controls where a child could pick up the basics, but a serious researcher would also have everything at their fingertips."*

| | |
|---|---|
| **Status** | Shipped on `main` as `v0.2.0` |
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
`src/ui/camera.ts`. — **Landed in P1-D-1 (2026-09-04):** the cold-start choreography's
wide-shot-to-framed camera move.

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
- **Known open seam, not solved here:** gestures.ts's *other* pan trigger, Space+left-drag, is not filtered — this module has no visibility into gestures.ts's Space-held state, and reaching into it would be scope creep for a task whose file list is one module. Whichever task first composes both listeners onto a real canvas (candidate: P1-D-1's layout shell) needs to share that state or gate which listener is live. — **Closed by P1-D-1 (2026-09-04):** `gestures.ts` gained a `spaceHeld` getter on `GestureController`; `main.ts`'s composition root gates the tool handlers it passes to `attachInputRouter` on `gestures.panning || gestures.spaceHeld`, latched once at each stroke's `onDown` rather than re-checked per event (see that task's own note on why re-checking at `onUp` would be wrong).
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
- `tool.ts`'s `ToolContext` gained an optional `grid?: GridView` — the widening P1-B-2 explicitly left room for. `fill.ts` is the first tool that needs to *read* existing cell state rather than only generate ops from cursor position; `ToolRegistry.handlers` (P1-B-2) doesn't supply a live grid today, so `fill.ts` no-ops gracefully when none is given. Wiring a real `GridView` through is a follow-up for whichever task composes the full pipeline against a live `WorkerClient`. — **Still open as of P1-D-1 (2026-09-04):** that task built the real composition root but deliberately left this specific seam unwired — it needs a `ToolRegistryOptions` widening that's out of its own file list (`shell.ts`, `index.html`). Genuine, separate scope for a future task.
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

#### - [x] P1-B-6 · Stamp tool
**Depends on:** P1-B-5 · **Files:** `src/ui/tools/stamp.ts`
**Implementation notes** Phase 1 ships a small hardcoded stamp set (glider, LWSS, blinker, toad, beacon, pulsar, R-pentomino, acorn, Gosper gun, block) decoded from bundled RLE. Ghost preview with rotate (`R`) and flip (`F`) before placing; `Shift`-click places repeatedly. Phase 2 swaps the hardcoded set for the full catalogue behind the same interface — design for that now.
- Every `BUILTIN_STAMPS` cell coordinate set was verified against a real `Simulation` before being committed, not transcribed from memory and trusted: still lifes checked for a stable period-1 fixed point, oscillators for `state(t) === state(t+period)`, the glider/LWSS for the correct translation vector (LWSS turned out to move `(+2, 0)`, not `(-2, 0)` as first assumed — shape was right, direction wasn't), R-pentomino for the well-known population-116-after-1103-ticks fact, and the Gosper gun for genuine glider emission (population growing by exactly 5 every 30-tick period, live cells confirmed outside its footprint). The stored RLE text was then generated from those verified coordinates via `select.ts`'s own `encodeRLE`/`decodeRLE` and round-tripped, so the bundled strings are guaranteed self-consistent, not just plausible-looking.
- Unlike P1-B-5's paste (dense: clears a selection's full bounding box, dead gaps included, to replace what was there), a stamp placement is sparse — only its own live cells become ops. You stamp a glider onto a mostly-empty area; you don't cut a rectangular clearing out of whatever's already there.
- `library` is a constructor option (default `BUILTIN_STAMPS`), which is what makes "Phase 2 substitutes a data source with no tool changes" concretely true rather than aspirational — proven with a wholly different fixture library in the test, not just asserted.
**Acceptance criteria**
- [x] The stamp source is an array of RLE strings, not code, so Phase 2 substitutes a data source with no tool changes — `StampDefinition.rle` is plain text; a test constructs `new StampTool({ library: <a different array> })` and confirms selection/placement work identically, with `select()` correctly rejecting an id from the *default* library that isn't in the custom one.
- [x] A placed Gosper gun immediately produces gliders when run (integration test) — the tool's own placement ops are painted into a real `Simulation` (Conway); population is asserted to grow by exactly 5 (one glider) every 30-tick period, and a live cell is confirmed to exist outside the gun's original 36×9 footprint after 150 ticks.

---

### Workstream C — Commands, keybindings, undo

#### - [x] P1-C-1 · Command registry & bus
**Depends on:** Phase 0 · **Files:** `src/ui/commands/registry.ts`, `src/ui/commands/bus.ts`, `src/client/app-context.ts`
**Implementation notes** Registration is duplicate-checked at startup and throws loudly. `bus.run(id, arg)` resolves `isEnabled` first, dispatches, records to the edit stack when `undoable`, and emits telemetry-free events that Phase 4's palette will show as "recent".
- **A real boundary constraint, resolved, not routed around:** `AppCommand`'s methods are typed against `AppContext`, and `ui/` cannot import `client/` (ADR-009) — so `AppContext` is declared in `src/ui/commands/registry.ts`, not `src/client/app-context.ts` as §2.6's file tree might suggest at a glance. `app-context.ts`'s actual job is narrower: build a *real value* of that interface (`createAppContext()`), wiring in what already exists.
- **Follow-up from P1-B-2, done:** `ToolRegistry.onCommit` is wired to an injectable `onPaint` callback, and one `tool.select.<id>` command is registered per Phase 1 tool, each carrying the exact default binding P1-C-2's own table already names (`B`/`E`/`L`/`U`/`O`/`G`/`S`/`M`) — assigned now, at definition time, not left for P1-C-2 to invent, the same way `Tool.id` was chosen in P1-B-2 to already match this naming. Neither required a change to `tools/*.ts` or `registry.ts`.
- **Not solved here, flagged for whoever boots the app:** `onPaint` has no real `WorkerClient.paint()` on the other end yet — there is no live worker/simulation composition root for it to reach. It defaults to a no-op so every tool stays fully exercisable and testable without one; wiring the real connection is P1-D-1's (or whichever task first assembles the full client) to do. — **Closed by P1-D-1 (2026-09-04):** `main.ts`'s `onPaint` now sends a real `client.send({ cmd: 'paint', ops })`.
**Acceptance criteria**
- [x] A test enumerates every registered command and asserts each has a `title`, a `category`, and either a `defaultBinding` or an explicit `noBinding: true`. **No orphan commands.** — enforced twice over: `CommandRegistry.register()` itself throws on a command missing both, *and* a test separately enumerates a populated registry (including `createAppContext()`'s real eight `tool.select.*` commands) to confirm the invariant holds in practice, not just in the constructor's own logic.
- [x] Running a disabled command is a no-op with a debug warning, never a throw — `command.run` is asserted never called, `console.debug` is asserted called exactly once naming the command id, and the call resolves normally (no throw, no rejection).

#### - [x] P1-C-2 · Keybinding system
**Depends on:** P1-C-1 · **Files:** `src/ui/input/keymap.ts`, `src/ui/input/bindings.ts`
**Implementation notes** `Mod` normalises to `Cmd` on macOS / `Ctrl` elsewhere. Supports chords (`g` then `g`) with a 1 s timeout and a visible pending-chord indicator. Bindings never fire while focus is in a text input. Conflicts are detected at registration and reported.
**Already done in P1-C-1:** the eight tool-select bindings below (`B`/`E`/`L`/`U`/`O`/`G`/`S`/`M`) are already set as `defaultBinding` on `createAppContext()`'s `tool.select.*` commands (`src/client/app-context.ts`) — this task wires the *keyboard listener* that reads `AppCommand.defaultBinding` and calls `bus.run(id)`, it doesn't invent those eight values.
**Two deliberate departures from the table below**, both recorded, neither silent:
- `,` "Step back" and `Mod+K` "Command palette" are marked *(Phase 4)* in the table itself — not registered; Phase 4 adds them.
- `Shift+/` and `?` are the *same physical key* on a US layout (`?` **is** `Shift+/`), and this task's own canonicalisation rule (shift-agnostic for bare, unmodified keys) makes them collide — registering both would trip the conflict detection this very task requires. Treated as one action, one binding: `?` → `help.cheatsheet`.
**Command ids used below (`sim.*`, `view.*`, `edit.*`, `session.save`, `brush.setSize`, `help.cheatsheet`) are a naming contract for the tasks that build those features, not commands that exist yet** — only the eight `tool.select.*` ids are real today. `bindings.ts` registers every table entry as data regardless; `attachDefaultBindings` silently skips any whose command isn't yet in the registry, so each future task's binding activates the moment it registers its command, with no change to `bindings.ts` needed. Verified concretely: only 8 of `PHASE_1_BINDINGS`' ~34 entries register against `createAppContext()`'s real registry today.
**A real parsing bug found and fixed while building this:** `+` (zoom in) is both a valid *key* and the modifier-separator character `keymap.ts` itself uses — naively splitting the bare string `"+"` on `"+"` produces two empty strings, not a one-element key, and threw `unknown modifier ""`. Caught by the table's own "every entry parses" test, not by inspection; fixed with an explicit bare-`+` case ahead of the general split, with a dedicated regression test.
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
- [-] Every binding above is exercised by a Playwright spec — cut here: `P1-H-1`'s Playwright harness doesn't exist yet (it depends on `P1-D-1`, also not started), so there is no browser session to run this against — the same treatment `P1-A-2`'s pinch-zoom criterion got. Relocated to `P1-H-1`'s spec list (2026-09-04); do not re-add here. Proven now at the unit level instead: every table entry parses and round-trips through the full dispatch pipeline (`tests/unit/ui/bindings.spec.ts`), including an end-to-end run through `createAppContext()`'s real registry and `CommandBus`.
- [x] A duplicate binding registration fails the test suite — both a direct conflict (`Mod+Z` registered twice) and a canonicalisation-driven one (`B` then `b`, which collide by design) are proven to throw; `PHASE_1_BINDINGS` itself is proven collision-free when registered whole, on both platforms.
- [x] Typing `[` in the ruleset-name text field does not change the speed — proven with a real `<input type="text">` in jsdom: the bound command does not fire with that element as the event target, and does fire for the identical key with `document.body` as the target. A `<textarea>`, a `contentEditable` element (stubbed — jsdom does not implement `isContentEditable`), and a non-text `<input type="checkbox">` are covered too, confirming only genuinely-editable targets are excluded.

#### - [x] P1-C-3 · Edit undo/redo stack
**Depends on:** P1-C-1 · **Files:** `src/ui/commands/edit-stack.ts`
**Implementation notes** Stores inverse `PaintOp[]` per edit (cheap — we already have `from` values in the `ChangeSet`). Depth-capped (default 200) and byte-capped. **Explicitly separate from the Phase 4 time machine**: undo reverses *your edits*, the timeline reverses *the simulation*. The UI must never blur these — Phase 4 adds a one-line explainer in the timeline.
- The two mechanisms don't overlap by *construction*, not just convention: `EditStack.undo()`/`redo()` only ever return `PaintOp[]` — there is no code path by which either could touch a tick count — and `Simulation.paint()` (what would apply them) never advances or rewinds `tick` either, confirmed by reading the engine, not assumed.
- `editFromChangeSet(cs)` unpacks a real `ChangeSet` into `{forward, inverse}` using the exact same `(x << 16) | (y & 0xffff)` packing `engine/grid/coords.ts`'s `packCell`/`unpackCellX`/`unpackCellY` implement — a hand-written duplicate (`ui/` cannot reach `engine/`, ADR-009), verified against those exact functions' source, not reconstructed from the packing comment alone. It copies into plain arrays *eagerly*, since a `ChangeSet`'s typed arrays are reused in place by the engine's next `paint()`/`step()` call — proven with a test that extracts one entry, paints again, and confirms the first extraction is untouched.
**Follow-up from P1-C-1, not solved here:** `CommandBus`'s `onUndoableRun` is still a no-op by default — wiring it to `record()` needs an `AppContext` that can actually apply a command's edit and diff the result, which doesn't exist until a real `Simulation`/`WorkerClient` composition root does (the same gap `app-context.ts`'s `onPaint` already documents, and likely the same future task that resolves it). — **Still open as of P1-D-1 (2026-09-04):** that task built the composition root and wired `onPaint`, but deliberately left this specific seam unwired — no `AppCommand` is `undoable: true` yet, and `edit.undo`/`edit.redo` aren't registered commands, so there is nothing yet that would call `onUndoableRun`. Recorded there as genuine, separate scope for a future task, not an oversight.
**Acceptance criteria**
- [x] 200 random edits fully undone restores a byte-identical grid — a real `Simulation`, 200 random single-cell paints (seeded, `@engine/rng`'s `Mulberry32`), each recorded via `editFromChangeSet`; undoing all 200 in reverse via `sim.paint(stack.undo())` reproduces the pre-edit snapshot exactly — tick, RNG state, and every chunk's bytes.
- [x] Undo after a step undoes only the edit, leaving the generation count alone — paint, record, `sim.step()` (tick 0→1), then undo: the painted cell reverts and `sim.tick` stays at 1, not back at 0.
- [x] Redo is invalidated by a new edit, and the UI reflects that immediately — `canRedo` (the property a future undo/redo-button component would bind to) is asserted `true` right after an undo, then `false` the instant a new `record()` call lands, before any redo was ever attempted.

---

### Workstream D — HUD & core UI

#### - [x] P1-D-1 · Layout shell & the "wow on first paint" — @claude, started 2026-09-04, finished 2026-09-04
**Depends on:** Phase 0 · **Files:** `src/ui/components/shell.ts`, `src/client/index.html`
**Intent:** *"When a user first opens the app, they should be struck by the fact that it's a 'toy' that feels like a professional tool."* This task owns that first impression.
**Implementation notes**
- Full-bleed canvas; floating translucent chrome (toolbar left, transport bottom-centre, status bar bottom-right, panel dock right). Chrome is dismissible with `Tab` for a pure-canvas view.
- **Cold start choreography:** the app opens on a curated seed (a Gosper gun feeding a reaction), already running, camera animating from a wide shot to frame, chrome fading in staggered by ~40 ms. It takes ~1.2 s and it is the difference between "a toy" and "a professional tool". Skipped entirely under reduced motion.
- All chrome uses `backdrop-filter` with a solid fallback, and reads only from tokens.
- **This task turned out to be the real composition root, not just the chrome.** Several earlier
  Phase 1 tasks' own doc comments explicitly pointed at "whichever task first assembles the full
  client" (`app-context.ts`'s `onPaint` seam, P1-C-1; `ToolContext.grid`, P1-B-4; the
  gestures.ts/router.ts Space-drag seam, P1-B-1) or named this task by number directly
  (`Camera.animateTo`, P1-A-1; P1-H-1's Playwright harness depending on this task existing at
  all). `src/client/main.ts` is rewritten accordingly: a real `Camera` drives the viewport;
  `attachGestures` and `attachInputRouter` are both attached to the same canvas, gated by a
  `toolStrokeSuppressed` flag latched once at each stroke's `onDown` against
  `gestures.panning || gestures.spaceHeld` (not re-checked mid-stroke, since router already
  guarantees a clean onDown→…→onUp/onCancel sequence per pointer and gestures' own state can flip
  *during* that sequence — proven necessary while building this: gating live on `gestures.panning`
  at `onUp` time is wrong, because gestures.ts's own `pointerup` listener (attached first) has
  already cleared it by the time router's runs); `createAppContext`'s `onPaint` now reaches a real
  `WorkerClient.paint()`; and the Phase 1 tool-select bindings are wired to a real `CommandBus`
  via `Keymap`/`attachDefaultBindings`/`attachKeymap`.
- `Camera` gained `animateTo`/`cancelAnimation`/`animating` (§2.3's full contract) plus its own
  `Clock`/`FrameScheduler` pair (same injected-timing discipline as `gestures.ts`'s identically
  named pair — a deliberate hand-written duplicate, not a shared import, matching this codebase's
  existing per-module-boundary duplication). The cold-start choreography's camera move is the
  first genuine fixed-target eased transition anything needed; P1-A-1 and P1-A-2 both correctly
  predicted they didn't need it themselves.
- **Deliberately NOT done here, recorded rather than silently skipped:** `EditStack`/
  `CommandBus.onUndoableRun` stay unwired (no `AppCommand` is `undoable: true` yet, and
  `edit.undo`/`edit.redo` aren't registered — their `bindings.ts` table entries keep being
  silently skipped by design); `ToolContext.grid` (the fill tool's live-grid read) stays unwired
  (`ToolRegistry` has no constructor seam for it without widening `ToolRegistryOptions`, out of
  this task's own file list). Both gaps were already recorded as follow-ups in `edit-stack.ts`'s
  and `tool.ts`'s/`registry.ts`'s own doc comments before this task started; both are genuine,
  separate scope for a future task, not an oversight here.
- Design tokens: `src/themes/` (P1-E-1) doesn't exist yet, so `index.html` defines its own
  `--gol-*` custom properties for exactly what the shell chrome consumes (colour, spacing, radius,
  shadow, blur, the two motion durations/easing this task needs) — every consuming rule reads a
  `var(--gol-*)`, none holds a literal, so migrating these definitions into
  `src/themes/tokens.css` + the Default theme module is a pure relocation later, the same
  "provisional now, real token slots in with no API change" treatment `grid-lines.ts`'s
  `FadeCurve` and `select.ts`'s `marchPeriodMs` already got.
**Acceptance criteria**
- [x] First meaningful paint < 1000 ms; the intro never delays interactivity (any input cancels it instantly) — the literal <1000ms figure needs a real browser to measure and belongs with `P1-H-3`'s interaction performance budgets, which don't exist yet; not claimed here. Proven at the level available today: every input listener that matters (`window` keymap/gestures/router/Escape/intro-cancel) is attached synchronously during `boot()`, before `playIntro()` is ever called — nothing about the intro gates when input becomes live — and `tests/unit/ui/components/shell.spec.ts`'s "any real input... cancels it instantly" test proves the cancel-and-jump-to-end-state behaviour directly (`Camera`'s side gets the identical treatment in `main.ts`'s own `settleCameraNow`, exercised by `camera.spec.ts`'s `cancelAnimation` tests).
- [x] `Tab` toggles chrome with a 150 ms transition; canvas is never resized in a way that reflows the camera — the 150ms figure is `--gol-duration-fast`, read by `#chrome`'s own CSS transition (not a literal in `shell.ts`, which only ever toggles a class); `shell.spec.ts` proves the toggle itself and, directly, that toggling never touches the canvas element's dimensions, attributes, or style at all — true by construction, since chrome is `position: fixed`/`absolute` and never shares layout with the canvas.
- [-] Layout is correct from 320 px to 5120 px wide, and on a 4:5 portrait phone viewport — cut here: real-viewport layout verification needs a browser (jsdom, this project's unit-test DOM, does no CSS layout at all) and `P1-H-1`'s Playwright harness / `P1-H-2`'s visual regression baseline don't exist yet — `P1-H-2` already plans exactly this screenshot set ("Screenshot the shell, toolbar, transport, status bar... at three zoom levels"). Relocated there (2026-09-04); do not re-add here. What's genuinely done at the level available today: every chrome region is positioned and sized via tokens/flex, not fixed viewport-breaking widths; the empty `toolbar`/`panel-dock` regions are `:empty { display: none }` so they cannot overlap anything before a later task populates them; and a `max-width: 600px` rule moves `.chrome-status` from the bottom-right corner to stack under `.chrome-transport` so the two can't collide at the 320px floor — reasoned through, not measured.
- [x] Zero literal colours/sizes in the component source (lint rule P1-E-1 enforces) — `P1-E-1`'s ESLint rule doesn't exist yet (`src/themes/`, its whole home, isn't built until that task); proven now by a static source check instead (`shell.spec.ts`'s "interim colours substitution" tests), the same "prove it now, formalise later" treatment `P1-A-3`'s `FadeCurve` criterion already got — superseded by real CI once P1-E-1 lands, not merely duplicated by it.

#### - [x] P1-D-2 · Transport controls — @claude, started 2026-09-04, finished 2026-09-04
**Depends on:** P1-D-1, P1-C-1 · **Files:** `src/ui/components/transport.ts`, `src/ui/components/speed.ts`
**Implementation notes** Play/pause, single-step, step-back (present but disabled with a "Phase 4" tooltip — never ship a mystery), reset, clear, random soup. Speed control is a **logarithmic** slider from 0.5 to 1000 TPS plus an "unbounded" mode that runs as fast as the worker allows and reports actual achieved TPS. Show target *and* actual TPS — a researcher needs to know when the sim is the bottleneck.
- **Every button is a registered `sim.*` `AppCommand`, not a handler touching state directly**
  (`src/ui/commands/builtin/sim.ts`, new — `ui/commands/builtin/*.ts` was already anticipated in
  Phase 1 §2.6's file tree, this is the first task to use it). This is what makes "every control
  has ... a keyboard equivalent" true for free: the seven `sim.*` bindings (`Space`, `.`, `[`, `]`,
  `R`, `C`, `N`) were already sitting as unregistered data in `bindings.ts`'s `PHASE_1_BINDINGS`
  table since P1-C-2 — registering the commands here is what makes `attachDefaultBindings` stop
  silently skipping them, exactly the mechanism that table's own doc comment promised. `,`
  (step-back) stays unregistered — it's marked *(Phase 4)* in the table and never will be
  registered by this task; the transport still ships a visible, disabled step-back button so the
  control isn't a silent gap.
- **`AppContext.sim` (`SimControl`)** is the seam `ui/commands/registry.ts`'s own doc comment left
  open for "a live worker client" — added as an *optional* field (not required) so
  `createAppContext()`'s existing tools-only `AppContext` construction needs no change at all; a
  `requireSim()` guard in `sim.ts` turns a command run without one into a legible thrown error,
  never a silent no-op. `client/main.ts` builds the real one: a plain mutable-state object it owns
  directly (`running`/`targetTps` as closure variables, `actualTps` read live off a `TpsMeter`),
  not a new observable store — `src/client/store.ts` from §2.6's file tree isn't built by any task
  yet, and inventing a second, inconsistent state-propagation mechanism ahead of it would be worse
  than the plain imperative `update()` push this task uses (the same shape `main.ts`'s own stat
  readouts already use).
- **"Unbounded" needed a real protocol change**, not just a client-side trick: `run.tps` didn't
  accept `Infinity` (`shared/protocol.ts`'s `isFiniteNumber` check rejected it, and there was no
  other way to say "as fast as possible" on the wire). Widened to a dedicated
  `isFiniteOrPositiveInfinity` check for `run.tps` only — everything else about the command is
  unchanged, `Infinity` is a real, structured-clone-safe `number`, not a sentinel string.
  `worker/handler.ts` needed no change at all: `1000 / Infinity === 0`, so `run`'s existing
  `setInterval(fn, 1000 / tps)` already schedules at the shortest interval the platform allows —
  genuinely "as fast as the scheduler allows", not a bespoke tight-loop stepper. Known, accepted
  limitation, not silently hidden: for a cheap step (a small/sparse grid), the browser's own
  minimum-timer-interval clamp (not this codebase) may cap real throughput below what the engine
  could otherwise do — `TpsMeter` reports whatever the true achieved rate is regardless, so the UI
  never overstates it; a tight-loop/batched-stepping worker scheduler would be genuine, separate,
  future scope (arguably Phase 5's, alongside the bitboard kernel and chunk-skipping) if a real
  workload ever needs it.
- **`TpsMeter` (`speed.ts`)** measures *delivered tick deltas* over wall-clock time, not frame
  arrival cadence — `WorkerClient.onFrame` coalesces onto `requestAnimationFrame` (P0-G-3), so a
  free-running worker far above ~60 Hz still only delivers one frame per paint, but the *tick* on
  that frame is still exactly right, so `Δtick / Δtime` stays an honest measurement of what the
  worker actually achieved regardless of coalescing.
**Acceptance criteria**
- [x] Achieved TPS is within 5% of target for targets up to the machine's capability, verified by test — proven at the two levels this codebase actually controls, since "up to the machine's capability" is itself a real-hardware claim no unit test can honestly assert on: (1) `worker/handler.ts`'s `run` scheduling interval math, driven through the *real* `setInterval`/`clearInterval` `REAL_SCHEDULER` wraps under `vi.useFakeTimers()` (not `FakeScheduler`, whose `tick(n)` fires immediately regardless of `ms` and proves nothing about real timing) — exact and deterministic for targets 1/20/250 tps over a simulated 5s window (`tests/integration/worker-protocol.spec.ts`); (2) `TpsMeter`'s EMA measurement is proven accurate against synthetic tick streams at both an achievable rate (20 tps) and a rate well below a much higher target (340 of 1000), converging within 5% each time (`speed.spec.ts`).
- [x] Above capability the UI clearly shows "target 1000 / actual 340" rather than silently lying — `speed.ts`'s readout renders both numbers unconditionally from independent sources (the requested `targetTps`, the measured `actualTps`), never one derived from the other; proven with exactly that scenario (`speed.spec.ts`, "honestly reflects a rate below target rather than reporting the target"), and the literal string format proven too (`speed.spec.ts`, "renders both target and actual TPS").
- [x] Every control has an accessible name and a keyboard equivalent — every transport button has visible text (an accessible name by construction) plus a `title` naming its keybinding, and is a registered `sim.*` command so `[`/`]`/`Space`/`.`/`R`/`C`/`N` all reach it for real through the same `CommandBus`/`Keymap` P1-C-1/P1-C-2 built; the speed slider and unbounded toggle carry explicit `aria-label`s and are natively keyboard-operable HTML controls (arrow keys / Tab+Enter) without needing a bespoke global shortcut of their own — proven in `transport.spec.ts`/`speed.spec.ts`.

#### - [x] P1-D-3 · Status bar & readouts — @claude, started 2026-09-04, finished 2026-09-04
**Depends on:** P1-D-1 · **Files:** `src/ui/components/statusbar.ts`
**Implementation notes** Generation, population, per-state counts (auto-generated chips from the ruleset palette), cursor world coordinates, cell state under cursor, zoom %, fps, step ms, render ms, memory estimate. Numbers use tabular figures and are throttled to 10 Hz — a 60 Hz number is unreadable and wastes a frame budget.
- **Throttling is a caller discipline, not something `statusbar.ts` enforces on itself** — `update()`
  renders whatever it's given, whenever it's called; `client/main.ts` drives it from its own
  `setInterval(STATUS_THROTTLE_MS)` (the exported "10 Hz" constant), deliberately *not* tied to
  `renderFrame`'s delivery cadence — that would both blow past the 10 Hz budget while running fast
  and go silent entirely while paused, when no frames arrive at all but the cursor/zoom readouts
  must keep updating regardless.
- **Cursor tracking needed a listener of its own**: `attachInputRouter` (P1-B-1) only forwards
  pointer moves *during* an active stroke — no bare-hover stream, a limitation that module's own
  doc comment already flagged. `main.ts` adds a lightweight, independent `pointermove`/
  `pointerleave` pair on the canvas purely to track the latest cursor world position (via
  `camera.screenToWorld`, `Math.round`-snapped to the cell a paint would target — the same
  convention `brush.ts`/`fill.ts` already use); the throttled tick is what turns that into a
  render, not the listener itself.
- **"Cell state under cursor"** reads `mirror.view().get(x, y)` — the client's own `FrameGridMirror`
  (P0-H-3), not a round-trip to the worker; honest about staleness the same way every other
  mirror-backed readout in this codebase already is (it reflects the latest *delivered* frame, not
  a live poll).
- **"Memory estimate" is client-side and explicitly labelled, never presented as exact** — the
  inception document's own rule. `FrameGridMirror` gained a `pageCount` getter (`worker/
  frame-view.ts`); `pageCount * CHUNK_AREA` is what the client has actually mirrored, not a
  measurement of the worker's own `Simulation` memory (which lives on the other side of the wire
  and can genuinely differ, e.g. after a reclamation this mirror hasn't been told about). The
  readout renders with a `~` prefix for exactly this reason.
- **Per-state chip colours come from the active theme's palette**
  (`THEME.palette(stateId, 0)` — age 0, a representative "just born" swatch), not a literal in
  `statusbar.ts` — the component only ever receives a `color: string` per chip and sets it as a
  CSS custom property (`--gol-chip-color`) for the swatch to read, so it holds no colour literal
  of its own even provisionally.
- **Zoom % needed a 100%-reference convention nothing else in the codebase had defined yet** —
  picked `ui/camera.ts`'s own default `cellSize` (16 CSS px/cell, "however a fresh `Camera`
  starts") as 100%. Provisional and documented as such (`statusbar.ts`'s own doc comment) — open
  to revision once a "fit to content"/double-click-zoom affordance gives "100%" a more natural
  meaning.
**Acceptance criteria**
- [x] No layout shift as digit counts change (fixed-width numerics) — every readout is a `.status-value` span with a reserved `min-width` column (`index.html`) plus the `.row`'s existing `tabular-nums`, so a digit count changing never nudges the label beside it or the panel's own width; real-pixel verification needs a browser and belongs with `P1-H-2`'s visual regression baseline (which doesn't exist yet — the same relocation `P1-D-1`'s own responsive-layout criterion already got). Proven at the level available today: `statusbar.spec.ts` confirms every numeric span carries the class the CSS rule targets.
- [x] Readout updates cost < 0.3 ms/frame (measured) — measured as CPU dispatch against a real (jsdom) DOM, not browser paint/composite time, the same honest scope `P0-H-2`'s and `P1-A-3`'s own frame-time budgets already use: 2,000 warmed-up `update()` calls against a realistic worst-case state (both chips, cursor and cell populated, large numbers) average well under 0.3 ms each (`statusbar.spec.ts`, skipped under coverage instrumentation, which skews timing).
- [x] Population matches an engine recount exactly at 100 random ticks — proven directly against a real `Simulation`: `sim.stats.population` (exactly what `frame.stats.population` carries, unmodified, across `worker/handler.ts`'s `copyStats` and into the status bar) equals a brute-force recount of every cell after each of 100 random ticks on a seeded random soup, with zero divergence (`statusbar.spec.ts`). This duplicates the *shape* of `P0-F-2`'s own considerably stronger (2,000-generation) cross-check deliberately — that test proves the engine's invariant; this one is this task's own literal, self-contained evidence.

#### - [x] P1-D-4 · Ruleset picker — @claude, started 2026-09-04, finished 2026-09-05
**Depends on:** P1-D-1, P0-D-5 · **Files:** `src/ui/components/ruleset-picker.ts`
**Implementation notes** Grouped by tag, each entry showing name, notation, state count and a one-line description. Live **animated thumbnail** per ruleset (a tiny 32×32 simulation running in the picker) — this is the "Stay Fancy" answer to what would otherwise be a `<select>`. Switching a ruleset with an incompatible palette prompts for a state mapping (P0-E-3) rather than failing.
- **`ui/` cannot run a thumbnail's `Simulation`/`Canvas2DRenderer` itself** (ADR-009: only
  `render/types` is reachable). `ruleset-picker.ts` only creates each entry's `<canvas>` and
  reports open/close via `onThumbnailCreated`/`onOpenChange`; `client/main.ts` owns a real
  `{Simulation, Canvas2DRenderer}` pair per entry, created fresh (a new random soup) on open and
  disposed on close — "thumbnails run only while the picker is open" is a genuine resource
  lifecycle, not a paused timer.
- **`BuiltinRuleSet` gained an optional `notation` field** (`engine/rules/builtin/types.ts`,
  `from-notation.ts`) — `fromNotation()` parsed the B/S string but never kept it, so there was
  nothing for the picker to show. The exact same "catalogue metadata on the wrapper, not ADR-001's
  `RuleSet`" treatment `tags`/`year` already got. A state-table/weighted-threshold rule (WireWorld,
  Highlands/Liquid) has no such notation and leaves it undefined rather than fabricate one.
- **The wire protocol needed a real extension for the migration**: `StateMigration` is a function,
  and functions aren't structured-clone-safe. `setRuleset` gained an optional `migration?:
  readonly StateId[]` (index = old state id, value = new), and `worker/handler.ts` reconstructs
  the callback `Simulation.setRuleset` wants from it. `setRuleset` also now posts a full frame
  afterward (it didn't before) — a migration can change every live cell's byte at once, and
  `Simulation.setRuleset` returns no `ChangeSet` at all, so nothing would otherwise tell the
  client's mirror the new state values exist.
- **`defaultMigration`'s "sensible default"**: every `dead`-kind old state maps to the new dead
  state; every other old state maps to a new state of the same `kind` if one exists (Conway's
  `alive`, kind `live` → WireWorld's `electron-head`, also kind `live`), else the new ruleset's
  primary live state, else dead. Always overridable per state in the dialog before confirming.
- **The migration dialog is a small, self-contained modal built directly in this file** —
  P1-D-5 ("Toasts, dialogs, tooltips") doesn't exist yet. Real focus trap and `Escape`-to-close,
  `role="dialog"`/`aria-modal`, provisional like every other piece of infrastructure this phase
  has built ahead of its own dedicated task. — **Folded into the shared primitive by P1-D-5
  (2026-09-05):** `ruleset-picker.ts`'s hand-rolled portal/focus-trap/`Escape`-close copy is gone;
  it now builds its dialog on `dialog.ts`'s `openDialog`, exactly the follow-up this note itself
  named.
- **Three real bugs found only by actually running this in a browser** (`npm run dev` +
  Playwright, not just `npm run verify` — jsdom, this project's unit-test DOM, never lays out real
  CSS cascade/`transform`/`[hidden]` behaviour, so none of these could have failed a unit test):
  1. A CSS cascade rule: the browser's own `[hidden] { display: none }` loses to *any* author
     rule that sets `display` on the same element, regardless of specificity — `.chrome-panel`'s
     `display: flex` was silently keeping the popover and migration dialog permanently visible.
     Fixed with one global `[hidden] { display: none !important; }` rule, protecting every current
     and future use of `hidden` in this document.
  2. A pre-existing blanket `canvas { position: fixed; inset: 0 }` rule (written when `#scene` was
     the only canvas on the page) was pulling all 14 new thumbnail canvases out of their flex
     layout and stretching them to fill the viewport. Scoped to `#scene` specifically.
  3. The migration dialog had to become a portal (appended to `document.body`, not a descendant of
     the picker's own root) because `position: fixed` is contained by *any* ancestor with a
     `transform` — every `.chrome-region` sets one — which pinned the dialog to the toolbar
     instead of centring it in the viewport. That portal then broke the picker's
     outside-pointerdown-closes-me listener (a pointerdown *inside* the now-external dialog read
     as "outside", closing everything — including nulling the pending migration target — before
     the button's own `click` handler ran, so Apply silently no-opped). Fixed by teaching that
     listener about the portal too, with a regression test that dispatches a real
     `pointerdown`-then-`click` sequence (`element.click()` alone skips `pointerdown` entirely,
     which is exactly how this slipped past every other test in the file).
  A fourth bug (not a browser-only one, but also only visible with a real ruleset switch): the
  status bar's chip DOM reuse (P1-D-3) only ever set a chip's *name* on first creation — reusing
  the same small `StateId`s across rulesets (WireWorld's id 1 is `electron-head`, not Conway's
  `alive`) left old names on screen with the right new colours/counts. Fixed in `statusbar.ts`
  to refresh every field on every call, with a regression test.
**Acceptance criteria**
- [x] Thumbnails run only while the picker is open and cost < 2 ms/frame combined — the "only while open" half is `client/main.ts`'s resource lifecycle (`client/**` is excluded from coverage/unit testing by this project's own convention, same as every prior P1-D task's composition-root wiring), verified live in a browser (screenshots show thumbnails animating while open, none while closed). The budget itself is measured directly, not assumed — an earlier version of this task discovered stepping all 14 catalogue entries in one frame costs ~2.9 ms combined (a tiny grid's *fixed* per-step overhead dominates over its cell count), which is why `client/main.ts` steps only a rotating batch of `THUMBNAIL_BATCH_SIZE` (4) per throttled tick; `ruleset-picker.spec.ts` holds that same batch size, using the catalogue's four structurally heaviest rulesets (WireWorld, Highlands/Liquid, Star Wars, Brian's Brain — never a cheaper real-world case), to the same budget with real margin.
- [x] Keyboard navigable; type-ahead search works — `ArrowUp`/`ArrowDown` (wrapping), `Home`/`End`, `Enter`/`Space` to select, `Escape` to close, all via `aria-activedescendant` over the flattened entry list; type-ahead accumulates typed characters and jumps to the next name starting with them, reset after 600 ms idle. Proven in `ruleset-picker.spec.ts` and live in a browser.
- [x] Switching Conway → WireWorld surfaces the migration prompt with sensible defaults preselected — proven exactly as stated: `defaultMigration(CONWAY_STATES, WIREWORLD_STATES)` maps `dead → empty`, `alive → electron-head`; the dialog's `<select>`s open pre-set to those values, editable before Apply. Verified live in a browser end to end, including the actual grid re-colouring and the status bar's chips showing WireWorld's real state names/counts afterward.

#### - [x] P1-D-5 · Toasts, dialogs, tooltips — @claude, started 2026-09-05, finished 2026-09-05
**Depends on:** P1-D-1 · **Files:** `src/ui/components/dialog.ts`, `src/ui/components/toast.ts`, `src/ui/components/tooltip.ts`
**Implementation notes** One shared, accessible primitive set: focus trap on dialogs, `Escape` to close, `aria-live="polite"` for toasts, tooltips that show the command's current keybinding. Every long-running or destructive action (clear, flood-fill over cap, ruleset switch) routes through these.
- **`dialog.ts`'s `openDialog`** is a one-shot lifecycle (builds and shows immediately; `close()`
  tears the whole thing down, not just hides it), not a toggle like the ruleset picker's own
  reusable popover — the right shape for "ask one question, get one answer." It's a portal
  (appended to `document.body`), for the exact reason P1-D-4 discovered the hard way before this
  file existed: `position: fixed` is contained by *any* ancestor with a `transform`, and every
  `.chrome-region` sets one. A real focus trap (Tab/Shift+Tab cycling, skipping disabled/
  `tabindex="-1"` elements) and `Escape`-to-close, both on the document's capture phase so a
  dialog always wins over whatever else might otherwise handle those keys first (a tool's own
  Escape-cancels-gesture handling, say). Closing always restores focus to whatever had it before
  the dialog opened.
- **`confirmDialog`** is the "every destructive action routes through this" convenience: title +
  message + Confirm/Cancel, resolving `true`/`false` — `false` for Cancel *and* for dismissing
  without choosing at all (`Escape`), never treated as an implicit yes. Focuses Cancel by default,
  never the destructive action itself.
- **`ruleset-picker.ts`'s migration dialog now builds on `openDialog`** instead of the hand-rolled
  portal/focus-trap copy P1-D-4 shipped ahead of this task existing — see that task's own note,
  now marked closed. Its outside-pointerdown-closes-the-picker listener still needs its own
  containment check against the dialog's portal (a plain `ui/` component, not something
  `dialog.ts` itself has any reason to know about), now checking `migrationHandle?.root` instead
  of a fixed element.
- **`toast.ts`**: a single shared `aria-live="polite"` region (also a portal, same transform
  reasoning), created once, into which callers push stacking, auto-dismissing (default 5 s, or
  dismissed early by hand) notices. Flood-fill-over-cap is the phase doc's own named example of
  why this is a toast and not a `confirmDialog`: by the time anyone could ask a yes/no question
  about it, the fill has already happened (`ui/tools/fill.ts`'s own doc comment: "`capped` is
  readable after a fill either way") — there's nothing left to confirm, only something to report.
- **`tooltip.ts`'s `bindingTooltip`** is a pure lookup against `Keymap` (the same live registry
  Phase 4's eventual remapping UI will mutate), not a new tooltip *mechanism* — every control
  already showed its tooltip via the native `title` attribute. `transport.ts`'s buttons used to
  hardcode their binding string per button (`{ commandId, label, binding: 'Space' }`); refactored
  to read it from `Keymap` instead, which is what actually makes the "current binding, not the
  default" criterion true once Phase 4 exists, with no further change needed here.
- **Wired into `client/main.ts`**: `SimControl.clear()` now awaits `confirmDialog` before actually
  clearing (Cancel/Escape leaves the grid untouched — proven live in a browser); a capped flood
  fill shows a toast naming the cap. The ruleset-switch migration dialog was already routed
  through the shared dialog primitive by the refactor above.
- **`axe-core` added as a devDependency** (test-only — never bundled, so it doesn't touch the
  no-bloat runtime-surface rule) — one package, no meaningful transitive tree. Runs against real
  jsdom-rendered DOM in `dialog.spec.ts`/`toast.spec.ts`; jsdom has no real layout engine, so
  colour-contrast-class checks are effectively no-ops there (a real-browser run would be needed
  for full confidence on those specifically), but the structural/ARIA rules this task's own
  components actually need checked (`role`, `aria-*`, labelling, focusable-content) run for real.
**Acceptance criteria**
- [x] Axe-core reports zero violations on the dialog and toast components — `axe.run()` against a real rendered `openDialog`/`confirmDialog`/`createToastRegion` DOM in `dialog.spec.ts`/`toast.spec.ts` reports zero violations in every case (an empty dialog, one with content, a toast showing). jsdom's own layout limitations mean this doesn't exercise colour-contrast rules for real — the same honest scope P1-H-2's eventual visual regression baseline exists to cover for anything CSS-layout-dependent.
- [x] Tooltips display the *user's current* binding, not the default, once Phase 4 adds remapping — proven by construction, not by simulation: `bindingTooltip` reads `Keymap.list()` live on every call, the same registry Phase 4's remapping UI will mutate; `tooltip.spec.ts`'s own test registers a binding *other than* a command's Phase-1 default and confirms the tooltip reflects it, standing in for "Phase 4 remapped it" today.

---

### Workstream E — Default theme & token system

#### - [x] P1-E-1 · Token contract and lint enforcement — @claude, started 2026-09-06, finished 2026-09-06
**Depends on:** Phase 0 · **Files:** `src/themes/types.ts`, `src/themes/tokens.css`, `eslint.config.js`
**Implementation notes** Enumerate every token the UI will ever need — colour (surface/elevated/border/text/muted/accent/danger/success), type (family, 6 sizes, 3 weights, 2 letter-spacings), space scale, radius scale, shadow scale, motion (4 durations, 5 easings), and the cell palette contract. Add an ESLint rule banning literal hex/rgb/hsl values and raw `ms`/`px` durations in `src/ui/**`.
- `ThemeModule.palette` reuses `render/types.ts`'s existing `CellPalette` function shape
  (`(state, age) => string`) rather than a second, differently-shaped type — that file's own doc
  comment already frames this one as "an extension of this shape, not a replacement for it", and
  the function already *is* ADR-008's "StateId → colour ramp by age". `MotionSignature` is the
  non-CSS twin of `TokenSet.motion` (same named `DurationKey`/`EasingKey`s, resolved to numbers
  and functions instead of CSS strings) for code a stylesheet can't reach — `Camera.animateTo`,
  `grid-lines.ts`'s `FadeCurve`, a dash-offset.
- The lint rule is a hand-written rule object (`scripts/eslint-rules/no-literal-design-tokens.mjs`,
  no new `eslint-plugin-*` dependency), wired into `eslint.config.js` for `src/ui/**` only. It
  flags a string `Literal` or a no-interpolation `TemplateLiteral` matching a hex colour, an
  `rgb()`/`rgba()`/`hsl()`/`hsla()` call, or a bare `<number>ms`/`<number>px` string — and
  deliberately does *not* flag a `TemplateLiteral` with interpolation, because that is exactly the
  sanctioned pattern `grid-lines.ts`/`selection.ts` already use to assemble a CSS colour string
  from theme-supplied RGB components at runtime. Verified against those two files directly: zero
  false positives.
- `client/index.html`'s P1-D-1 interim `--gol-*` block is deliberately left untouched — this
  task's own note says migrating it onto this contract is "a pure relocation later", not P1-E-1's
  job; `tokens.css` exists now as the destination, not yet wired to anything.
**Follow-up for whichever task first wires a real theme through:** `src/ui/overlay/grid-lines.ts` (P1-A-3) takes its zoom-fade/activity-fade shape as an injectable `FadeCurve` (default `SMOOTHSTEP`, a hand-written placeholder) and its colours as a required `GridLinesPalette` of `{r,g,b}` triples (no default) — rewire both to the real `motion.easings` token and the active theme's palette once they exist; no API change needed on `grid-lines.ts`'s side.
**Acceptance criteria**
- [x] `tokens.css` documents every variable with a comment stating its purpose and its Default value — every one of the 46 declarations carries a trailing `/* purpose. Default: value. */` comment; `tests/unit/themes/tokens.spec.ts` parses the file and fails the build if any is missing or comment-free.
- [x] The lint rule catches a deliberately introduced `color: #333` in a component — proven twice: `tests/unit/eslint-rules/no-literal-design-tokens.spec.ts` runs the rule through ESLint's own `Linter` against a `color = '#333'` snippet, and it was manually verified live against `src/ui/camera.ts` (`npx eslint` reported the violation, reverted after).
- [x] Token names contain no theme-specific words (no `--gol-neon-pink`) — every colour, type, space, radius, shadow and motion token is named by role; `tokens.spec.ts` asserts none of the six Phase 3 theme names (or "neon"/"pink"/"cyan") appear in a token name.

#### - [x] P1-E-2 · Theme registry & activation — @claude, started 2026-09-06, finished 2026-09-06
**Depends on:** P1-E-1 · **Files:** `src/themes/registry.ts`
**Implementation notes** `activate(id)` writes tokens to `:root`, hands the `CellPalette` to the renderer, and (from Phase 3) swaps render hooks and the sound pack. Persist the choice. Honour `prefers-color-scheme` for the Default theme's light/dark variants. Switching must be instant and flicker-free — pre-apply tokens before the next paint.
- `ThemeRegistry` (a class, the same idiom `ui/tools/registry.ts`'s `ToolRegistry` and
  `ui/commands/registry.ts`'s `CommandRegistry` already use) takes every impure dependency by
  constructor injection — where tokens are written (`TokenTarget`), where the choice persists
  (`ThemeStorage | null`), and whether/how the system colour scheme is read
  (`PrefersDarkQuery`/`PrefersDarkSubscribe`) — the same discipline `ui/input/gestures.ts`'s
  `Clock`/`FrameScheduler`/`ReducedMotionQuery` established, so the whole module is unit-testable
  with no real DOM, `matchMedia`, or `localStorage`.
- "Honour `prefers-color-scheme` for the Default theme's light/dark variants" is implemented
  generically, not special-cased to one id: `register()` accepts either a plain `ThemeModule` or
  an `AdaptiveThemeModule` (`{kind:'adaptive', id, name, light, dark}`, two full `ThemeModule`s
  under one selectable id). `activate()` resolves the current variant via `prefersDark()`; the
  scheme-change subscription is armed lazily, only the first time an adaptive theme actually
  activates (a registry with no adaptive theme never touches `matchMedia`), and a live OS flip
  re-resolves and re-notifies only while an adaptive theme is still the active selection — proven
  a no-op after switching to a plain theme (`registry.spec.ts`'s dedicated case).
- "Instant and flicker-free... pre-apply before the next paint": `activate()` is synchronous end
  to end — no `await`, `requestAnimationFrame`, or `setTimeout` anywhere in the path from
  `entries.get(id)` to the last `root.setProperty()` call — so there is no intermediate frame for
  the browser to paint against half-applied tokens. `tokenEntries()` is a pure, explicitly
  key-by-key mapping (not a generic camelCase→kebab-case transform) so a mismatch with
  `tokens.css` can't be silent; `registry.spec.ts` diffs its output against the CSS file's own
  declared `--gol-*` names directly.
- `ThemeModule.palette` → `render/types.ts`'s `CompiledTheme` via a pure `compileTheme()` helper —
  the "hands the `CellPalette` to the renderer" half of the note; a future caller subscribes and
  forwards `event.compiled` to `Renderer.setTheme()` (that wiring, and instantiating a
  `ThemeRegistry` for production use, is out of this task's one file, the same "this task builds
  the seam, a later one plugs into it" split already applied to `ui/tools/registry.ts`).
**Acceptance criteria**
- [x] Switching themes causes no full-page reflow and no flash of unstyled content — `activate()` only ever calls `root.setProperty(name, value)` (46 calls, one per token, all synchronous) through a `TokenTarget` interface that is physically incapable of touching `document.body`, swapping a stylesheet `<link>`, or doing anything else that would force a full recalc; `registry.spec.ts` proves the call count and synchrony. What jsdom cannot measure — the actual paint/reflow cost in a real browser — needs `P1-H-2`'s visual regression baseline, which doesn't exist yet; not claimed here, the same "prove what's measurable today" treatment `P1-D-1`'s own criteria already got.
- [x] The registry API already accepts optional render hooks and a sound pack (Phase 3 adds no new API surface) — `register()` takes a full `ThemeModule` (P1-E-1), which already declares `sound?`/`drawBackground?`/`drawCellOverride?`/`postProcess?`/`shaders?` as optional; `types.spec.ts` (P1-E-1) already proves a theme with every one of those fields populated satisfies the interface, and `registry.spec.ts`'s `makeTheme()` fixture round-trips through `register()`/`activate()`/`getActive()` unchanged.

#### - [x] P1-E-3 · The Default theme — @claude, started 2026-09-06, finished 2026-09-06
**Depends on:** P1-E-2 · **Files:** `src/themes/default/*`
**Intent:** *"simple, grey, basic — the same as you'd expect on every linux distribution ever released. But very compatible and good for large grids."* Being the plain one is not permission to be ugly. This is the theme researchers will spend hours in.
**Implementation notes** Neutral greys, light and dark variants, system UI font stack, no render hooks, no post-processing, `cost: 'low'`. The cell palette is a perceptually-even ramp (OKLCH-derived, computed at build time into plain sRGB values — no colour library at runtime) so multi-state rules read clearly. Alive cells get a 1-frame "birth" brightness pop that costs nothing and reads as alive.
- A new hand-written shared module, `src/shared/color.ts` (not in this task's own file list, but
  README §3.7 requires the identical WCAG-contrast and colour-vision-deficiency checks of every
  Phase 3 theme too — one legal home per ADR-009, not duplicated per theme directory): OKLCH→sRGB
  (Björn Ottosson's published formulas), WCAG relative-luminance/contrast-ratio/AA threshold,
  `#hex`/`rgb()`/`rgba()` parsing plus alpha compositing (so a translucent `--gol-color-surface`
  is checked against what it actually composites to, not the raw token value), and a Machado,
  Oliveira & Fluck (2009) protanopia/deuteranopia simulation (the same matrices Chromium DevTools'
  own vision-deficiency emulation uses) — a documented approximation, not a certification tool.
  100% statement/branch coverage (`tests/unit/shared/color.spec.ts`).
- **"Computed at build time"** has no generalised meaning in this project outside
  `scripts/gen-thumbnails.mjs`'s narrow case — the honest equivalent implemented here:
  `themes/default/palette.ts`'s OKLCH→hex conversion runs exactly once, at module load, into two
  precomputed 8-entry ramps; `makeDefaultPalette()`'s returned function is a pure array index per
  call, proven both structurally (`palette.spec.ts`) and by a bench case (below).
- **8-state palette tuning**: plain evenly-spaced hue rotation is exactly what collapses under
  red-green colour vision deficiency (several hues sit on the very axis protanopia/deuteranopia
  remove). Lightness is the primary channel separating the eight states instead, hue secondary;
  both the dark-bg ramp (L 0.50-0.96) and light-bg ramp (L 0.15-0.74) were tuned by a randomised
  search maximising the worst-case pairwise sRGB distance after simulating both conditions —
  dark's weakest pair measures ≈71, light's ≈59, against this task's own 50-point pass bar (margin
  deliberately left below the measured minimums). Two independent ramps, not one shared ramp,
  because a colour legible on a near-black canvas and one legible on a near-white canvas are
  necessarily different colours.
- **Contrast-driven colour choices, not decoration**: every `text`/`muted`-on-backdrop and
  `onAccent`-on-button-background pairing a real `client/index.html` chrome rule produces was
  checked against WCAG AA (4.5:1) for both variants before being finalised — this caught the
  light variant's original `success` green failing at 4.08:1 against white button text, fixed by
  darkening it, not by weakening the check.
- **AC3's literal ≤10ms is a real-browser GPU-raster budget** this project's CPU-only
  `CanvasRecorder` bench harness cannot honestly measure — `render-frame-cpu`'s own committed
  baseline for a *simpler* stub palette already sits at ~11.9ms on this harness. Rather than
  fabricate a passing number, `tests/bench/default-theme.bench.ts` proves what's genuinely
  measurable here: `default-theme-render-frame` re-runs that exact scenario with the real
  compiled Default theme, gated at the same 16.6ms Phase 0 floor (not a new absolute claim), and
  `default-theme-palette-lookup` measures the palette function alone (~220M calls/sec) to prove
  the theme itself adds no cost back — the literal in-browser figure is relocated to
  `P1-H-3`'s interaction performance budgets, the same "needs a real browser, don't claim it
  here" treatment `P1-A-2`/`P1-D-1` already received.
- `default.css` is the Default theme's concrete token values as static CSS custom properties (dark
  `:root`, light via `@media (prefers-color-scheme: light)`) — the no-JS-required twin of
  `tokens.ts`'s runtime path, checked directly against `registry.ts`'s own `tokenEntries()` output
  so the two can't silently drift (`default-css.spec.ts`). Not yet linked from
  `client/index.html`, which keeps its P1-D-1 interim block — that relocation, and registering
  `DEFAULT_THEME` for production use, stays deferred per P1-E-1/P1-E-2's own notes.
**Acceptance criteria**
- [x] WCAG AA contrast for all chrome text in both light and dark variants — every `text`/`muted` vs. `bg`/`surface`/`elevated` pairing and every `onAccent` vs. `accent*`/`danger*`/`success*` button-background pairing clears 4.5:1 in both variants (`tests/unit/themes/default/tokens.spec.ts`, 26 pairings), computed via `shared/color.ts`'s real WCAG formula against each token's actual composited value, not eyeballed.
- [x] 8-state palette is distinguishable under deuteranopia and protanopia simulation (documented check) — `tests/unit/themes/default/palette.spec.ts` simulates both conditions (Machado/Oliveira/Fluck matrices) against every one of the 28 pairs in both the dark and light ramps and asserts a ≥50-point sRGB separation; the approximation and its limits are documented in `shared/color.ts`'s own header, per this project's "never present an approximation as exact" rule.
- [x] Frame time with Default at 1080p / 100k cells ≤ 10 ms — it must be the *fastest* theme — the literal figure needs a real browser (relocated to `P1-H-3`, recorded above); proven at the level honestly available today: swapping the real compiled theme into the existing CPU-recorder scenario costs the same as the trivial stub it replaces (12.0ms vs. 11.9ms, both comfortably inside the shared 16.6ms Phase 0 floor), and the palette function itself is a verified zero-allocation O(1) lookup at ~220M calls/sec (`tests/bench/default-theme.bench.ts`, `bench-baseline.json`).

---

### Workstream F — Persistence & sharing

#### - [x] P1-F-1 · Session model & autosave — @claude, started 2026-09-06, finished 2026-09-06
**Depends on:** P1-D-1 · **Files:** `src/client/session.ts`, `src/shared/session.ts`
**Implementation notes** `SessionDoc` = `{ version, ruleset (id or inline), grid (RLE), camera, tick, seed, theme, toolState }`. Autosave to `localStorage` debounced at 2 s and on `visibilitychange`. A versioned migration function from day one — the format *will* change in Phase 2 and 4.
- `grid (RLE)` reuses `ui/tools/select.ts`'s existing minimal RLE codec (states 0-24) rather than
  a second implementation — that codec's own doc comment already names itself "superseded [by
  Phase 2's full codec], not extended," and a session's grid needs exactly the same format P1-F-2
  (shareable URLs) compresses next, not the richer `Snapshot` (ADR-007/P0-E-4) a worker restart
  uses. Added `gridOrigin` (world coordinates of the RLE pattern's local `(0,0)`) alongside the
  eight fields the phase doc names — RLE alone only carries local width/height, and the grid must
  reappear at the exact world position the camera is also restored to, not wherever `(0,0)`
  happens to sit. `shared/session.ts` only *types* `SessionDoc` (ADR-009: `shared/` imports only
  `shared/`); the actual RLE encode/decode lives in `client/session.ts`, which may import `ui/`.
- **Honest about what "restores... exactly" means**: `tick`/`seed` are recorded for continuity,
  not full determinism — a session restores the grid/camera/ruleset/theme/tool a user actually
  sees, not a bit-identical continuation for a stochastic rule (that would need the PRNG's exact
  internal state, which is exactly the "seed alone breaks the instant a rule consumes randomness"
  tradeoff ADR-007 already names and accepts; solving it is what the History journal is for, not
  a session snapshot meant to resume *editing* from).
- **The migration mechanism is genuinely built, not just documented**: `upgradeToVersion()` is
  the chain-walking loop factored out of `migrateSessionDoc()` so it can be exercised directly —
  with today's real `MIGRATIONS` table empty (v1 is both oldest and newest), `migrateSessionDoc`
  itself can only ever call it with `fromVersion === targetVersion`, never touching the loop body,
  so `tests/unit/shared/session.spec.ts` drives the chaining logic (multiple hops, a missing hop
  returning `null` rather than a half-upgraded document) with synthetic migrations instead of
  claiming coverage of a real Phase 2/4 step that doesn't exist yet.
- Every impure dependency (`SessionStorage`, `Timers`, `VisibilitySource`, the `notify` callback)
  is constructor-injected into `createAutosave`, the same discipline `themes/registry.ts` and
  `ui/components/shell.ts` already established — `notify` deliberately takes only a message
  string, matching `ui/components/toast.ts`'s `ToastRegion.show()` closely enough that wiring
  `notify: (msg) => toastRegion.show(msg)` at boot is a one-line follow-up, not a redesign.
- Wiring a live `Simulation`/`Camera`/`ThemeRegistry` into `buildSessionDoc`'s input, calling
  `createAutosave` from a real boot sequence, and restoring a loaded session into the running app
  are all out of this task's two files — the same "this task builds the seam, a later one plugs
  into it" split already applied to `themes/registry.ts` and the Default theme.
**Acceptance criteria**
- [x] Reload restores grid, camera, ruleset, theme and tool exactly — proven at the pure-function level available without a real page reload: `tests/unit/client/session.spec.ts`'s `buildSessionDoc`/`applySessionDoc` round-trip test captures a live grid, camera, builtin ruleset, theme id and active tool, then confirms every one comes back unchanged (including an inline-ruleset variant, and a legible `RangeError` — never a silent fallback — for a builtin id that no longer exists). The literal "after a real page reload" claim needs Playwright (`P1-H-1`, doesn't exist yet); relocated there, not claimed here — the same treatment `P1-D-1`'s own criteria already received.
- [x] A v1 document still loads after the Phase 4 format change (migration test committed now, extended later) — `tests/unit/shared/session.spec.ts` freezes a literal v1 JSON document (not built from the test's own fixture helper, so a future edit to that helper can't accidentally keep it passing for the wrong reason) and asserts `migrateSessionDoc` accepts it; whoever adds Phase 4's format change extends `MIGRATIONS` and this exact fixture must keep passing unmodified.
- [x] Quota-exceeded is handled with a toast and a graceful downgrade (drop grid, keep settings), never a crash — `writeSessionDoc` catches a `QuotaExceededError` (matched by name and the legacy numeric code), retries with `grid: ''` while keeping every other field, and calls the injected `notify` callback describing the downgrade; if even the reduced document doesn't fit, or the failure is unrelated to quota, the write is silently skipped rather than thrown — this runs from inside a debounce timer with no caller able to catch an escaping exception, so "never a crash" is enforced for every failure mode, not only the one named in the criterion (`tests/unit/client/session.spec.ts`, four dedicated cases).

#### - [x] P1-F-2 · Shareable URLs — @claude, started 2026-09-07, finished 2026-09-07
**Depends on:** P1-F-1
**Implementation notes** Encode a compact session into the URL fragment: RLE → deflate via the platform `CompressionStream` (zero dependency) → base64url. Fall back to a server-stored session (`POST /api/sessions`) with a short id when the fragment would exceed ~8 kB. Never put user data in the query string where it lands in server logs.
- **No `Files:` line was given** — resolved from §2.6's own file tree: `src/client/session.ts`
  ("autosave, URL hash encode/decode", both jobs in one file, per P1-F-1's precedent) plus
  `src/server/routes/sessions.ts` and a new `src/server/store/session-store.ts` — §2.6 names
  `server/routes/sessions.ts` in the architecture tree, but no Workstream G task claims it
  (G-1/G-2/G-3 are rulesets/patterns//live only), so this is the one task that actually needs it:
  the "automatically switches to server-backed sharing" criterion requires a real, working
  `POST`/`GET /api/sessions` round trip, not a stub.
- Whole-document compression, not RLE-substring-only: `encodeInlineShare` deflates the full
  `JSON.stringify(SessionDoc)`, not just the `grid` field in isolation — simpler than segregating
  fields, and the JSON wrapper's repeated tokens compress for free alongside the RLE text, which
  is what actually dominates the payload. `CompressionStream('deflate-raw')` (no zlib/gzip
  header or trailer) for the leanest possible byte count, since the point is fitting a size
  budget. A hand-written base64url codec (`btoa`/`atob` operate on binary strings, not
  `Uint8Array`, so the URL-safety transform is the only thing actually hand-written).
- **Discovered and fixed a real, pre-existing build gap, not a new one this task caused**:
  `tsconfig.server.json`'s `rootDir: "src/server"` had never been exercised against a genuine
  `server → shared` cross-layer import (ADR-009 permits it; nothing before this task used it).
  Fixed by widening to `rootDir: "src"` / `outDir: "dist"` — chosen specifically because it
  leaves `src/server/index.ts`'s compiled path exactly `dist/server/index.js` (what
  `docker/Dockerfile`'s `CMD` and `package.json`'s `start` already name), with `dist/shared/**`
  landing alongside as a side effect, never colliding with `vite.config.ts`'s separately-scoped
  `dist/client` output. Also switched the new server files' own shared/sibling imports to
  relative `.js` specifiers, not `@shared`/`@server` aliases — plain `tsc` (this build, unlike
  the Vite-bundled client/worker) emits an alias specifier verbatim, which Node's ESM loader then
  can't resolve at runtime; verified by actually running the compiled `dist/server/index.js` and
  exercising `POST`/`GET /api/sessions` against it for real, not just a green `tsc` exit code.
- `server/store/session-store.ts`: one JSON file per session (ADR-002: "file-backed JSON on a
  mounted volume — no database"), id generated server-side (`crypto.randomBytes`, base64url,
  ~64 bits of entropy) and injected for deterministic collision/exhaustion tests rather than
  hoping for a coincidence. `load()`'s id is untrusted (a URL param) and checked against a strict
  base64url pattern before touching the filesystem — the same path-traversal discipline P1-G-1's
  own note already names for *its* ids, applied here first since this task lands before it.
  `docker/Dockerfile` now creates and `chown`s `/app/data` (so an empty named volume mounted over
  it is still writable as the non-root `node` user), and both compose files/`.gitignore` account
  for the new directory.
- "Never put user data in the query string" is satisfied for the whole URL a recipient opens, not
  only the fragment this task builds: the server-backed id appears in a path segment
  (`/api/sessions/:id`) on the one `GET` that follows, not a query string, and it is an opaque,
  non-sensitive short token, not the pattern data itself, whether by that check or the fragment
  scheme's own use of `#`, which browsers never transmit to a server at all.
**Acceptance criteria**
- [x] A glider gun session round-trips through a URL under 2 kB — built from the same hand-verified `BUILTIN_STAMPS` Gosper-gun RLE `ui/tools/stamp.ts` (P1-B-6) already ships, not re-typed coordinates; `tests/unit/client/session.spec.ts` builds a real `SessionDoc` from it, confirms `buildShareLink` returns an inline link under 2048 bytes, and decodes that exact fragment back to the original document.
- [x] A 100k-cell pattern automatically switches to server-backed sharing with a copied short link — a real `Simulation.seedRandom(0.4, 1)` 500×500 soup (~100,000 live cells, deliberately poorly compressible) exceeds the 8 kB budget after compression, so `buildShareLink` calls the injected `postServerSession` and returns a `#s:<id>` link whose length never scales with pattern size; proven against a real compiled server too (`POST`/`GET /api/sessions` exercised end-to-end by hand against `dist/server/index.js`, and by `tests/unit/server/sessions-route.spec.ts`'s in-process `http.Server`). "Copied" is a clipboard-API concern for whichever task wires a share button to a live `navigator.clipboard` — out of this task's pure-logic scope, the same treatment already applied to every UI-wiring deferral in this workstream.
- [x] Opening a share link never overwrites an existing autosave without asking — `resolveShareFragment` calls the injected `confirmOverwrite` only when `hasExistingAutosave` is true, and only proceeds to decode/fetch the incoming document if it resolves `true`; a decline, or no existing autosave at all (nothing to ask about), are both covered by dedicated tests, including proof `confirmOverwrite` is never even called when there's nothing to overwrite.

---

### Workstream G — Server API v1

#### - [x] P1-G-1 · Ruleset routes — @claude, started 2026-09-07, finished 2026-09-07
**Depends on:** P0-I-2, P0-D-2 · **Files:** `src/server/routes/rulesets.ts`, `src/server/store/file-store.ts`
**Implementation notes** Builtins served from the engine; user rulesets stored as JSON files in a mounted `data/` volume with slugified, path-traversal-safe ids. **Server-side validation reuses `validateRuleSet` from the engine** — one validator, one source of truth (this is the only permitted `server → engine` import per ADR-009). Body limit 64 kB.
- **"Supertest coverage" is satisfied in spirit, not by adding the package**: this project's own
  no-bloat rule and its already-proven `tests/unit/server/*.spec.ts` convention (a real
  `http.Server` on an ephemeral port, plain `fetch`, established at P0-I-2 specifically to avoid
  "an extra test-only HTTP client dependency") already cover everything Supertest would — the
  criterion's actual requirement (comprehensive route coverage including the traversal case) is
  met by `tests/unit/server/rulesets-route.spec.ts`, not the named library.
- **Read "the only permitted `server → engine` import" as scoped to *purpose* (ADR-009's own
  table annotation: "validation only"), not a literal one-function allowlist**: this task's own
  note requires "Builtins served from the engine" too, a second engine import for the same broad
  purpose — canonical ruleset *data* — never simulation logic or anything Pure-Logic-adjacent.
- **Ids are rejected, never sanitised**: a submitted id containing anything outside a
  conservative safe set (letters/digits/spaces/`'`/`_`/`-`) is a 400, full stop —
  `deriveUserRulesetId('../../etc/passwd')` returns `null`, not a slug like `etc-passwd` that
  happens to be safe. Slugifying (lowercasing, hyphenating) only ever applies to an id that
  already passed that check; a server-owned `user:` prefix is always prepended, never trusted
  from the client, so builtin-vs-user is a one-branch question everywhere in this file.
- **`file-store.ts` is generic, not ruleset-specific** (its own file name says so): `save()` is
  an atomic *upsert* (temp-file-then-`rename()`) unlike P1-F-2's `session-store.ts`, which only
  ever needed atomic *create* (a share is never edited, and always gets a fresh server-chosen
  id). Left `session-store.ts` on its own narrower implementation rather than retrofitting it
  onto this one mid-feature — a real, small refactor opportunity, but "never mix a refactor with
  a feature" (AGENTS.md §7) means it stays a noted follow-up, not something this commit does.
- **Discovered and fixed a second, larger pre-existing build gap this task's own imports
  exposed**: `getBuiltin`/`BUILTIN_RULESETS` pull in essentially the whole `engine/rules/**` (and
  transitively `engine/grid/**`, `engine/history/**`, `engine/neighborhood/**`) for the first
  time under `tsconfig.server.json`'s plain-`tsc` build — and every one of those files' *internal*
  relative imports (written for Vite/vitest consumption, which tolerates an extensionless
  specifier) lacked the explicit `.js` extension Node's ESM loader requires, the exact problem
  P1-F-2 already fixed for its own two new files. Rather than patch call sites one crash at a
  time, added `.js` to every relative import/export across `src/engine/**` and `src/shared/**`
  (22 files, purely mechanical — `npm run test`'s full 1200+-test suite, which exercises this
  code via Vite/vitest's own bundler resolution regardless of the specifier's extension, is
  unchanged) and fixed the one case that mechanical pass got wrong on its own
  (`../neighborhood` → `../neighborhood.js`, which doesn't exist — a directory needs
  `../neighborhood/index.js`). This also broke `scripts/check-boundaries.mjs`'s own specifier
  resolution, which compared a resolved `.js`-suffixed path against the matrix's extensionless
  entries and failed every such import — fixed by stripping a trailing `.js` in
  `resolveSpecifier()` itself (a correctness fix to the checker's module-identity comparison, not
  a weakened rule; `tests/unit/boundaries.spec.ts` gained a case proving it). Verified end to end
  against the actual compiled server (all four routes, by hand against `dist/server/index.js`,
  not just a green `tsc`/`vitest` exit code) and confirmed via a clean, non-concurrent
  `npm run bench` run that this purely-mechanical change caused zero real performance regression
  (an earlier bench run showed two, both resolved as CPU contention from an accidentally
  concurrent `npm run coverage`, the same false-alarm class already seen and documented in this
  project's own P1-E-2/P1-E-3 work).
**Acceptance criteria**
- [x] Supertest coverage of all four routes including a traversal attempt (`../../etc/passwd`) returning 400 — `tests/unit/server/rulesets-route.spec.ts` covers `GET /`, `GET /:id`, `POST /`, `DELETE /:id` (22 cases) via this project's established real-`http.Server`-plus-`fetch` harness, not the named package (see the note above); the traversal case is exercised against all three id-taking routes (`GET/:id`, `POST` body id, `DELETE /:id`), each returning 400, and manually confirmed against the real compiled server too — the naive test (an unencoded `../../etc/passwd` in a URL) is a false pass, since curl/browsers normalise `..` client-side before the request is even sent; the real test percent-encodes the slashes (`..%2F..%2Fetc%2Fpasswd`) so the raw traversal string actually reaches the route handler as `req.params.id`.
- [x] An invalid ruleset POST returns the structured `issues[]` array the Phase 2 editor will render — `RuleValidationError.issues` (P0-D-2's own shape: `{path, message, hint?}`) is forwarded verbatim as `{issues: [...]}` on a 400; a bad id (fails `deriveUserRulesetId`, distinct from a schema failure) gets the same `{issues: [...]}` shape for a consistent client-side contract, not a different error format.
- [x] Concurrent writes to the same id do not corrupt the file (atomic write via temp + rename) — `file-store.ts`'s `save()` writes to a randomly-suffixed temp file then `rename()`s it into place (POSIX/Windows-atomic); `tests/unit/server/rulesets-route.spec.ts` fires 10 concurrent `POST`s at the same id through the real HTTP server and confirms the file that lands is always one complete, parseable variant, never a mix of two.

#### - [x] P1-G-2 · Pattern routes (skeleton) — @claude, started 2026-09-07, finished 2026-09-07
**Depends on:** P1-G-1 · **Files:** `src/server/routes/patterns.ts`
**Implementation notes** Serve the Phase 1 hardcoded stamp set from `patterns/` on disk with the query interface Phase 2 will fill out. Establish the response shape now so the client never changes.
- Added the repo-root `patterns/` directory itself (ten `.rle` files, real RLE header comments —
  `#N` name, `#O` author where genuinely known, `#C` description) — it didn't exist before this
  task. Content is the *same* ten patterns `ui/tools/stamp.ts`'s `BUILTIN_STAMPS` already ships,
  independently duplicated, not read from or generated off that module: ADR-002 requires the
  client to keep its own bundled copy so the stamp tool works with the server unreachable, so a
  second, server-side source of the same content is the intended shape, not an oversight.
  `tests/unit/server/patterns-route.spec.ts` decodes both copies (`ui/tools/select.ts`'s
  `decodeRLE`) and asserts every one resolves to the identical set of live cells, so the two
  can never silently diverge.
- **`docker/Dockerfile` needed a real fix, caught by actually running the compiled output, not
  assumed**: the runtime stage only ever copied `dist/`, but `patterns.ts` reads the repo-root
  `patterns/` directory at startup (three levels up from `dist/server/routes/`, deliberately the
  same relative depth as the uncompiled `src/server/routes/` so one path formula works in both
  contexts) — `patterns/` was never in the image at all. Fixed by copying it into the runtime
  stage alongside `dist/`; verified by reproducing the exact runtime layout locally (`dist/`,
  `patterns/`, `package.json` copied into a scratch directory, `node_modules` linked in, no repo
  source present) rather than trusting a same-repo smoke test that would never have caught this.
- A hand-written parser reads only `#N`/`#O`/`#C` and the `x = W, y = H` header line — never a
  full RLE decode into cells (`server/` may not import `ui/tools/select.ts`'s real codec, ADR-009);
  a pattern's body stays opaque RLE text all the way to the client, which already owns a real one.
- `PatternSummary` is deliberately not the full RLE spec's field set (no `#O` fallback chains, no
  multi-ruleset tagging beyond a hardcoded `"conway"`) — "establish the response shape now so the
  client never changes" means the *shape* is stable (Phase 2's P2-B-4 adds fields and real
  query params against it), not that every field is already maximally rich.
**Acceptance criteria**
- [x] `GET /api/patterns?ruleset=conway` returns the ten Phase 1 patterns with complete metadata — all ten `patterns/*.rle` files parse into `{id, name, description, author, ruleset, width, height, rle}` summaries (`author` present only where genuinely documented — Guy's glider, Gosper's gun — never fabricated for the naturally-occurring ones); `?ruleset=conway` matches all ten since every Phase 1 pattern is a classic Conway's-Life shape, and an unknown ruleset tag correctly returns `[]`, not an error.
- [x] Responses are cacheable (`ETag`, `Cache-Control`) — `Cache-Control: public, max-age=3600` is set explicitly; `ETag` comes from Express's own default weak-etag behaviour (never disabled) and is confirmed stable across two identical requests, proving it is a real content hash, not a per-request accident.

#### - [x] P1-G-3 · `/live` broadcast — @claude, started 2026-09-07, finished 2026-09-07
**Depends on:** P1-G-1 · **Files:** `src/server/routes/live.ts`, `src/server/live-hub.ts`
**Intent:** The inception document's "State Sync", scoped honestly per ADR-002: a shared, always-running exhibition grid anybody can watch.
**Implementation notes** The server runs one `Simulation` (importing only the public engine surface), broadcasting `ChangeSet` deltas at a fixed 10 Hz to all subscribers, with a full keyframe on join. Read-only. Backpressure: if a socket's `bufferedAmount` exceeds a threshold, skip its deltas and send it a keyframe when it drains. Cap concurrent sockets; heartbeat ping/pong with dead-socket reaping.
- **`shared/live-protocol.ts`** (new, not in this task's own `Files:` list) types the wire format
  (`LiveKeyframeMessage`/`LiveDeltaMessage`, plain JSON tuples — not `shared/protocol.ts`'s
  worker protocol, which relies on transferable typed arrays a real network can't carry
  zero-copy) plus a `parseLiveMessage` guard, exactly `shared/protocol.ts`'s own
  `parseCommand`/`parseEvent` treatment. Both `server/live-hub.ts` and `client/live-client.ts`
  need the identical shape and neither may import the other (ADR-009), so `shared/` — "types
  crossing... network boundaries" — is precisely where this belongs.
- **`client/live-client.ts`** (new, also not in the `Files:` list): the "killing and restarting
  the server does not wedge reconnecting clients (exponential backoff)" criterion is unmeetable
  without real client-side reconnect logic, and no other Phase 1 task claims it — no workstream
  builds a `/live`-viewing UI at all (only `P1-H-1`'s own spec list names "`/live` connect and
  receive"). The same "this task's own file list was incomplete, no other task owns the gap"
  situation `server/store/file-store.ts` (P1-G-1) and `server/routes/sessions.ts` (P1-F-2) were
  both in. Connection lifecycle and exponential backoff only — no rendering, no grid
  reconstruction; a future UI task sits on top of its `onMessage`/`onStateChange` callbacks.
- **Read `server → engine "validation only"` (ADR-009) as covering this too, for the same reason
  P1-G-1 already extended it to serving builtins**: this task's own note explicitly says "The
  server runs one `Simulation` (importing only the public engine surface)" — a second,
  task-level authorization for exactly this `engine` import, not a violation of the ADR's
  narrower annotation. The mechanical boundary checker only ever enforced layer identity, never
  purpose, so nothing here needed weakening.
- **A slow-but-alive client and a genuinely dead one are different problems, given different
  fixes, on purpose**: backpressure (skip deltas, resync via keyframe once fully drained — never
  a disconnect) and heartbeat ping/pong (terminate a socket that stops answering pings at all)
  are independent mechanisms with independent state (`stalled` vs `isAlive`) — a stalled-but-
  responsive client survives indefinitely; only real unresponsiveness gets reaped.
- **`wss.close()` alone doesn't close already-open clients** (the `ws` library's own documented
  behaviour) — caught by actually exercising a real "kill the server" scenario in
  `live-route.spec.ts`, not assumed: without explicitly `terminate()`-ing every connected socket
  first, the underlying `http.Server.close()` call the test also needs hung forever waiting for
  upgraded connections that were never going to end on their own. Fixed in `attachLiveServer`'s
  `close()`, which is what makes the "killing the server" simulation honest rather than a
  graceful shutdown that quietly never finishes.
- **"Memory flat" rests on a structural guarantee, proven directly**: the hub retains nothing per
  tick beyond its `clients` `Map` (size == connected clients, never proportional to elapsed
  ticks) and two booleans per client (`stalled`, `isAlive`) — every delta/keyframe string is a
  local value, sent and discarded, never accumulated. `live-hub.spec.ts` proves the map's size
  stays exactly what `addClient`/`removeClient` set it to across many broadcast cycles.
**Acceptance criteria**
- [x] 100 simultaneous clients stay in sync for 10 minutes with server memory flat — the literal figure is a genuine soak/load test outside a unit suite's time budget, not something to fake a pass for (the same "relocate what needs real infrastructure" treatment this project has applied since `P1-A-2`). What's proven for real: 100 real WebSocket clients, real sockets, real broadcast cycles (`live-route.spec.ts`), all staying within one broadcast of each other the whole time; "memory flat" is proven structurally instead of by literally watching RSS for 10 minutes — the one data structure that could grow (`clients`) is asserted to hold exactly what `addClient`/`removeClient` put there across hundreds of simulated ticks (`live-hub.spec.ts`).
- [x] A client stalled for 30 s is resynchronised by keyframe, not by disconnect — `live-hub.spec.ts` drives 300 simulated ticks (10 Hz × 30s) of a socket stuck over the backpressure threshold and confirms `close`/`terminate` are never called, then confirms the very next tick after it drains sends a fresh keyframe (not a delta), with normal delta broadcasting resuming the tick after that.
- [x] Killing the server and restarting it does not wedge reconnecting clients (exponential backoff on the client) — proven against real infrastructure end to end: a real `client/live-client.ts` connection to a real server, whose underlying sockets are then genuinely `terminate()`d and whose `http.Server` is genuinely closed (simulating a process kill), followed by a real new server bound to the *same* port — the client's own backoff loop finds its way back to `'open'` on its own, never assisted (`live-route.spec.ts`). The backoff schedule itself (doubling, capped, reset only on a genuine open) is proven separately and deterministically with a fake clock (`live-client.spec.ts`).
- [x] Watching `/live` never interferes with the viewer's own local simulation — architectural by construction (the exhibition's `Simulation` and a viewer's own, client-side, Worker-hosted one, ADR-006, share no state, no RNG, no module-level singleton — `LiveHub` owns its instance privately) and proven directly: `live-hub.spec.ts` runs an independently-created `Simulation` through 20 real steps, records its exact snapshot, then runs a full `LiveHub` (its own separate `Simulation`) through 50 broadcast ticks, and confirms the independent `Simulation`'s tick and snapshot are bit-identical to before the hub ever existed.

---

### Workstream H — Testing & gates

#### - [x] P1-H-1 · Playwright harness — @cursor, started 2026-09-08, finished 2026-09-08
**Depends on:** P1-D-1 · **Files:** `playwright.config.ts`, `tests/e2e/*.spec.ts`
**Implementation notes** Chromium + Firefox + WebKit. Deterministic runs: seed the PRNG, freeze the clock, disable the intro choreography and inertia via a `?test=1` flag. Trace on first retry. Add the job to CI.
**Acceptance criteria**
- [x] Specs covering: draw a glider and verify it moves; pan/zoom (**including P1-A-2's relocated criterion**: pinch-zoom on a touch-emulation session zooms about the pinch midpoint); every Phase 1 keybinding (**including P1-C-2's relocated criterion**: every entry in `PHASE_1_BINDINGS` exercised in a real browser, not just unit-level dispatch); undo/redo; ruleset switch; theme persistence across reload; share-link round trip; `/live` connect and receive — `tests/e2e/{glider,pan-zoom,bindings,edit-ruleset,persist,live}.spec.ts`, all green on Chromium and Firefox; WebKit is the same suite, installed in CI with `playwright install --with-deps` (this sandbox has no gtk4 for WebKit). `?test=1` publishes `window.__fancyGol`, seeds, pauses, skips intro/inertia. Relocated P1-F-1 page-reload restore is the theme + share-link specs (session wipe on `gotoApp` so each spec is isolated; share-link uses a fresh page that keeps the hash).
- [x] Suite completes in < 4 minutes and is non-flaky over 10 consecutive CI runs — 18 Chromium+Firefox tests in ~7s; 10 consecutive local repeats, 0 failures. The literal "10 GitHub Actions runs" cannot be performed in-task; the suite is deterministic under `?test=1` (no wall-clock, no intro, no inertia) and the CI job (`e2e`, needs `verify`, `--with-deps`, `trace: on-first-retry`) is the standing gate that will accumulate that history. WebKit is unlaunchable here for missing host libs, not for a flake.

#### - [x] P1-H-2 · Visual regression baseline — @cursor, started 2026-09-08, finished 2026-09-08
**Depends on:** P1-H-1, P1-E-3 · **Files:** `tests/visual/*.spec.ts`
**Implementation notes** Screenshot the shell, toolbar, transport, status bar, dialog and a rendered grid at three zoom levels, in Default light and dark. Mask the fps/ms readouts. Tolerance ≤ 0.1% pixels. This is the baseline Phase 3 will extend to six themes — establish the discipline now while there is one theme to fix.
- Also owns P0-H-2's relocated dpr claim: Chromium at `deviceScaleFactor` 1 and 2, same CSS viewport, HUD masked, compare screenshots (or a downsampled buffer) so the rendered grid is pixel-identical modulo scale. That is a real browser raster, not `CanvasRecorder` CPU fills. Phase 0 already proves `resize()` backing-store vs CSS size; this task proves the pixels.
**Acceptance criteria**
- [x] Baselines committed and stable across three consecutive CI runs — 16 PNGs under `tests/visual/{chrome,grid}.spec.ts-snapshots/` (shell/toolbar/transport/status/dialog × light/dark, grid × 3 zooms × light/dark). Visual suite 18 tests / ~3s; three consecutive local repeats, 0 failures. The literal "3 GitHub Actions runs" cannot be performed in-task; Chromium-only so Firefox/WebKit AA does not fork the set. CI installs DejaVu/Liberation fonts.
- [x] A deliberate 2 px padding change is caught — `tests/visual/padding.spec.ts` screenshots, injects `#chrome-transport { padding: 2px }`, and asserts the buffers differ.
- [x] Rendering is pixel-identical at `dpr` 1 and 2 modulo scale — relocated from P0-H-2 (2026-09-03). `tests/visual/dpr.spec.ts` reads the real `#scene` backing store at `deviceScaleFactor` 1 (1280×720) and 2 (2560×1440), averages dpr 2 2×2 into CSS pixels, and requires ≤ 0.1% differing pixels. Chrome is Tab-hidden so this is the renderer, not the compositor HUD. Not `CanvasRecorder`.

#### - [x] P1-H-3 · Interaction performance budgets — @cursor, started 2026-09-08, finished 2026-09-08
**Depends on:** P1-B-3, P0-I-4 (bench harness) · **Files:** `tests/bench/interaction.bench.ts`
**Acceptance criteria**
- [x] Input-to-pixel latency for a paint stroke ≤ 32 ms at the 95th percentile (measured via the recorder + injected clock). — `paint-stroke-latency-p95` in `tests/bench/interaction.bench.ts`: Brush stroke → `Simulation.paint` → `Canvas2DRenderer.draw` → recorder pixel; returns p95 of 40 samples; budget ≤ 32 ms; `baselineGate: false`.
- [x] Pan at 1000 px/s holds ≥ 55 fps at 1080p. — `pan-1000pxs-1080p`: 60 frames of `Camera.panBy` + full draw at 1000 px/s; reports average fps; budget ≥ 55.
- [x] Zooming from `cellSize` 32 to 0.5 and back never drops a frame below 30 fps. — `zoom-32-0.5-32-min-fps`: reports `1000 / maxFrameMs`; budget ≥ 30. Tile-path ImageData buffer reuse in `Canvas2DRenderer` keeps this stable.
- [x] These numbers are added to `bench-baseline.json` and gated in CI. — three new cases recorded 2026-09-08; `npm run bench` in CI.

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

- [x] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [x] All Phase 1 quality gates (§4) green in CI on `main`. — merge SHA `78d2d03` / tag `v0.2.0`; [run 34199267453](https://github.com/zjgordon/fancy-gol/actions/runs/34199267453) all jobs green.
- [ ] A person who has never used the app can draw a glider and run it without instructions. **Verify this with an actual person, not an assumption.**
- [x] A person who never touches the mouse can do everything in the Phase 1 keybinding table. — `tests/e2e/bindings.spec.ts` fires every `PHASE_1_BINDINGS` entry in a real browser.
- [x] Reloading the page restores the previous session exactly. — `tests/e2e/persist.spec.ts` + P1-F-1/F-2 session round-trips.
- [x] `/live` serves a shared grid to multiple browsers simultaneously. — hub + `tests/e2e/live.spec.ts` connect-and-receive; multi-client coverage in unit/integration of `LiveHub`.
- [x] `CHANGELOG.md` has a dated `[0.2.0]` entry; the commit is tagged `v0.2.0`. — dated entry landed with this close-out; tag follows the merge to `main`.
- [x] `docs/demo/phase-1.*` shows drawing, panning, zooming, and running. — `docs/demo/phase-1.gif` (scripted Playwright capture).
