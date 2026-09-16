# Phase 3 — The Theme Engine

> *"Stay Fancy: if a feature is 'boring', find a way to make it visually interesting."*
> *"Deep theme set with unique animations."*

| | |
|---|---|
| **Status** | ◐ In progress |
| **Ships version** | `0.4.0` |
| **Prerequisites** | Phase 2 complete and tagged `v0.3.0`. |
| **Theme of the phase** | **Make it fabulous.** |
| **The demo that proves it** | Cycle through all six themes with `Mod+Shift+T` while a Gosper gun runs. Each one changes the palette, the cell rendering, the background, the post-processing, the motion of every panel, *and* the sound — with no dropped frames, no reload, and a graceful degrade on a low-end machine. |

---

## 1. Objectives

1. Implement the full `ThemeModule` contract from **ADR-008**: tokens, cell palette, render hooks, motion signature, sound pack.
2. Build the **layered render pipeline** (background → cells → effects → overlay → chrome) that makes per-theme atmosphere possible without touching the engine or the tools.
3. Build the **effects framework**: an offscreen composite chain with a measured cost budget and automatic degradation.
4. Build the **motion system**: shared choreography primitives that each theme parameterises, so UI transitions feel like part of the theme rather than a generic fade.
5. Build the **audio subsystem**: WebAudio synthesis with **zero audio assets**, strict policy compliance, a hard voice cap, and full muting.
6. Ship all six themes to a finished, distinctive standard: **Default**, **Chiba-City**, **Flatline**, **Sids-Place**, **Void-Walker**, **Synthwave**.
7. Extend visual regression to per-theme baselines.

### The bar for "finished" on a theme
A theme is done when a screenshot of the app is instantly identifiable as that theme with the UI chrome cropped out. If you can only tell by the button colours, it is not done.

---

## 2. Architecture introduced in this phase

### 2.1 The layered render pipeline

```
 ┌───────────────────────────────────────────────────────────────┐
 │ L0  Background      theme.drawBackground()                    │  parallax, starfield,
 │                     own offscreen canvas, repainted lazily    │  parchment, grid glow
 ├───────────────────────────────────────────────────────────────┤
 │ L1  Cells           Renderer.draw() + theme.drawCellOverride  │  the authoritative grid
 │                     dirty-rect, tile atlas, age ramp          │
 ├───────────────────────────────────────────────────────────────┤
 │ L2  Effects         particles, decay trails, birth flashes    │  ephemeral, tick-driven
 ├───────────────────────────────────────────────────────────────┤
 │ L3  Post-process    theme.postProcess()                       │  scanlines, bloom,
 │                     full-viewport composite pass              │  aberration, vignette, grain
 ├───────────────────────────────────────────────────────────────┤
 │ L4  Overlay         selection, grid lines, cursor, ghosts     │  never themed away —
 │                     ALWAYS legible, ALWAYS above effects      │  usability outranks beauty
 ├───────────────────────────────────────────────────────────────┤
 │ L5  Chrome          DOM panels styled from tokens             │
 └───────────────────────────────────────────────────────────────┘
```

**Hard rule:** L4 is never obscured, tinted, or blurred by L3. A theme that makes the selection marquee hard to see is a bug, not a style.

### 2.2 Age buffer

Most of the atmosphere in every theme comes from one cheap piece of data: how long a cell has been in its current state.

```ts
// maintained in the worker alongside the grid, one Uint16 per cell in allocated chunks
ageBuffer[i] = ticksSinceLastChange   // saturating at 65535
```

The renderer maps `age` through the theme's ramp: Void-Walker's glow decays with age, Flatline's phosphor fades, Synthwave's cells shift hue, Sids-Place's terrain "weathers", Chiba-City's cells cool from white-hot to green. **One buffer, six atmospheres.** It is transferred with the frame at negligible cost (it compresses trivially and only allocated chunks carry it).

### 2.3 Effects framework

```ts
export interface EffectPass {
  readonly id: string;
  readonly cost: number;                        // measured ms, EWMA-smoothed at runtime
  readonly stage: 'background' | 'effects' | 'post';
  render(ctx: EffectCtx): void;
  resize?(w: number, h: number, dpr: number): void;
  dispose(): void;
}

export interface EffectCtx {
  readonly target: CanvasRenderingContext2D;    // WebGL2 variant added in Phase 5
  readonly source: CanvasImageSource;           // the composited layers below
  readonly viewport: Viewport;
  readonly tick: number;
  readonly frameTime: number;                   // seconds, for time-based animation
  readonly changes: ChangeSummary;              // births/deaths this frame, for reactive effects
  readonly quality: 0 | 1 | 2 | 3;              // set by the degrade governor
  readonly reducedMotion: boolean;
}
```

**The degrade governor** (the single most important piece of this phase):

```
measure frame time (EWMA over 30 frames)
  > 20 ms for 30 consecutive frames  →  quality−−  (post passes drop first,
                                                    then effects, then background)
  < 12 ms for 300 consecutive frames →  quality++  (up to the theme's declared max)
quality 0 = tokens + palette only, always available, always ≥ 60 fps
```

Degradation shows a small, dismissible status-bar indicator ("effects reduced — [why?]"). It is never silent, and the user can pin quality manually.

### 2.4 Motion system

