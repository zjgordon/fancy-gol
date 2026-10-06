# Phase 3 Performance Review: why the themes lag and how to ship `v0.4.0`

**Scope:** `phase/3-theme-engine` at `6472aae` (18/19 tasks closed, P3-D-4 `- [!]`), reviewed against
the Phase 3 plan, ADR-005/008/011, `planning/README.md` §3.6/§3.10, and CI.
**Date:** 2026-10-06 · **Branch at writing:** `phase/3-theme-engine` (clean)
**Audience:** the operator, and the agent that picks up the remediation.
**Status:** **decided 2026-10-06.** The operator accepted D1–D6 as recommended. Agents follow the
binding documents below, not this review, for implementation:

- **D1** → ADR-011 amendment (2026-10-06) and **ADR-012**, in `planning/ARCHITECTURE_DECISIONS.md`.
- **D2** → owned by **P3-E-6** (re-capture the 48 baselines, with the reason recorded).
- **D3** → ADR-012 "Effects without a cheap composited form"; owned by **P3-E-2**.
- **D4** → `planning/README.md` §3.6 "What the bundle floor measures"; owned by **P3-E-7**.
- **D5** → `planning/README.md` §3.10 "Merge-then-certify".
- **D6** → `planning/README.md` §3.6 "Two-tier frame-rate gate for themes"; owned by **P3-E-1** / **P3-E-9**.
- The §7 plan → `PHASE_3_THEME_ENGINE.md` **Workstream E (P3-E-1 … P3-E-9)**. P3-D-4 is re-pointed
  to it, and P3-A-4 / P3-A-5's disproved criteria are re-opened with their owning tasks named.
- The §7 Stage 4 rule → `AGENTS.md` §8 (browser run required for `src/render/**` / `src/themes/**`).

Nothing in `src/` was changed by this review.

---

## 0. Verdict in one paragraph

Neither theory is the root cause. **The ambition is achievable, and building the themes before
Phase 5 was not the mistake.** The lag comes from an implementation defect that a verification
blind spot let through. Every post-process pass, and three effects-stage passes, is a hand-written
per-texel JavaScript loop. Each one allocates about 25 MB of full-frame buffers per frame. **In a
real browser those passes never read the real pixels:** `readSourcePixels()` returns a fresh
all-zero buffer for any non-test canvas. So the heaviest themes spend 40–110 ms per frame
computing transparent black and paint nothing visible. The unit tests, the benches and the
declared costs all ran against `SoftwareSurface`, a test double the browser never executes. The
degrade governor then makes it worse: it saw-tooths between quality 3 and 2, so users get ~3–4 s
of slideshow roughly every 14 s. ADR-011 measured the cost correctly but had the mechanism wrong
(there is no `getImageData` anywhere in `src/`). Its remedy is "wait for Phase 5's WebGL2". That
remedy would hold Phase 3 hostage to Phase 5, which depends on Phase 4. **The fix is to rebuild the
effect passes on the GPU-backed parts of Canvas2D (compositing modes, patterns, gradients, scaled
`drawImage`) with no per-texel JS on the per-frame path.** A prototype of Chiba-City's stack built
that way costs 19.7 ms/frame on a CPU software rasterizer (the worst case), and it actually draws
the effects. That work fits inside Phase 3 as a new Workstream E, and it unblocks the merge.

---

## 1. Problem statement (as given)

> The application is not performing adequately and lags badly in all the themes, to the point of
> breaking. Goal: find the cause, plan the remediation, merge this branch with CI green, and start
> Phase 4.

Operator hypotheses under test:

- **H1, over-ambition:** the bars (55 fps @ 1080p, 100k cells, six effect-heavy themes) are too
  high and should come down.
- **H2, order of operations:** themes were built before optimisation (Phase 5), so the lag is
  expected and the sequencing is wrong.

---

## 2. Evidence, measured in a real browser this session

