# Phase 3 — The Theme Engine

> *"Stay Fancy: if a feature is 'boring', find a way to make it visually interesting."*
> *"Deep theme set with unique animations."*

| | |
|---|---|
| **Status** | ☐ Not started |
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

#### - [ ] P3-A-1 · Layered compositor
**Depends on:** Phase 2 · **Files:** `src/render/compositor.ts`, `src/render/layers.ts`
**Implementation notes** Own the offscreen canvases for L0–L3, resize them with the viewport at correct dpr, and composite in one pass. L0 repaints only when the camera or theme changes (parallax backgrounds repaint on pan; static ones do not). L1 keeps Phase 0's dirty-rect behaviour intact — **the compositor must not force full repaints of the cell layer.**
**Acceptance criteria**
- [ ] With all effects disabled, frame time is within 5% of the Phase 2 baseline (the compositor itself is nearly free).
- [ ] Dirty-rect draw-call counts from P0-H-3's recorder are unchanged for the cell layer.
- [ ] Offscreen canvases are reallocated only on resize, never per frame (allocation assertion).

#### - [ ] P3-A-2 · Age buffer
**Depends on:** P3-A-1 · **Files:** `src/engine/grid/chunk.ts`, `src/worker/handler.ts`, `src/render/types.ts`
**Implementation notes** Per-chunk `Uint16Array(1024)`, incremented for unchanged cells and reset on change — do this inside the existing step loop, not as a second pass. Saturate rather than wrap. Allocate lazily: only chunks that have ever been non-empty carry one, and it is optional (themes that do not use it can request frames without it).
**Acceptance criteria**
- [ ] Step throughput regression ≤ 8% with the age buffer enabled (bench-gated).
- [ ] Ages are exact after 10,000 generations (property test against a reference computation).
- [ ] Disabling the age buffer restores the exact Phase 2 benchmark numbers.

#### - [ ] P3-A-3 · Effect pass framework & registry
**Depends on:** P3-A-1 · **Files:** `src/render/effects/{pass,registry,ctx}.ts`
**Acceptance criteria**
- [ ] A no-op pass adds < 0.1 ms.
- [ ] Passes are hot-swappable on theme change with no canvas reallocation and no flicker.
- [ ] `dispose()` is verified to release every offscreen canvas and every WebAudio node (leak test over 100 theme switches).

#### - [ ] P3-A-4 · Degrade governor
**Depends on:** P3-A-3 · **Files:** `src/render/quality-governor.ts`
**Implementation notes** Exactly the policy in §2.3, with hysteresis so it cannot oscillate. Expose current quality, the reason for the last change, and a manual pin in settings.
**Acceptance criteria**
- [ ] A synthetic 40 ms pass triggers a downgrade within 30 frames and the app returns to ≥ 55 fps.
- [ ] Quality never oscillates: a 100-frame test at a borderline cost shows at most one transition.
- [ ] The indicator explains *which* passes were dropped, in plain language.
- [ ] Quality 0 is proven to hit 60 fps on a throttled 4× CPU-slowdown profile for every theme.

#### - [ ] P3-A-5 · Effect library
**Depends on:** P3-A-3 · **Files:** `src/render/effects/*.ts`
**Ship these reusable passes** (each parameterised, each used by ≥ 1 theme):
`bloom` (downsample-blur-add), `scanlines`, `chromaticAberration`, `vignette`, `filmGrain`, `crtCurvature`, `phosphorDecay`, `starfield` (parallax, seeded), `parchmentTexture` (procedural, generated once), `gridGlow`, `birthFlash`, `deathParticles`, `trailFade`, `hueShiftByAge`, `sunGradient` (Synthwave horizon), `textRain` (Flatline).
**Implementation notes** Blur via separable box-blur on a half-resolution buffer — a true Gaussian is not worth 4× the cost at this scale. Every procedural texture is generated once at theme activation into an offscreen canvas and reused. Particle systems use a preallocated pool with a hard cap and no per-particle allocation.
**Acceptance criteria**
- [ ] Every pass has a unit test asserting deterministic output from a seeded input (via the recorder / pixel hash).
- [ ] Every pass declares and honours a measured cost; the sum for the most expensive theme fits the frame budget at quality 3 on a mid-range machine.
- [ ] Particle systems are allocation-free in steady state and hard-capped.