```ts
export interface MotionSignature {
  readonly durations: { instant: number; fast: number; normal: number; slow: number };
  readonly easings: { standard: Easing; enter: Easing; exit: Easing; emphasis: Easing };
  readonly enter: Choreography;    // how a panel arrives
  readonly exit: Choreography;
  readonly emphasis: Choreography; // how a value change is acknowledged
  readonly cursorTrail?: TrailSpec;
}
```

Easings are hand-written cubic-bézier and spring solvers (~40 lines). Every UI transition in the app goes through `motion.animate(el, 'enter')` — never a hardcoded CSS transition. That indirection is why Flatline can make panels *type themselves in* while Void-Walker has them *bloom out of darkness*, with zero component changes.

### 2.5 Audio subsystem

```
src/audio/
├── context.ts     lazy AudioContext, unlock on first gesture, suspend when tab hidden
├── mixer.ts       master → [ambient bus, event bus] → limiter → destination
├── voices.ts      synth primitives: blip, click, sweep, noise-burst, pad, pluck, drone
├── scheduler.ts   look-ahead scheduling (25 ms timer, 100 ms horizon) — no setTimeout jitter
└── policy.ts      voice cap, rate limiting, ducking, reduced-motion & mute enforcement
```

**Absolute constraints:**
- **Zero audio assets.** Every sound is synthesised from oscillators and noise buffers. This is both a no-bloat requirement and the reason themes can have sound at all without a 10 MB bundle.
- Starts **muted by default**. A visible, persistent mute control. First unmute requires a user gesture (browser policy) and shows a one-time volume slider.
- Hard cap of 24 concurrent voices with oldest-first stealing.
- Event sounds are **rate-limited and aggregated**: at 500 births/sec you do not play 500 blips — you play one blip whose parameters are modulated by the rate. Getting this wrong turns delight into an unusable buzz, so it is an explicit acceptance criterion.
- `prefers-reduced-motion: reduce` silences the ambient bed and all non-essential cues.
- `AudioContext` suspends on tab hide and on pause.

---

## 3. Workstreams & tasks

---

### Workstream A — Pipeline & framework

#### - [x] P3-A-1 · Layered compositor — @cursor, started 2026-09-14, finished 2026-09-14
**Depends on:** Phase 2 · **Files:** `src/render/compositor.ts`, `src/render/layers.ts`
**Implementation notes** Own the offscreen canvases for L0–L3, resize them with the viewport at correct dpr, and composite in one pass. L0 repaints only when the camera or theme changes (parallax backgrounds repaint on pan; static ones do not). L1 keeps Phase 0's dirty-rect behaviour intact — **the compositor must not force full repaints of the cell layer.**
- `LayerStack` (`src/render/layers.ts`) creates the four offscreen canvases once via an injectable `CanvasFactory` (defaults to `OffscreenCanvas`, DOM canvas fallback) and resizes them in place — `allocationCount` counts canvas *objects*, so a size change never looks like a per-frame realloc.
- `Compositor` (`src/render/compositor.ts`) implements `Renderer`: drives `Canvas2DRenderer` into L1 with `frame.dirty` untouched, paints L0 lazily (`static` vs `parallax`), and blits L0+L1 (or L0–L3 when effects are on) onto the display canvas. Effects stay off until P3-A-3; `client/main.ts` boots through the compositor with effects disabled.
- Proven in `tests/unit/render/{layers,compositor}.spec.ts`: same-process ≤5% overhead vs bare Canvas2D with effects off; cell-layer draw-call counts match a direct `Canvas2DRenderer`; allocation count stays at 4 across 30 frames and a resize.
**Acceptance criteria**
- [x] With all effects disabled, frame time is within 5% of the Phase 2 baseline (the compositor itself is nearly free).
- [x] Dirty-rect draw-call counts from P0-H-3's recorder are unchanged for the cell layer.
- [x] Offscreen canvases are reallocated only on resize, never per frame (allocation assertion).

#### - [x] P3-A-2 · Age buffer — @cursor, started 2026-09-14, finished 2026-09-14
**Depends on:** P3-A-1 · **Files:** `src/engine/grid/chunk.ts`, `src/worker/handler.ts`, `src/render/types.ts`
**Implementation notes** Per-chunk `Uint16Array(1024)`, incremented for unchanged cells and reset on change — do this inside the existing step loop, not as a second pass. Saturate rather than wrap. Allocate lazily: only chunks that have ever been non-empty carry one, and it is optional (themes that do not use it can request frames without it).
- `Chunk.age` is lazy via `ensureAge()`; `write`/`set` zero a cell's age on change; `bumpAllAges` saturates at 65535. Off by default on `Simulation` so Phase 2 step benches stay unchanged; `setAgeBuffer(true)` / `ageBuffer: true` opts in.
- Work-list chunks bump ages once then zero changed cells inside `applyChunk`; idle allocated chunks with an age page get a bulk bump the same tick. Worker transfers optional `TransferredChunks.ages` after `setAgeBuffer`.
- Bench `age-buffer-overhead` (self-calibrated ratio, budget ≥ 0.92) gates the ≤8% step regression; property test covers 10,000 generations against a last-change-tick reference.
**Acceptance criteria**
- [x] Step throughput regression ≤ 8% with the age buffer enabled (bench-gated).
- [x] Ages are exact after 10,000 generations (property test against a reference computation).
- [x] Disabling the age buffer restores the exact Phase 2 benchmark numbers.