P3-D-4 recorded that "this environment has no Playwright browser". That is no longer true. Headless
Chromium (revision 1237, via the Playwright MCP) ran the app from `vite` at **1920×1080, dpr 1,
`?test=1`, `cellSize` 4.55** (the P3-D-4 viewport), with the simulation running.

**Read these numbers as relative, not absolute.** WebGL reports
`ANGLE … SwiftShader Device (Subzero)`, so this is a *software* rasterizer and every GPU-side
operation is CPU work here. That makes it the pessimistic case. Real hardware will be faster
everywhere *except* the per-texel JS loops, which run on the main thread regardless.

### 2.1 Frame rate per theme and per quality level

| theme | q3 fps | worst frame @ q3 | JS heap @ q3 | q2 fps | q1 fps | q0 fps |
|---|---:|---:|---:|---:|---:|---:|
| default | **60.0** | 28 ms | 16 MB | n/a | n/a | n/a |
| sids-place | **59.8** | 28 ms | 11 MB | n/a | n/a | n/a |
| flatline | **19.0** | 57 ms | **350 MB** | 58.4 | 60.0 | 60.0 |
| void-walker | **13.4** | 80 ms | 249 MB | 60.0 | 59.8 | 60.0 |
| synthwave | **10.0** | 105 ms | 145 MB | 60.0 | 60.0 | 60.0 |
| chiba-city | **8.7** | 118 ms | 145 MB | 59.6 | 60.1 | 60.1 |

**What this shows:** dropping *only the post stage* (q3 → q2) returns every theme to about 60 fps,
even on a software rasterizer. The cell layer, the compositor blits, the backgrounds, particles and
the age buffer are not the problem. Almost all of the cost is the L3 post stage.

### 2.2 The post stage paints nothing

With the simulation paused, the camera nudged and restored to force a redraw, and the display
canvas hashed at each pinned quality:

| theme | hash q3 | hash q2 | hash q0 (control) | q3 ≠ q2? |
|---|---|---|---|---|
| chiba-city | `fe2629f3` | `fe2629f3` | `fe2629f3` | **no** |
| flatline | `9bcc5ad6` | `9bcc5ad6` | `9bcc5ad6` | **no** |
| void-walker | `e2bba348` | `e2bba348` | `1cd80fc` | **no** |
| synthwave | `590fa342` | `590fa342` | `193dd4f4` | **no** |

The control works: q0 differs from q2 for Void-Walker and Synthwave, so the redraw is real. Yet
**quality 3 and quality 2 are byte-identical in all four effect themes.** Bloom, scanlines,
chromatic aberration, vignette, film grain and CRT curvature cost 40–110 ms per frame and change
zero pixels.