#### - [ ] P3-A-6 · Motion system
**Depends on:** Phase 1 tokens · **Files:** `src/themes/motion/{easing,choreography,animate}.ts`
**Implementation notes** Hand-written cubic-bézier solver (Newton–Raphson, ~30 lines) and a spring solver. `animate()` uses the Web Animations API where available and falls back to rAF. All existing Phase 1/2 components are migrated to it in this task — that migration is the point.
**Acceptance criteria**
- [ ] Every panel, dialog, toast and tooltip animates through the motion system; a lint rule bans raw CSS `transition` on those components.
- [ ] Reduced motion collapses every choreography to an instant state change with no exceptions.
- [ ] Animations do not force layout thrash (asserted: no forced reflow in a performance trace over 100 transitions).

---

### Workstream B — Audio

#### - [ ] P3-B-1 · Audio context, mixer, policy
**Depends on:** Phase 2 · **Files:** `src/audio/{context,mixer,policy}.ts`
**Implementation notes** Lazy context creation; unlock on the first user gesture; suspend on `visibilitychange` and on simulation pause; a master limiter so no theme can be painfully loud; per-bus gain with smooth ramps (never a click). Persist mute and volume.
**Acceptance criteria**
- [ ] No `AudioContext` is created before a user gesture (no console warnings in any browser).
- [ ] Muting is instantaneous and silent (ramped, no click).
- [ ] Tab-hide suspends the context; unhide resumes without a glitch.
- [ ] Zero audio files in `dist/`.

#### - [ ] P3-B-2 · Voice primitives & scheduler
**Depends on:** P3-B-1 · **Files:** `src/audio/{voices,scheduler}.ts`
**Implementation notes** Look-ahead scheduling on a 25 ms interval with a 100 ms horizon — `setTimeout`-triggered `start()` calls jitter audibly and will make the whole feature feel cheap. Voices: `blip`, `click`, `sweep`, `noiseBurst`, `pluck`, `pad`, `drone`, each parameterised by pitch, duration, filter and envelope.
**Acceptance criteria**
- [ ] Scheduled events land within 5 ms of their intended time under a 60 fps render load.
- [ ] 24-voice cap enforced with oldest-first stealing; a 1,000-events-per-second burst never exceeds it.
- [ ] Each voice has a unit test asserting the constructed node graph (no audio playback needed).

#### - [ ] P3-B-3 · Event mapping & rate aggregation
**Depends on:** P3-B-2 · **Files:** `src/audio/events.ts`
**Intent:** The difference between "delightful" and "please make it stop."
**Implementation notes** Map simulation and UI events to voices through an aggregator: within each 50 ms window, collapse N births into one voice whose pitch/amplitude encode the count and whose pan encodes the centroid's screen position. Above a rate threshold, cross-fade from discrete events into a continuous texture driven by the birth rate. UI events (tool select, panel open, error) always play discretely.
**Acceptance criteria**
- [ ] At 10,000 births/sec the output is a stable texture with ≤ 20 voices/sec, not a machine-gun.
- [ ] Panning tracks the on-screen centroid of activity (verified via node-graph inspection).
- [ ] A single glider produces a single clean, pleasant tick per generation.
- [ ] Reduced motion or mute silences everything, verified by a graph-state assertion.

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

#### - [ ] P3-C-1 · Default (upgrade)
**Depends on:** P3-A-6 · **Files:** `src/themes/default/*`
**Brief:** *"Simple, grey, basic — the same as you'd expect on every linux distribution ever released. But very compatible and good for large grids."*
**Design direction** Restrained and excellent. Light and dark variants. Motion signature: crisp, short, no bounce — a well-built desktop application. No background pass, no post-process. This theme is the performance reference and the accessibility reference: **it must always be the fastest and the most readable.** Sound pack: minimal, tasteful UI clicks only, no ambient bed.
**Additional acceptance criteria**
- [ ] Fastest of the six themes at every quality level (bench-asserted).
- [ ] The only theme that is fully functional at quality 0 with no visible loss.