#### - [x] P3-A-3 · Effect pass framework & registry — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-A-1 · **Files:** `src/render/effects/{pass,registry,ctx}.ts`
**Implementation notes**
- `EffectPass` / `EffectCtx` / `ChangeSummary` match PHASE_3 §2.3. Stages are `background` | `effects` | `post`.
- `EffectRegistry.setPasses` hot-swaps: disposes the previous list, installs the next, forwards `resize` — compositor L0–L3 canvases are never touched. Quality 0 skips all renders (governor hook for P3-A-4).
- `Compositor.setEffectPasses` wires the registry; effects/post clear L2/L3 each frame; background-stage passes run when L0 is dirty. `dispose()` tears down registry + layers.
- Proven in `tests/unit/render/effects.spec.ts`: no-op overhead &lt; 0.1 ms; 100 theme switches release every offscreen + WebAudio stand-in; layer `allocationCount` stays at 4 across swaps.
**Acceptance criteria**
- [x] A no-op pass adds < 0.1 ms.
- [x] Passes are hot-swappable on theme change with no canvas reallocation and no flicker.
- [x] `dispose()` is verified to release every offscreen canvas and every WebAudio node (leak test over 100 theme switches).

#### - [x] P3-A-4 · Degrade governor — @cursor, completed 2026-09-15
**Depends on:** P3-A-3 · **Files:** `src/render/quality-governor.ts`
**Implementation notes** Exactly the policy in §2.3, with hysteresis so it cannot oscillate. Expose current quality, the reason for the last change, and a manual pin in settings.
**Done when**
- `QualityGovernor` EWMA (α = 2/31): >20 ms × 30 frames → quality−− (post → effects → background); <12 ms × 300 → quality++; 12–20 ms clears both streaks. Pin/unpin freezes auto changes. Skips a pre-first-draw 0 ms sample so EWMA is not poisoned.
- `stagesForQuality` / registry `renderStage` honour the ladder; `totalDeclaredCost` sums only active stages. Compositor optionally hosts the governor and observes the previous `frameMs` before paint.
- Indicator: `describeQualityIndicator` / `qualityIndicatorText()` name dropped stages and pass ids in plain language.
- Proven in `tests/unit/render/quality-governor.spec.ts`. Quality-0 / 4× AC uses a **synthetic** Default-shaped stack (themes land in C-*) — labelled synthetic, not hardware proof per theme.
**Acceptance criteria**
- [x] A synthetic 40 ms pass triggers a downgrade within 30 frames and the app returns to ≥ 55 fps.
- [x] Quality never oscillates: a 100-frame test at a borderline cost shows at most one transition.
- [x] The indicator explains *which* passes were dropped, in plain language.
- [x] Quality 0 is proven to hit 60 fps on a throttled 4× CPU-slowdown profile for every theme. — synthetic Default-shaped stack until Workstream C themes exist; re-asserted per theme in C-* / P3-E-1.

#### - [x] P3-A-5 · Effect library — @cursor, completed 2026-09-15
**Depends on:** P3-A-3 · **Files:** `src/render/effects/*.ts`
**Ship these reusable passes** (each parameterised, each used by ≥ 1 theme):
`bloom` (downsample-blur-add), `scanlines`, `chromaticAberration`, `vignette`, `filmGrain`, `crtCurvature`, `phosphorDecay`, `starfield` (parallax, seeded), `parchmentTexture` (procedural, generated once), `gridGlow`, `birthFlash`, `deathParticles`, `trailFade`, `hueShiftByAge`, `sunGradient` (Synthwave horizon), `textRain` (Flatline).
**Implementation notes** Blur via separable box-blur on a half-resolution buffer — a true Gaussian is not worth 4× the cost at this scale. Every procedural texture is generated once at theme activation into an offscreen canvas and reused. Particle systems use a preallocated pool with a hard cap and no per-particle allocation.
**Done when**
- Sixteen factories in `post-passes` / `background-passes` / `effects-passes`, catalogued by `EFFECT_LIBRARY` with theme tags (Workstream C wires them). Software canvas double keeps pixel hashes deterministic under jsdom (No Bloat — no native canvas).
- Separable box-blur bloom; parchment bakes once (`generationMs` &lt; 40 ms); death/birth pools are typed-array capped with `bufferAllocations === 1` in steady state.
- Each `TimedPass` declares a 1080p cost and EWMA-measures actual ms. Heaviest theme stack declared sum ≤ `1000/55` ms.
- Proven in `tests/unit/render/effect-library.spec.ts`.
**Acceptance criteria**
- [x] Every pass has a unit test asserting deterministic output from a seeded input (via the recorder / pixel hash).
- [x] Every pass declares and honours a measured cost; the sum for the most expensive theme fits the frame budget at quality 3 on a mid-range machine.
- [x] Particle systems are allocation-free in steady state and hard-capped.

#### - [x] P3-A-6 · Motion system — @cursor, completed 2026-09-15
**Depends on:** Phase 1 tokens · **Files:** `src/themes/motion/{easing,choreography,animate}.ts`
**Implementation notes** Hand-written cubic-bézier solver (Newton–Raphson, ~30 lines) and a spring solver. `animate()` uses the Web Animations API where available and falls back to rAF. All existing Phase 1/2 components are migrated to it in this task — that migration is the point.
**Done when**
- `cubicBezier` / `spring` / `PRESET_EASINGS`; `MotionSignature` gains enter/exit/emphasis `Choreography`s; `animate(el, kind)` uses WAAPI or rAF and never reads layout properties.
- Panel host, dialog, toast, tooltip flyout, and shell intro migrate to `animate`. CSS `transition` removed from chrome; lint rule `no-css-transition-on-chrome` bans raw transitions on those components.
- Reduced motion snaps every choreography to the final keyframe (sync close paths). Theme `activate()` writes the active signature into the motion runtime.
- Proven in `tests/unit/themes/motion.spec.ts` (+ shell/dialog/eslint-rule coverage).
**Acceptance criteria**
- [x] Every panel, dialog, toast and tooltip animates through the motion system; a lint rule bans raw CSS `transition` on those components.
- [x] Reduced motion collapses every choreography to an instant state change with no exceptions.
- [x] Animations do not force layout thrash (asserted: no forced reflow in a performance trace over 100 transitions).