The committed visual baselines agree. `chiba-city-grid-z16-visual-linux.png` shows flat mint cells
on near-black, with no scanlines, glow, grain or aberration. `void-walker-grid-z16` shows the
starfield (a `fillRect` background pass, which works) but no bloom and no vignette. **The 48
P3-D-2 baselines have frozen the themes *without* their post effects.** The Phase 3 §1 bar ("a
screenshot is instantly identifiable as that theme with the chrome cropped out") is not met for
Chiba-City, and is weak for the others.

*Open item (resolved 2026-10-06 by P3-E-1; see PHASE_3 §3 for the full write-up):* Chiba-City and
Flatline hashed identically at q0 and q2 because their cell layer paints an opaque
`theme.background`, so `hazeGrid` / `textRain` on L0 are fully occluded (Void-Walker, Synthwave and
Sids-Place declare a transparent `cellLayerBackground` and are not). Separately, P3-E-1 found that
`pin()` left L0 stale, because the compositor only noticed quality changes made *inside* `draw`
(fixed in `371c7cc`); the opaque layer hid that in these two themes. It also found that
`birthFlash` / `deathParticles` never fire (nothing calls `setChangeSummary`) and that
`hueShiftByAge` erases `gridGlow` by `putImageData`ing zeros over its layer. The rendering defects
are in P3-E-3's scope.

### 2.3 The governor saw-tooths (normal user mode)

Chiba-City with the quality pin released, sampled once per second for 30 s:

```
quality: 3 3 3 2 2 2 2 2 2 2 2 2 2 2 3 3 3 3 2 2 2 2 2 2 2 2 2 2 2
avg 46.7 fps · worst frame 182 ms
```

The governor drops to q2 after 30 slow frames (~3–4 s of slideshow). It then sees about 300 fast
frames (~5 s at 60 fps), promotes back to q3 because it has forgotten why it left, and the cycle
repeats. **This is the "breaking" lag users feel.** P3-A-4's "never oscillates" criterion was
proven over 100 frames with a constant synthetic cost, which is too short to see this cycle.

### 2.4 The alternative is affordable (prototype)

On a blank page in the same browser, I composed a Chiba-City-equivalent post stack from native
Canvas2D operations on 1920×1080 `OffscreenCanvas`es with ~100k cells:

- bloom: the cell layer downscaled to ¼ and ⅛ with smoothing, then added back with `'lighter'`
- scanlines: a 1×2 pattern with `'multiply'`
- vignette: a radial gradient baked once, then `'multiply'`
- grain: eight 256² noise tiles baked once, offset per tick, with `'overlay'`

**Result: 19.7 ms/frame on SwiftShader** (pipelined and flushed-every-frame measured the same),
against ~110 ms for the current path. And it *draws the effects*. On a hardware-accelerated canvas
these are a handful of GPU blits, typically well under 2 ms. This is a prototype measurement, not a
certified number. P3-E-2 owns the real one.

### 2.5 Unit suite

`npx vitest run`: **2145 / 2146 pass.** The single failure is the known
`live-route.spec.ts` "100 clients stay in sync" scheduling flake (Phase 3 §4's pre-existing table).
Nothing in the unit suite detects §2.1–§2.3. That is itself a finding (§3.4).

---

## 3. Root cause

Four defects compound. The first two are the cost, the third is the user-visible symptom, and the
fourth is why none of them was caught.

### RC-1 · Per-texel JavaScript plus full-frame allocation on every frame

`src/render/effects/post-passes.ts` and the pixel passes in `effects-passes.ts` all follow the same
shape:

```ts
const src = readSourcePixels(ctx.source, w, h);  // new Uint8ClampedArray(8.3 MB)
const out = src.slice();                         // + 8.3 MB
for (/* 2,073,600 texels */) { … }               // JS on the main thread
writeTargetPixels(ctx.target, out, w, h);        // createImageData → + 8.3 MB, putImageData
```

That is about **25 MB of garbage per pass per frame** (bloom adds a fourth copy). At quality 3 the
total is roughly **75–110 MB per frame** (Chiba-City: bloom + scanlines + aberration + grain).
Allocation churn of about 1 GB/s produces the 350 MB heap peaks and GC pauses. This breaks
`AGENTS.md` §8, "It does not allocate in the hot loop", on the hottest loop in the app.

There is a deeper design error under that. **The effect library was written as if Canvas2D were a
fragment shader.** `globalCompositeOperation`, `createPattern`, gradients and `ctx.filter` appear
*nowhere* in `src/render` or `src/themes`. Those are exactly the parts of Canvas2D that browsers
run on the GPU.

### RC-2 · In the browser the passes read zeros, so effects are invisible

`software-surface.ts`:

```ts
/** Read RGBA from a software canvas (empty buffer when the source is not software-backed). */
export function readSourcePixels(source, width, height) {
  const soft = asSoftware(source);
  if (soft) { … return soft.pixels.slice(); }
  return new Uint8ClampedArray(width * height * 4);   // ← every real OffscreenCanvas lands here
}
```

The layers are real `OffscreenCanvas`es in production (`defaultCanvasFactory`), so every
pixel-reading pass receives transparent black. It processes it at full cost and `putImageData`s
transparent black over the post layer. The function's own comment documents this as intended. It
is a silent no-op, which `AGENTS.md` §8 forbids ("Its failure mode is a legible message, never a
blank screen or a silent no-op"). Commit `37473ac` ("make theme effect blits work on
OffscreenCanvas") fixed `putImageData` but never added the read side.

### RC-3 · The governor has no memory of the cost of what it dropped

`quality-governor.ts` promotes after 300 frames under 12 ms. It does not ask whether the stage it
is about to re-enable was the reason for the drop, even though `TimedPass` already holds that
stage's measured EWMA. The result is the saw-tooth in §2.3. The cost RC-1 creates becomes a
recurring multi-second freeze instead of a one-off degrade.

### RC-4 · Verification ran against a double, never the product

- **Unit tests and pixel hashes** run on `SoftwareSurface`, where `readSourcePixels` *does* return
  pixels. The tests prove the double, not the browser path.
- **`EffectPass.cost` was declared, not measured**, until P3-D-4 (5–70× optimistic). P3-A-5's
  "heaviest stack fits the frame budget" passed on arithmetic.
- **The governor was unhosted** until P3-D-4, so the q0 criteria (P3-A-4, Workstream C) were
  ticked on a synthetic stack.
- **No browser was in the loop during Workstream C.** Thirteen tasks (A-3 … C-6) closed on
  2026-09-15 with "per-theme screenshots remain P3-D-2 (no Playwright browser)". When P3-D-2 did
  capture screenshots, it baselined whatever the browser drew, and nothing compared that against
  the theme briefs.
- **ADR-011's mechanism is wrong.** It says a pass is "`getImageData` → a JS loop →
  `putImageData`" and that "a browser pays exactly what Node pays". There is no `getImageData` call
  in `src/`. Node and the browser pay similar CPU only because both run the loop. Node runs it on
  real pixels, the browser on zeros. ADR-011's conclusion ("GPU post in Phase 5 is the fix, not a
  smaller effect list") follows from that wrong premise.

The repo's own gates were sound in spirit: the measured-not-declared rule and browser-class
budgets were exactly right. They all pointed at a double that diverged from production on the one
behaviour that mattered.

---

## 4. The two hypotheses, assessed

### H1, "the bars are too high": **mostly rejected**

| Evidence | Implication |
|---|---|
| Default and Sids-Place hold 60 fps at 1080p **on a software rasterizer**. | The cell layer, compositor and age buffer already meet budget with headroom. |
| Every theme holds ~60 fps at q2 (backgrounds, particles, trails, haze, sun, grid). | Most of each theme's atmosphere is affordable today. |
| A real, visible Chiba-City post stack costs 19.7 ms on SwiftShader via native compositing. | The q3 ≥ 55 fps bar is reachable on hardware-accelerated canvas. |

Lowering the bars would *hide* RC-1…RC-4, and `AGENTS.md` §9 forbids it anyway. A few bars *are*
mis-specified, though. They need **rewording, not lowering** (decisions D3–D6 in §8):

- **Per-texel geometric warps on Canvas2D.** `crtCurvature`, and per-pixel radial chromatic
  aberration, have no cheap Canvas2D equivalent. Say so honestly: ship a labelled Canvas2D
  substitute now (strip-warp approximation, or an edge-mask fringe) and the exact effect in
  Phase 5's WebGL2 (P5-A-3 already plans that port).
- **"Reference machine" is undefined.** The 55 fps criterion names it but no document defines it.
  Without a definition, CI cannot gate on it.
- **The bundle floor says "excl. themes", but the bench includes them.** `bundle.bench.ts` labels
  the case `client JS bundle gzip (excl. themes)` and then sums *every* JS asset. Themes are
  imported statically. The 135.7 kB "failure" therefore measures a different quantity from the
  §3.6 floor.
- **The gate-history streak criteria cannot be met before the merge.** `visual-nonflake ≥ 3` and
  `browser-bench ≥ 3` count only *official `main`* samples, which can exist only after the merge.
  The DoD wording ("green in CI on `main`") is right, but no rule says these may be outstanding
  *at* merge time. That is a process deadlock, not a performance one.

### H2, "the order of operations": **half right, and the wrong half is the expensive one**

Pulling Phase 5's WebGL2 renderer forward is **not recommended**:

1. It is the largest workstream in the plan (P5-A-1 probe/fallback/context-loss, P5-A-2 cells,
   P5-A-3 shader ports, P5-E-3 a cross-renderer equivalence suite on three browsers), and Phase 5
   depends on Phase 4.
2. **It does not remove the need for this fix.** P5-A-3 says "Canvas2D passes remain the fallback
   and stay tested", and P5-E-2 certifies a "software rendering (no WebGL2)" profile. A Canvas2D
   effect path that is 6× over budget and draws nothing has to be fixed regardless.
3. A composited Canvas2D implementation makes P5-A-3 *easier*. Each pass becomes "a few blends"
   with an obvious shader twin, and P5-E-3's ≤ 3% equivalence target compares against something
   that is actually rendered.

The part of H2 that **is** right concerns *verification* order, not *optimisation* order. Six
themes were built on top of an effect library before anyone had (a) run it in a browser,
(b) measured a single pass at 1080p, or (c) hosted the governor. The plan's own risk table named
"effects blow the frame budget on real hardware" and its mitigation ("every pass declares and
measures its cost"). The measuring half was deferred to the last task of the phase.

### The third explanation

> **An effect library designed as CPU shaders, verified against a test double that diverges from
> the browser, with no browser in the loop until the final gate.**

It is fixable inside Phase 3 without lowering a single bar.

---

## 5. Broader repo review

Strengths worth protecting:

- **The engine, worker and render core are healthy.** The P0 dirty-rect cell renderer, the
  chunked grid, frame coalescing to rAF (`worker/client.ts`) and the age buffer (≤ 8% overhead)
  all hold up in a real browser at 1080p.
- **Process discipline is unusually good.** Measured-not-declared (§3.6), refusing to baseline red
  rows, `- [!]` over a false `- [x]`, and recording ADR-011 instead of leaving it in scrollback are
  all correct instincts. P3-D-4 did the hard thing. It just stopped one step short of looking at
  the screen.
- **The test volume is large and mostly behavioural** (2146 tests, 193 files).

Risks:

- **Proof-against-doubles is a recurring pattern,** not a one-off. `SoftwareSurface`,
  `CanvasRecorder` (records dispatch, not pixels) and synthetic governor stacks each let a
  criterion be ticked without the production path running. AGENTS §8 lists "From Phase 1: the
  Playwright spec for the feature exists and passes", but Workstream C ticked tasks while
  explicitly deferring their browser proof.
- **Wall-clock assertions in unit tests** (the 9-row "pre-existing failures" table in Phase 3 §4)
  make the blocking `verify` job flaky on shared runners. That is a direct threat to "CI passes".
- **Planning overhead vs. product feedback.** Phase 3's documents are thorough, but the feedback
  loop that would have caught this in minutes was never run: open the app and look at Chiba-City.
- **The bundle is growing un-split.** All six themes, their audio and the effect library ship in
  the initial bundle even though only one theme is active.

---

## 6. Recommended strategy

**Rebuild the effect passes as composition, not computation.** On Canvas2D the browser already
gives us a GPU pipeline: `drawImage` (with scaling and smoothing), `globalCompositeOperation`
(`lighter`, `multiply`, `screen`, `overlay`, `destination-out`, `destination-in`),
`globalAlpha`, `createPattern`, gradients and, where supported, `ctx.filter`. Every shipped effect
has a composited equivalent:

| pass | today | composited Canvas2D approach | per-frame JS |
|---|---|---|---|
| `bloom` | threshold + downsample + box-blur + upsample in JS | Source **L1 cells directly**, which makes it confined to live cells by construction (C-2's AC, now actually true). Downscale chain ½→¼→⅛ with smoothing, add back with `'lighter'` at `strength`. `ctx.filter = 'blur()'` is optional where supported. | ~6 blits |
| `scanlines` | per-row JS darken | 1×(2·pitch) pattern baked per dpr, `'multiply'` fill; integer pitch keeps the no-moiré guarantee | 1 fill |
| `vignette` | per-texel sqrt | Radial gradient baked once per resize into an offscreen, `'multiply'` blit | 1 blit |
| `filmGrain` | Mulberry32 per texel | 8 noise tiles baked at activation; per tick pick a tile and offset, `'overlay'` at α. Reduced motion freezes the tile. | 1 fill |
| `chromaticAberration` (edge) | per-texel shifted channel reads | Two tinted copies (`'multiply'` by `#f00` / `#00f`), offset ±shift, masked by a baked edge ring (`'destination-in'`), added with `'lighter'` | ~6 blits |
| `crtCurvature` | per-texel inverse warp | **Decision D3.** Either a strip warp (≈ 32–64 scaled `drawImage` slices) or a labelled substitute (corner mask + edge falloff). The exact warp ships with P5-A-3. | 32–64 blits or 2 |
| `phosphorDecay` | Float32 ghost buffer per texel | A persistent ghost canvas: `'destination-out'` fill at the decay α, then draw L1 with `'lighter'`. `reset()` = `clearRect`. | 2 ops |
| `trailFade` | per-texel prev-frame blend | Same persistence technique as `phosphorDecay` | 2 ops |
| `hueShiftByAge` | per-texel hue rotate | **Delete from the stack.** `Canvas2DRenderer` already applies `theme.palette(state, age)`. Fold the hue shift into Synthwave's age ramp, where it is free and exact. | 0 |
| `gridGlow` | ~15k 1×1 `fillRect`s per frame (stepped lines) | One `Path2D` stroke, cached to an offscreen and redrawn only when the vanishing point moves | 0–1 blit |
| `parchmentTexture` | 8 MB alloc + NN loop per L0 repaint | Bake once into an `OffscreenCanvas` / `ImageBitmap`, then `createPattern` fill | 1 fill |
| `starfield`, `sunGradient`, `hazeGrid`, `textRain`, particles | already `fillRect`-based | Keep. Batch particles into one path. Move `textRain` out of `static` L0 so it can actually fall. | — |

Rules that make this durable:

1. **No per-texel JS and no allocation on the per-frame effect path.** Baking at activation or
   resize is fine. Enforce it with a test (a browser heap-delta check over 300 frames) and a lint
   rule that bans `readSourcePixels` / `getImageData` / `new Uint8ClampedArray` inside
   `render`/`renderTimed`.
2. **Fail loud.** `readSourcePixels` throws on a non-software source instead of returning zeros.
3. **Browser truth for pixels, doubles for structure.** Unit tests assert the *call sequence*
   (`CanvasRecorder` + composite-op logging). Whether an effect is visible and what it costs is
   proven in Chromium.
4. **The governor predicts before it promotes.** It promotes only when
   `currentEwma + lastMeasuredCost(stageToEnable) < upgradeThreshold`. A failed promotion doubles
   the next probe interval.

This keeps every inception promise (six distinctive themes, 55 fps, graceful degrade), honours No
Bloat (no dependency, less code than today), and turns Phase 5's shader port into a translation
rather than a rescue.

---

## 7. Remediation plan

Proposed as a new **Workstream E** in `PHASE_3_THEME_ENGINE.md`. `P3-E-1` is already referenced by
P3-A-4's interim note as the per-theme q0 re-assertion, which fits. No task ID is deleted or
renumbered. P3-D-4 stays `- [!]` until E-2…E-4 land, then is re-run and closed. Sizes are relative
(S/M/L).

### Stage 0: record the decisions (docs only, before any code)

- Amend **ADR-011**: correct the mechanism (no readback, a zero buffer, invisible output), keep
  consequences 1–2 (measured cost, hosted governor), and **withdraw consequence 3's Phase 5
  dependency**.
- Add **ADR-012, "On Canvas2D, effects are composited, not computed"**, carrying rules 1–4 of §6.
- Add Workstream E to the Phase 3 doc and re-point P3-D-4's block from "Phase 5" to E-2…E-4.
  Regenerate the dashboard.

### Stage 1: make the truth visible (red first)

| id | task | size | done when |
|---|---|---|---|
| **P3-E-1** | **Browser-truth harness.** Get the `browser-bench` Playwright project running locally and in a blocking CI job (pin/resolve the Chromium revision; this sandbox has 1237). Add per-stage timings to `window.__fancyGol`. Add an **effect-liveness spec**: for every theme, each enabled stage changes pixels (q3≠q2 when post passes exist, q2≠q1 when effects passes exist, q1≠q0 when background passes exist). Add a heap-delta check over 300 frames. Resolve the §2.2 open item. | M | Liveness spec is **red today** for all four effect themes and committed red-first. |

### Stage 2: fix the cause

| id | task | size | done when |
|---|---|---|---|
| **P3-E-2** | **Composited post passes** per §6: bloom, scanlines, vignette, grain, chromatic aberration, CRT (per D3). Delete the per-texel paths. | L | Liveness green. Heaviest post stack ≤ 4 ms on a hardware-accelerated reference, and within the CI budget from D6. Zero steady-state allocation. |
| **P3-E-3** | **Composited effects/background passes:** phosphor/trail persistence canvases, `hueShiftByAge` folded into Synthwave's palette, cached `gridGlow`, parchment as a pattern, `textRain` out of static L0. | M | Same as E-2 for the effects/background stages. Flatline's phosphor ghosts are *visible*, and a grid clear wipes them. |
| **P3-E-4** | **Predictive governor:** cost-aware promotion and exponential probe backoff. Check the indicator text while degraded: it read empty at the end of the §2.3 run, though that may have been a sampling race. | S | A 3,000-frame test with a real stage-cost model shows ≤ 1 transition. The browser saw-tooth from §2.3 is gone. |
| **P3-E-5** | **Fail-loud surfaces and doubles:** `readSourcePixels` throws outside tests, the lint rule from §6.1, and `SoftwareSurface` gains the composite ops the new passes use (or tests move to call-sequence assertions). Re-derive declared costs from browser measurements. | S | Bringing back a per-frame `readSourcePixels` fails lint *and* a test. |

### Stage 3: make CI green and honest

| id | task | size | done when |
|---|---|---|---|
| **P3-E-6** | **Re-capture the 48 baselines** (D2). They change *by design*, because the themes now render their effects. Record the reason in the phase doc and in `docs/gate-history`. Run the cropped-screenshot identifiability check (§6 DoD) on the new captures. | S | `--project=visual` green. Each theme is identifiable with the chrome cropped. |
| **P3-E-7** | **Theme code-splitting:** dynamic `import()` per theme module (Default stays eager), a preload hint on hover in the picker, and a bundle bench that measures what §3.6 actually defines (excl. themes) plus a new per-theme chunk budget (D4). | M | `client-js-gzip` ≤ 120 kB *as defined*. Each theme chunk is under its budget. Cold load is unchanged or better. |
| **P3-E-8** | **CI de-flake:** move the 9 wall-clock unit assertions (Phase 3 §4 table) into the bench classes they belong to, or onto calibration ratios. Rewrite `live-route` to wait on a condition, not a duration. Thresholds are not loosened. | S | `npm run coverage` is green 10/10 on a CI runner. |

### Stage 4: close the phase

1. Re-run **P3-D-4** end to end in the browser and tick AC1/AC2 on real measurements, or keep
   them `- [!]` with numbers.
2. Run `npm run verify` and `npm run bench`, regenerate the dashboard, and add the `[0.4.0]`
   changelog entry.
3. Merge to `main` and tag `v0.4.0`. The gate-history criteria (`visual-nonflake`,
   `browser-bench`) accumulate on `main` under D5 and are ticked when the cite is green.
4. Before cutting `phase/4-power-ux`, add an `AGENTS.md` §8 rule: **a task touching `src/render/**`
   or `src/themes/**` is not `- [x]` without a browser run. If no browser is available, it is
   `- [!]`, not `- [x]`.**

**Optional stopgap.** The post stage currently changes zero pixels in the browser. Skipping the
per-texel passes on non-software surfaces would restore ~60 fps immediately with *byte-identical*
output. It is worth doing only if a demo is needed before E-2 lands, and it must be labelled as a
stopgap in the code and the phase doc so it does not pass for the fix.

---

## 8. Decisions needed from the operator

Per `AGENTS.md` §10, these are escalations, not agent calls:

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Accept ADR-012 and amend ADR-011, removing Phase 3's dependency on Phase 5. | **Accept.** |
| **D2** | Re-capture all 48 visual baselines. This is re-baselining, which `AGENTS.md` §9 allows only with an investigation and a recorded reason. This review is the investigation. | **Accept** once E-2/E-3 land. |
| **D3** | `crtCurvature` (and the exact radial aberration) on Canvas2D: strip-warp approximation, or a labelled substitute with the exact effect in WebGL2? | **Labelled substitute now, exact effect in P5-A-3.** "Never present an approximation as exact" is satisfied by the label. |
| **D4** | The bundle bench measures the floor as written ("excl. themes"), themes are code-split, and a per-theme chunk budget is added. | **Accept.** This aligns the measurement with the stated gate and adds a new gate. It does not loosen one. |
| **D5** | A "merge-then-certify" rule in §3.10: gate-history streak criteria may be outstanding at merge if every non-history gate is green and ≥ 1 branch-dispatch sample is green; they are ticked from `main`'s official streak. | **Accept.** Without it, Phase 3 cannot merge by construction. |
| **D6** | Define the "reference machine" and the blocking CI form of the frame gate. | **Two tiers.** CI blocks on liveness, zero allocation, and each theme's q3 frame ≤ *k*× Default's frame on the same runner (a calibration ratio, consistent with §3.6). The absolute ≥ 55 fps is certified nightly on a named GPU-backed machine via `browser-bench`. |

---

## 9. Appendix: how to reproduce §2

```bash
npx vite --port 5179 --strictPort         # client only; /api & /thumbs 502s are expected
# open http://localhost:5179/?test=1 at 1920×1080 in Chromium, then in the console:
#   __fancyGol.setCamera({ cellSize: 4.55 });  await __fancyGol.runCommand('sim.toggleRun');
#   await __fancyGol.runCommand('theme.select.chiba-city');  __fancyGol.pinQuality(3 | 2 | null)
# fps = rAF callbacks over 3 s after a 1.5 s warm-up; liveness = FNV hash of the display
# canvas's getImageData at q3 vs q2 with the sim paused and the camera nudged/restored.
```

Code references: `src/render/effects/software-surface.ts` (`readSourcePixels`, `writeTargetPixels`),
`src/render/effects/post-passes.ts`, `src/render/effects/effects-passes.ts`,
`src/render/compositor.ts` (`runEffectStages`), `src/render/quality-governor.ts`,
`src/client/quality.ts`, `src/themes/*/quality.ts`, `tests/bench/bundle.bench.ts`,
`tests/perf/themes-fps.spec.ts`.

*Stay fancy.*
