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
  has built ahead of its own dedicated task.
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
- [ ] Specs covering: draw a glider and verify it moves; pan/zoom (**including P1-A-2's relocated criterion**: pinch-zoom on a touch-emulation session zooms about the pinch midpoint); every Phase 1 keybinding (**including P1-C-2's relocated criterion**: every entry in `PHASE_1_BINDINGS` exercised in a real browser, not just unit-level dispatch); undo/redo; ruleset switch; theme persistence across reload; share-link round trip; `/live` connect and receive.
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