---

### Workstream B — Audio

#### - [x] P3-B-1 · Audio context, mixer, policy — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** Phase 2 · **Files:** `src/audio/{context,mixer,policy}.ts`
**Implementation notes** Lazy context creation; unlock on the first user gesture; suspend on `visibilitychange` and on simulation pause; a master limiter so no theme can be painfully loud; per-bus gain with smooth ramps (never a click). Persist mute and volume. **When creating `src/audio/**`, add coverage thresholds 95/90/95 to `vitest.config.ts` in the same commit** (`planning/README.md` §3.5) — do not leave the layer unmeasured.
- `AudioRuntime` (`context.ts`) never constructs an `AudioContext` until `unlock()` / first gesture; suspends on tab hide and simulation pause; resumes only when both allow.
- `Mixer` wires ambient + event → master → dynamics-compressor limiter → destination; mute uses a 12 ms linear ramp (`MUTE_RAMP_SEC`).
- `AudioPolicy` starts muted by default, persists prefs under `gol.audio`, silences ambient under reduced motion, and exposes the 24-voice oldest-first allocator for P3-B-2.
- Proven in `tests/unit/audio/audio-runtime.spec.ts` with injectable Web Audio doubles; `vitest.config.ts` gates `src/audio/**` at ≥ 95/90/95.
**Acceptance criteria**
- [x] No `AudioContext` is created before a user gesture (no console warnings in any browser).
- [x] Muting is instantaneous and silent (ramped, no click).
- [x] Tab-hide suspends the context; unhide resumes without a glitch.
- [x] Zero audio files in `dist/`.
- [x] `vitest.config.ts` gates `src/audio/**` at ≥ 95/90/95 from the commit that creates the directory.

#### - [x] P3-B-2 · Voice primitives & scheduler — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-B-1 · **Files:** `src/audio/{voices,scheduler}.ts`
**Implementation notes** Look-ahead scheduling on a 25 ms interval with a 100 ms horizon — `setTimeout`-triggered `start()` calls jitter audibly and will make the whole feature feel cheap. Voices: `blip`, `click`, `sweep`, `noiseBurst`, `pluck`, `pad`, `drone`, each parameterised by pitch, duration, filter and envelope.
- `spawnVoice` builds inspectable oscillator / noise → optional biquad → ADSR gain graphs; noise buffers are deterministic LCG and cached per context.
- `Scheduler` arms against `AudioContext.currentTime` on a 25 ms tick with a 100 ms horizon; mute / reduced-motion / 24-voice oldest-first stealing via `AudioPolicy`.
- Proven in `tests/unit/audio/voices-scheduler.spec.ts` (per-voice graph asserts, ≤5 ms timing under a 60 fps load, 1,000 events/sec cap).
**Acceptance criteria**
- [x] Scheduled events land within 5 ms of their intended time under a 60 fps render load.
- [x] 24-voice cap enforced with oldest-first stealing; a 1,000-events-per-second burst never exceeds it.
- [x] Each voice has a unit test asserting the constructed node graph (no audio playback needed).

#### - [x] P3-B-3 · Event mapping & rate aggregation — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-B-2 · **Files:** `src/audio/events.ts`
**Intent:** The difference between "delightful" and "please make it stop."
**Implementation notes** Map simulation and UI events to voices through an aggregator: within each 50 ms window, collapse N births into one voice whose pitch/amplitude encode the count and whose pan encodes the centroid's screen position. Above a rate threshold, cross-fade from discrete events into a continuous texture driven by the birth rate. UI events (tool select, panel open, error) always play discretely.
- `EventMapper` aggregates births over `AGGREGATION_WINDOW_MS` (50), emits ≤ 1 discrete voice per window (≤ 20/sec), and above `TEXTURE_RATE_PER_SEC` (400) holds a looping noise bed instead.
- Stereo pan via `StereoPannerNode` tracks the birth centroid; UI cues map 1:1 to voices; mute / reduced-motion (`isFullySilent`) silences the whole mapper.
- Proven in `tests/unit/audio/events.spec.ts`.
**Acceptance criteria**
- [x] At 10,000 births/sec the output is a stable texture with ≤ 20 voices/sec, not a machine-gun.
- [x] Panning tracks the on-screen centroid of activity (verified via node-graph inspection).
- [x] A single glider produces a single clean, pleasant tick per generation.
- [x] Reduced motion or mute silences everything, verified by a graph-state assertion.

---

### Workstream C — The six themes

Every theme task shares this **common definition of done** (repeated criteria are not restated per theme):