#### - [ ] P3-C-2 · Chiba-City
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/chiba-city/*`
**Brief:** *"Retro cyberpunk. Neon accents, scanline overlays, and high-contrast greens."*
**Design direction** Near-black background with a faint cyan grid receding into haze. Cells ignite white-hot on birth and cool through cyan to deep green with age (age ramp). Passes: `scanlines` (subtle, dpr-aware so they never moiré), `bloom` on live cells, `chromaticAberration` at the viewport edges only, `filmGrain`. Chrome: thin neon borders, monospace UI, angular corners, a faint flicker on focus. Motion: fast, mechanical, with a 1-frame overshoot — like a terminal responding. Sound: filtered square-wave blips, a low modem-hum ambient bed, a satisfying mechanical click on tool change.
**Additional acceptance criteria**
- [ ] Scanlines do not moiré at dpr 1, 1.5, 2 or 3 (visual test at each).
- [ ] Bloom is confined to live cells and never washes out the L4 overlay.
- [ ] Readable at zoom levels from `cellSize` 0.5 to 64.

#### - [ ] P3-C-3 · Flatline
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/flatline/*`
**Brief:** *"Retro console. Monochromatic, 'falling' text effects on UI elements."*
**Design direction** Single-hue amber (or user-selectable green/white) phosphor on black. Cells are drawn as glyph-ish blocks with `phosphorDecay` — dead cells leave a fading ghost, which is both beautiful and genuinely informative (you can see where a pattern has been). Passes: `phosphorDecay`, `crtCurvature` (subtle, and off at quality ≤ 1), `scanlines`, `textRain` on the background at very low opacity. Chrome: monospace everything, box-drawing-character borders. **Motion signature is the star**: panels *type themselves in* character by character, values *scramble* to their new digits, and panels dissolve into falling characters on exit. Sound: teletype clatter for UI, a soft hum ambient, a discrete click per generation at low speeds.
**Additional acceptance criteria**
- [ ] The typing choreography is capped so a large panel never takes longer than 400 ms to appear.
- [ ] Under reduced motion, all text appears instantly — no character animation whatsoever.
- [ ] Phosphor ghosts fully clear on grid clear (no permanent burn-in bug).
- [ ] `textRain` costs < 1.5 ms/frame at 1080p.

#### - [ ] P3-C-4 · Sids-Place
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/sids-place/*`
**Brief:** *"CivI look. Gritty textures, parchment-style borders, and medieval-inspired palettes."*
**Design direction** Procedural parchment background (generated once at activation — no image assets), ink-and-ochre palette, serif display type with a modern sans for data. Cells render as slightly irregular hand-drawn tiles whose "wear" comes from the age buffer; multi-state rulesets read as terrain (this theme is the natural home for the "Highlands/Liquid" rule from ADR-001, and the theme README should say so). Chrome: illuminated-manuscript borders drawn procedurally, tabs as vellum tabs. Motion: weighty and slightly slow, with a settle — things have mass. Sound: paper rustle, a wooden clunk on tool change, a low woodwind ambient drone.
**Additional acceptance criteria**
- [ ] Parchment texture is fully procedural, seeded and deterministic; zero image assets.
- [ ] Texture generation costs < 40 ms at activation and never recurs during a session.
- [ ] Cell irregularity is deterministic per world coordinate (panning away and back shows the identical pattern — a "shimmering terrain" bug here would be very visible).
- [ ] Contrast of ink-on-parchment meets AA (this palette is the highest-risk of the six — verify early).

#### - [ ] P3-C-5 · Void-Walker
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/void-walker/*`
**Brief:** *"Deep space. Deep purples, starlight textures, and soft glowing edges for 'alive' cells."*
**Design direction** Near-black violet gradient, parallax `starfield` (three seeded layers that drift with the camera — this is what sells the depth). Cells glow: a soft radial falloff whose intensity and hue are driven by age, newborn cells flaring bright white-violet then settling to a cool purple. Deaths emit a small, short-lived particle puff. Passes: `starfield`, `bloom` (the strongest of any theme), `vignette`, `deathParticles`. Chrome: translucent dark panels with soft light bleeding through the edges, wide letter-spaced type. Motion: slow, floating, ease-out-heavy — nothing snaps. Sound: bell-like plucks with long reverb tails (convolution from a synthesised impulse — still zero assets), a deep evolving pad ambient.
**Additional acceptance criteria**
- [ ] Starfield parallax is stable and deterministic under fast panning and extreme zoom (no popping, no drift accumulation).
- [ ] Bloom does not obscure the L4 overlay or the selection marquee.
- [ ] Death particles are pooled, hard-capped, and allocation-free in steady state.
- [ ] The synthesised reverb impulse is generated at runtime — verify zero audio assets in the bundle.

#### - [ ] P3-C-6 · Synthwave
**Depends on:** P3-A-5, P3-B-3 · **Files:** `src/themes/synthwave/*`
**Brief:** *"1980s aesthetic. Neon pinks, cyans, and a constant feeling of 'the future as imagined in 1984.'"*
**Design direction** Magenta-to-cyan gradient sky with a `sunGradient` horizon and a perspective grid receding to a vanishing point behind the simulation (drawn in L0, parallaxing with the camera). Cells are neon with hard chromatic edges; the age ramp shifts hue along the magenta→cyan axis so a running simulation looks like a light show that still encodes real data. Passes: `sunGradient`, `gridGlow`, `bloom`, `chromaticAberration`, `scanlines` (very subtle). Chrome: chrome-gradient text, italic display type, pink glow on focus. Motion: snappy with a slight elastic overshoot. Sound: analog-style saw plucks with detune, a gated-reverb hit on major events, an arpeggiated ambient bed whose tempo tracks the simulation speed — a genuinely delightful detail worth building properly.
**Additional acceptance criteria**
- [ ] The horizon grid's vanishing point tracks camera pan believably and does not fight the simulation for attention.
- [ ] Arpeggio tempo tracks TPS smoothly with no audible discontinuity when the speed slider moves.
- [ ] Neon palette still distinguishes 8 states (this is the theme most at risk of "everything is pink" — verify with the multi-state rulesets).

---

### Workstream D — Integration & gates

#### - [ ] P3-D-1 · Theme switching UX
**Depends on:** P3-C-1…C-6 · **Files:** `src/ui/panels/themes/*`
**Implementation notes** A theme picker with **live previews** (each card renders a tiny real simulation with that theme's palette and passes — reusing the P1-D-4 thumbnail machinery). Switching cross-fades over 300 ms rather than cutting. `Mod+Shift+T` cycles. Every theme is a registered command so Phase 4's palette gets them free.
**Acceptance criteria**
- [ ] Switching themes never drops below 30 fps and never reloads.
- [ ] 100 consecutive switches leak no memory (heap and WebAudio node count both flat).
- [ ] Preview cards cost < 3 ms/frame combined and stop rendering when the panel closes.
- [ ] The active theme survives reload and is encoded in share URLs.

#### - [ ] P3-D-2 · Per-theme visual regression
**Depends on:** P3-D-1, P1-H-2 · **Files:** `tests/visual/themes/*`
**Implementation notes** For each of 6 themes × {shell, library panel, statistics panel, dialog, grid at 3 zooms} — 48 baselines. Animations frozen via the test flag, tick pinned, PRNG seeded. Mask fps/ms readouts.
**Acceptance criteria**
- [ ] All 48 baselines committed and stable over 3 consecutive CI runs.
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
- [ ] Theme frame-time costs are recorded in `bench-baseline.json` and gated at 10%.
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