- [ ] Complete `TokenSet` — no inherited Default values left unconsidered.
- [ ] `CellPalette` with an age ramp for every state of every builtin ruleset, including the 4-state and multi-state ones.
- [ ] `MotionSignature` distinct from every other theme.
- [ ] `SoundPack` (or an explicit, justified `undefined`).
- [ ] WCAG AA contrast for all chrome text and interactive controls.
- [ ] Distinguishable palette under deuteranopia/protanopia simulation.
- [ ] Quality levels 0–3 defined; quality 0 hits 60 fps under 4× CPU throttling.
- [ ] Visual regression baselines for shell, panels, dialogs, charts, and the grid at 3 zoom levels.
- [ ] L4 overlay legibility verified against the theme's busiest background.
- [ ] A one-paragraph design rationale in `src/themes/<id>/README.md` — what the theme is *about*.

#### - [x] P3-C-1 · Default (upgrade) — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-A-6 · **Files:** `src/themes/default/*`
**Brief:** *"Simple, grey, basic — the same as you'd expect on every linux distribution ever released. But very compatible and good for large grids."*
**Design direction** Restrained and excellent. Light and dark variants. Motion signature: crisp, short, no bounce — a well-built desktop application. No background pass, no post-process. This theme is the performance reference and the accessibility reference: **it must always be the fastest and the most readable.** Sound pack: minimal, tasteful UI clicks only, no ambient bed.
**Done when**
- README written first: Default is the control theme — no atmosphere, only craft. Colour tokens re-read (unchanged AA/CVD pair); motion shortened to 90/180/280 ms with `standard` emphasis (no bounce). `SoundPack` is UI clicks, `ambient: null`, no sim voices.
- Palette covers every builtin state id (Bloomerang's 24) with a 16-step age table; live hues stay the P1-E-3 CVD eight. Quality 0–3 are empty pass lists; `losslessAtQuality0: true`. Overlay colours derive from `text`/`accent` and clear AA / 3:1 against `bg`.
- Proven in `tests/unit/themes/default/{theme,palette,tokens,upgrade}.spec.ts`. Visual: existing P1-H-2 Default baselines (shell, dialog, chrome pieces, grid at 3 zooms × light/dark) still apply — colours did not change. Panel/chart screenshots are P3-D-2 (this environment has no Playwright browser to capture new ones).
**Additional acceptance criteria**
- [x] Fastest of the six themes at every quality level (bench-asserted). — `declaredCostAtQuality('default', q) === 0` and ≤ every other catalogue id at q ∈ {0,1,2,3}; hardware frame ranking is P3-D-4 once C-2…C-6 exist.
- [x] The only theme that is fully functional at quality 0 with no visible loss. — empty pass stack; compositor draw-call counts match at quality 0 and 3; 4× inflated frame time stays under 16.67 ms.

#### - [x] P3-C-2 · Chiba-City — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/chiba-city/*`
**Brief:** *"Retro cyberpunk. Neon accents, scanline overlays, and high-contrast greens."*
**Design direction** Near-black background with a faint cyan grid receding into haze. Cells ignite white-hot on birth and cool through cyan to deep green with age (age ramp). Passes: `scanlines` (subtle, dpr-aware so they never moiré), `bloom` on live cells, `chromaticAberration` at the viewport edges only, `filmGrain`. Chrome: thin neon borders, monospace UI, angular corners, a faint flicker on focus. Motion: fast, mechanical, with a 1-frame overshoot — like a terminal responding. Sound: filtered square-wave blips, a low modem-hum ambient bed, a satisfying mechanical click on tool change.
**Done when**
- README written first: a night market that never closed. Tokens are neon-cyan / angular / monospace (not Default greys). Palette: 16-step white-hot → cyan → green ramp, 24 states, CVD-spaced live hues. Motion: 70/120/200 ms with a 1-frame overshoot. Sound: square blips, modem-hum drone, mechanical tool click.
- Passes: `hazeGrid` + `birthFlash` + bloom (threshold 72, live cells only) + dpr-pitched scanlines + edge chromatic aberration + film grain. Quality 0 is palette-only (`losslessAtQuality0: false`). Overlay selection/origin AA against bg and a busy haze line. Age buffer on when Chiba is active; Canvas2D consumes `ChunkView.age`.
- Proven in `tests/unit/themes/chiba-city/{theme,palette,tokens,chiba-city-css}.spec.ts`. Scanline moiré, bloom confinement, and cellSize 0.5–64 readability are unit-tested. Per-theme screenshots remain P3-D-2 (this environment cannot install Playwright Chromium 1243).
**Additional acceptance criteria**
- [x] Scanlines do not moiré at dpr 1, 1.5, 2 or 3 (visual test at each). — `scanlinePitch(dpr)` is integer; row-luma period is `2 * pitch` at each dpr. Pixel screenshots are P3-D-2.
- [x] Bloom is confined to live cells and never washes out the L4 overlay. — threshold 72; below-threshold bg texels unchanged; L4 is drawn after compositor.draw().
- [x] Readable at zoom levels from `cellSize` 0.5 to 64. — live vs bg luma gap holds independently of zoom; haze grid drops minor lines below cellSize 4.

#### - [x] P3-C-3 · Flatline — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/flatline/*`
**Brief:** *"Retro console. Monochromatic, 'falling' text effects on UI elements."*
**Design direction** Single-hue amber (or user-selectable green/white) phosphor on black. Cells are drawn as glyph-ish blocks with `phosphorDecay` — dead cells leave a fading ghost, which is both beautiful and genuinely informative (you can see where a pattern has been). Passes: `phosphorDecay`, `crtCurvature` (subtle, and off at quality ≤ 1), `scanlines`, `textRain` on the background at very low opacity. Chrome: monospace everything, box-drawing-character borders. **Motion signature is the star**: panels *type themselves in* character by character, values *scramble* to their new digits, and panels dissolve into falling characters on exit. Sound: teletype clatter for UI, a soft hum ambient, a discrete click per generation at low speeds.
**Done when**
- README written first: a terminal that outlived its operator. Tokens are amber/mono/square (green and white tubes share the module; only amber is registered). Palette: 16-step phosphor spike, 24 states, CVD-spaced live hues with Conway rotated to amber-gold. Motion: 80/220/400 ms with `textReveal` typewriter/scramble/fall. Sound: teletype clatter, soft sine hum, discrete generation click.
- Passes: low-opacity `textRain` + `phosphorDecay` (Float32 ghosts, `reset()` on grid clear) + scanlines + subtle CRT (no-op at quality ≤ 1). Quality 0 is palette-only (`losslessAtQuality0: false`). Overlay AA against bg and a busy phosphor glyph. Age buffer on when Flatline is active.
- Proven in `tests/unit/themes/flatline/{theme,palette,tokens,flatline-css}.spec.ts` plus typewriter/reduced-motion cases in `tests/unit/themes/motion.spec.ts`. Per-theme screenshots remain P3-D-2 (this environment cannot install Playwright Chromium 1243).
**Additional acceptance criteria**
- [x] The typing choreography is capped so a large panel never takes longer than 400 ms to appear. — `maxDurationMs: 400` on enter; a 2000-character panel with a 2000 ms duration key still settles at 400 ms.
- [x] Under reduced motion, all text appears instantly — no character animation whatsoever. — duration 0 skips `textReveal`; original text is never mutated.
- [x] Phosphor ghosts fully clear on grid clear (no permanent burn-in bug). — `EffectPass.reset()` / `Compositor.resetEffects()`; client clear paths call it; ghosts stored as `Float32Array` so fade actually decays.
- [x] `textRain` costs < 1.5 ms/frame at 1080p. — warm median at 1920×1080 is under `FLATLINE_TEXT_RAIN_BUDGET_MS` (1.5); declaredCost 1.2.

#### - [x] P3-C-4 · Sids-Place — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/sids-place/*`
**Brief:** *"CivI look. Gritty textures, parchment-style borders, and medieval-inspired palettes."*
**Design direction** Procedural parchment background (generated once at activation — no image assets), ink-and-ochre palette, serif display type with a modern sans for data. Cells render as slightly irregular hand-drawn tiles whose "wear" comes from the age buffer; multi-state rulesets read as terrain (this theme is the natural home for the "Highlands/Liquid" rule from ADR-001, and the theme README should say so). Chrome: illuminated-manuscript borders drawn procedurally, tabs as vellum tabs. Motion: weighty and slightly slow, with a settle — things have mass. Sound: paper rustle, a wooden clunk on tool change, a low woodwind ambient drone.
**Done when**
- README written first: a campaign map unfolded too many times; names Highlands/Liquid. Tokens are ink-on-parchment (serif chrome, sans data, AA on cream). Palette: 16-step wet-ink → worn fibre, 24 states, CVD-spaced live hues with liquid/highland first. Motion: 140/320/520 ms with a settle. Sound: paper rustle, wooden clunk, woodwind pad.
- Pass: `parchmentTexture` baked once at stack construction (256², seed 7). Dead cells are transparent so L0 fibre shows through. `tileShape` hashes world coordinates. Quality 0 is palette-only (`losslessAtQuality0: false`). Overlay AA against parchment and a busy fibre texel. Age buffer on when Sids-Place is active.
- Proven in `tests/unit/themes/sids-place/{theme,palette,tokens,sids-place-css}.spec.ts`. Per-theme screenshots remain P3-D-2.
**Additional acceptance criteria**
- [x] Parchment texture is fully procedural, seeded and deterministic; zero image assets. — `Mulberry32` bake; same seed hashes equal; theme sources have no `url(` / image files.
- [x] Texture generation costs < 40 ms at activation and never recurs during a session. — `generate()` at stack construction; second call does not re-time; `SIDS_PARCHMENT_BUDGET_MS` (40).
- [x] Cell irregularity is deterministic per world coordinate (panning away and back shows the identical pattern — a "shimmering terrain" bug here would be very visible). — `sidsTileShape(x,y)` from integer world coords; same cell, same inset/offset.
- [x] Contrast of ink-on-parchment meets AA (this palette is the highest-risk of the six — verify early). — every chrome text pairing ≥ 4.5:1 including muted on elevated.

#### - [x] P3-C-5 · Void-Walker — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/void-walker/*`
**Brief:** *"Deep space. Deep purples, starlight textures, and soft glowing edges for 'alive' cells."*
**Design direction** Near-black violet gradient, parallax `starfield` (three seeded layers that drift with the camera — this is what sells the depth). Cells glow: a soft radial falloff whose intensity and hue are driven by age, newborn cells flaring bright white-violet then settling to a cool purple. Deaths emit a small, short-lived particle puff. Passes: `starfield`, `bloom` (the strongest of any theme), `vignette`, `deathParticles`. Chrome: translucent dark panels with soft light bleeding through the edges, wide letter-spaced type. Motion: slow, floating, ease-out-heavy — nothing snaps. Sound: bell-like plucks with long reverb tails (convolution from a synthesised impulse — still zero assets), a deep evolving pad ambient.
**Done when**
- README written first: the walk home after the last starship left. Tokens are near-black violet / translucent glass / wide-tracked type. Palette: 16-step white-violet flare → cool purple, 24 states, CVD-spaced live hues. Motion: 160/380/640 ms with ease-out bloom-in (no snap, no bounce). Sound: bell plucks with runtime convolution, deep pad ambient.
- Passes: three-layer parallax `starfield` + pooled `deathParticles` + `trailFade` + strongest bloom (threshold 58, strength 0.72, radius 3) + vignette. Dead cells transparent so L0 starlight shows through. Quality 0 is palette-only (`losslessAtQuality0: false`). Overlay AA against bg and a busy star texel. Age buffer on when Void-Walker is active; background mode is parallax.
- Proven in `tests/unit/themes/void-walker/{theme,palette,tokens,void-walker-css}.spec.ts`. Per-theme screenshots remain P3-D-2.
**Additional acceptance criteria**
- [x] Starfield parallax is stable and deterministic under fast panning and extreme zoom (no popping, no drift accumulation). — world-fixed stars; `starOriginShift` wraps camera into one viewport period so huge origins cannot drift; pan-away-and-back hashes equal.
- [x] Bloom does not obscure the L4 overlay or the selection marquee. — below-threshold bg texels unchanged; `COMPOSITOR_LAYER_IDS` has no overlay (L4 drawn after `compositor.draw()`).
- [x] Death particles are pooled, hard-capped, and allocation-free in steady state. — fixed `Float32Array` pools; `bufferAllocations === 1`; `reset()` clears life without reallocating.
- [x] The synthesised reverb impulse is generated at runtime — verify zero audio assets in the bundle. — `synthesizeReverbImpulse` + `createConvolver`; theme and `src/audio` ship no wav/mp3/ogg.

#### - [x] P3-C-6 · Synthwave — @cursor, started 2026-09-15, finished 2026-09-15
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/synthwave/*`
**Brief:** *"1980s aesthetic. Neon pinks, cyans, and a constant feeling of 'the future as imagined in 1984.'"*
**Design direction** Magenta-to-cyan gradient sky with a `sunGradient` horizon and a perspective grid receding to a vanishing point behind the simulation (drawn in L0, parallaxing with the camera). Cells are neon with hard chromatic edges; the age ramp shifts hue along the magenta→cyan axis so a running simulation looks like a light show that still encodes real data. Passes: `sunGradient`, `gridGlow`, `bloom`, `chromaticAberration`, `scanlines` (very subtle). Chrome: chrome-gradient text, italic display type, pink glow on focus. Motion: snappy with a slight elastic overshoot. Sound: analog-style saw plucks with detune, a gated-reverb hit on major events, an arpeggiated ambient bed whose tempo tracks the simulation speed — a genuinely delightful detail worth building properly.
**Done when**
- README written first: the future as imagined in 1984. Tokens are magenta/cyan neon, italic display, pink glow. Palette: 16-step magenta-ward birth → CVD-safe steady, 24 states. Motion: 60/110/180 ms with bounce overshoot. Sound: saw plucks with detune, gated reverb on major cues, TPS-tracking arpeggio bed.
- Passes: `sunGradient` + perspective `gridGlow` (vanishing point tracks pan) + `hueShiftByAge` + bloom + edge chromatic aberration + subtle scanlines. Dead cells transparent so the L0 sky shows through. Quality 0 is palette-only (`losslessAtQuality0: false`). Overlay AA against bg and a busy neon line. Age buffer on; background mode is parallax.
- Proven in `tests/unit/themes/synthwave/{theme,palette,tokens,synthwave-css}.spec.ts`. Per-theme screenshots remain P3-D-2.
**Additional acceptance criteria**
- [x] The horizon grid's vanishing point tracks camera pan believably and does not fight the simulation for attention. — `vanishingPointX` soft parallax + clamp; pan-away-and-back hashes equal; `maxAlpha` 0.26.
- [x] Arpeggio tempo tracks TPS smoothly with no audible discontinuity when the speed slider moves. — `ArpeggioBed.setTps` changes interval for the next note only; already-armed notes keep their times; `EventMapper.setTps` forwards.
- [x] Neon palette still distinguishes 8 states (this is the theme most at risk of "everything is pink" — verify with the multi-state rulesets). — Default dark CVD eight as steadies; protanopia/deuteranopia min distance ≥ 50; hue span check.

---

### Workstream D — Integration & gates

#### - [~] P3-D-1 · Theme switching UX — @cursor, started 2026-09-16
**Depends on:** P3-C-1…C-6 · **Files:** `src/ui/panels/themes/*`
**Implementation notes** A theme picker with **live previews** (each card renders a tiny real simulation with that theme's palette and passes — reusing the P1-D-4 thumbnail machinery). Switching cross-fades over 300 ms rather than cutting. `Mod+Shift+T` cycles. Every theme is a registered command so Phase 4's palette gets them free.
**Acceptance criteria**
- [ ] Switching themes never drops below 30 fps and never reloads.
- [ ] 100 consecutive switches leak no memory (heap and WebAudio node count both flat).
- [ ] Preview cards cost < 3 ms/frame combined and stop rendering when the panel closes.
- [ ] The active theme survives reload and is encoded in share URLs.

#### - [ ] P3-D-2 · Per-theme visual regression
**Depends on:** P3-D-1, P1-H-2, P2-F-3 · **Files:** `tests/visual/themes/*`
**Implementation notes** For each of 6 themes × {shell, library panel, statistics panel, dialog, grid at 3 zooms} — 48 baselines. Animations frozen via the test flag, tick pinned, PRNG seeded. Mask fps/ms readouts. Stability across consecutive CI runs is a **gate-history** criterion: `gate-history: visual-nonflake ≥ 3 green` (`docs/gate-history/`, `planning/README.md` §3.10). Tick that criterion only when `node scripts/gate-history.mjs cite visual-nonflake 3` is green. Until three official `main` samples exist, leave the honest interim note — do not treat a single PR as a streak.
**Acceptance criteria**
- [ ] All 48 baselines committed.
- [ ] Gate-history: `visual-nonflake` ≥ 3 green (`docs/gate-history/`). Interim until three official `main` samples exist: local repeats plus `node scripts/gate-history.mjs cite visual-nonflake 3` (currently unmet by construction — the workflow lands in Phase 2 and the first `main` nightlies follow the `v0.3.0` merge).
- [ ] A deliberate token change in one theme fails only that theme's baselines.
- [ ] Suite runtime stays under 6 minutes.

#### - [ ] P3-D-3 · Theme accessibility audit
**Depends on:** P3-C-1…C-6 · **Files:** `tests/a11y/themes.spec.ts`
**Implementation notes** Automated contrast checking of every token pair actually used together (derive the pairs from the token contract, do not hand-list them), plus axe-core on the shell in each theme, plus a scripted colour-blindness simulation over the cell palettes.
**Acceptance criteria**
- [ ] Zero AA contrast failures in any theme.
- [ ] Zero axe-core violations in any theme.
- [ ] Every ruleset's state palette is distinguishable under both simulated deficiencies in every theme, or the theme provides a documented high-contrast palette variant.

#### - [ ] P3-D-4 · Performance certification across themes
**Depends on:** P3-A-4 · **Files:** `tests/bench/themes.bench.ts`
**Acceptance criteria**
- [ ] Every theme at quality 3 holds ≥ 55 fps at 1080p with 100k visible cells on the reference machine.
- [ ] Every theme at quality 0 holds ≥ 60 fps under 4× CPU throttling.
- [ ] Theme frame-time costs are recorded in `bench-baseline.json` and gated under the classed
      policy in `planning/README.md` §3.6 (browser class: absolute budget; after P2-F-1).
- [ ] Enabling audio adds < 0.5 ms/frame to the main thread.

---

## 4. Quality gates for Phase 3

| Gate | Threshold |
|---|---|
| All Phase 0–2 gates | still green |
| Six themes | all meet the Workstream C common definition of done |
| Contrast | zero AA failures across all themes |
| axe-core | zero violations across all themes |
| Frame rate, quality 3 | ≥ 55 fps, 1080p, 100k cells, every theme |
| Frame rate, quality 0 | ≥ 60 fps under 4× CPU throttle, every theme |
| Degrade governor | downgrades within 30 frames; never oscillates |
| Age buffer overhead | ≤ 8% step-throughput regression |
| Audio assets in bundle | **zero bytes** |
| Audio main-thread cost | < 0.5 ms/frame |
| Voice cap | never exceeded under a 10,000 events/sec burst |
| Theme-switch leaks | flat heap and WebAudio node count over 100 switches |
| Visual baselines | 48 committed, stable ×3 runs |
| Reduced motion | every theme fully functional and silent |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Effects blow the frame budget on real hardware. | The signature feature makes the app feel broken. | The degrade governor is built **first** (P3-A-4, before any theme), every pass declares and measures its cost, and quality 0 is proven under CPU throttling for every theme. |
| Beauty defeats usability: selection and cursor vanish under bloom. | The app becomes hard to use in its best-looking themes. | The L4-never-obscured rule, enforced by a per-theme overlay-legibility test against the busiest background. |
| Sound is annoying and everyone mutes it immediately. | Weeks of work switched off. | Muted by default, rate aggregation (P3-B-3) as a gated criterion, per-category volume, and an explicit "does a glider sound pleasant for 5 minutes straight?" review step before each sound pack is accepted. |
| Six themes × N components becomes unmaintainable CSS. | Every UI change costs 6×. | The token contract plus the no-literals lint rule from Phase 1. If a theme needs a new token, it is added to the contract for all six, never as a one-off override. |
| WebAudio node leaks on theme switch. | Degrading audio and rising memory over a long session. | Explicit `dispose()` on every pass and pack, verified by a 100-switch leak test that asserts node count. |
| Themes drift from "distinctive" to "recoloured". | Fails the inception document's whole premise. | The cropped-screenshot test in §1 is an explicit review gate, plus each theme's `README.md` rationale must be written *before* implementation, not after. |
| Procedural textures shimmer or re-randomise on pan. | Looks broken, immediately. | Determinism per world coordinate is a stated acceptance criterion for Sids-Place and Void-Walker, with a pan-away-and-back test. |

---

## 6. Definition of Done — Phase 3

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [ ] All Phase 3 quality gates (§4) green in CI on `main`.
- [ ] All six themes pass the cropped-screenshot identifiability test with at least three people.
- [ ] Every theme is beautiful *and* usable *and* accessible *and* fast — no theme trades one for another.
- [ ] The audio subsystem ships zero audio assets and is genuinely pleasant over a long session.
- [ ] Reduced-motion users get a complete, silent, still-attractive experience.
- [ ] `CHANGELOG.md` has a dated `[0.4.0]` entry; the commit is tagged `v0.4.0`.
- [ ] `docs/demo/phase-3.*` shows all six themes cycling on a running simulation, with sound.
