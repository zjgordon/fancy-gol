# Phase 5 — Scale & Performance

> *"The 'Infinite' Horizon: support grid sizes that would crash a standard browser implementation of a 2D array."*
> *"Performance by default: sparse hash-set for large grids; dirty-rect rendering; no re-render unless state changes."*

| | |
|---|---|
| **Status** | ☐ Not started |
| **Ships version** | `0.6.0` |
| **Prerequisites** | Phase 4 complete and tagged `v0.5.0`. |
| **Theme of the phase** | **Make it enormous.** |
| **The demo that proves it** | Load a 10-million-live-cell breeder into a 1,000,000 × 1,000,000 world. Zoom out until the whole civilisation is a shimmering density field, zoom back into a single glider, and run the whole thing at 60 fps in Void-Walker with bloom on. Then run the same thing on a five-year-old laptop and watch it degrade gracefully instead of dying. |

---

## 1. Objectives

1. **WebGL2 renderer** implementing the ADR-005 `Renderer` interface, with theme shader ports, feature detection, and automatic fallback to Canvas2D.
2. **Density LOD** — the only way a 10⁸-cell world is displayable at all.
3. **Engine kernel optimisation** — a bitboard fast path for 2-state Moore totalistic rules, incremental neighbour maintenance, and chunk-level skipping.
4. **HashLife** (optional, boundaried) — quadtree memoisation for enormous deterministic Conway-class runs.
5. **OffscreenCanvas + SharedArrayBuffer** — move rendering into the worker and eliminate per-frame copies.
6. **Memory discipline at scale** — chunk eviction, history budget enforcement, and honest reporting everywhere.
7. **Tighten every budget** to the Phase 5 column of README §3.6 and prove it on low-end hardware.

### The non-negotiable constraint
**Nothing in this phase may change behaviour.** Every optimisation is validated against the existing engine as an oracle. If a fast path disagrees with the reference implementation on any input, the fast path is wrong.

---

## 2. Architecture introduced in this phase

### 2.1 Renderer selection

```
capability probe at boot
  ├─ WebGL2 available && not blocklisted && shader compile smoke-test passes
  │     └─▶ WebGL2Renderer         (theme shaders, instanced cells, GPU post-process)
  └─ otherwise
        └─▶ Canvas2DRenderer       (Phases 0–4, unchanged and still fully supported)

runtime fallback: a GPU context loss or a shader failure swaps to Canvas2D
                  mid-session with a toast, never a blank screen.
```

The Canvas2D renderer is not deprecated. It remains a first-class, tested path — it is what runs on locked-down machines, in software rendering, and in CI.

### 2.2 Level of detail

| `cellSize` (device px) | Path | Technique |
|---|---|---|
| ≥ 4 | **Cells** | Instanced quads (WebGL2) / batched fills (Canvas2D). Full theme cell rendering. |
| 1 – 4 | **Tiles** | Pre-rasterised 32×32 chunk tiles in a texture atlas, invalidated per dirty chunk. |
| 0.05 – 1 | **Density** | One texel per chunk carrying population and dominant state; rendered as a heat field through the theme's ramp. |
| < 0.05 | **Extent** | Bounding-box outline plus a chunk-occupancy minimap. |

The density path reads the per-chunk population that ADR-010 has maintained since Phase 0 and that Phase 2's entropy work already consumes. **Three features, one data structure, zero extra cost** — this is the payoff for getting the grid right at the start.

### 2.3 Bitboard fast path

For the specific, very common case of **2 states, Moore radius 1, outer-totalistic** (Conway, HighLife, Day & Night, Seeds, Maze, Diamoeba, 2×2, Life-without-Death — the great majority of what people run):

Represent each 32-row chunk as 32 `Uint32` words. Neighbour counting becomes word-parallel bit arithmetic: three shifted row-triples combined with a carry-save adder network yields the 0–8 neighbour count for 32 cells in ~20 integer operations, versus ~256 for the scalar path.

```
for each row r:
    above = w[r-1], mid = w[r], below = w[r+1]     (with halo words from adjacent chunks)
    (a1,a0) = halfAdder(above<<1, above>>1)         // horizontal neighbours, 3 rows
    ...carry-save network...
    next[r] = (count == 3) | (mid & (count == 2))   // B3/S23 expressed as bit masks
```

The birth/survival masks come from the compiled rule, so this is **one kernel for the entire outer-totalistic 2-state family**, not a Conway special case. That distinction matters: a Conway-only hack would violate ADR-001's "rules are data, not code branches".

`CompiledRule` gains `kernel: 'scalar' | 'bitboard' | 'hashlife'`, selected by the compiler (extending P0-D-4's strategy table). The multi-state scalar kernel remains the reference implementation and the oracle.

### 2.4 HashLife (optional workstream)

Quadtree canonicalisation with memoised 2ⁿ-generation jumps. Astonishing on regular patterns (a breeder at generation 2⁶⁴ in milliseconds), useless on chaotic soups, and incompatible with per-tick statistics and interactive editing.

**Boundaries, stated up front:** HashLife is an explicitly opt-in "turbo" mode for deterministic 2-state rules. When active, per-tick stats and the timeline switch to a coarser mode and the UI says so plainly. It is a bounded workstream (P5-D) that may be cut in full without affecting any other Phase 5 deliverable — if it is cut, mark P5-D `- [-]` and move on.

### 2.5 Threading upgrades

- **OffscreenCanvas**: transfer the canvas to the worker so rendering happens off the main thread entirely. The main thread then does input and DOM only, and the frame budget stops competing with layout. Requires the `render/` layer to be DOM-free — it already is, by ADR-009.
- **SharedArrayBuffer**: with COOP/COEP headers (served by our own Express server, so this is under our control), the renderer reads grid state with no transfer at all. Guarded by `crossOriginIsolated`; the transfer path remains and is still tested.

---

## 3. Workstreams & tasks

---

### Workstream A — WebGL2 renderer

#### - [ ] P5-A-1 · GL context, capability probe, fallback
**Depends on:** Phase 4 · **Files:** `src/render/webgl2/{context,probe,fallback}.ts`
**Implementation notes** Probe for WebGL2, required extensions, max texture size, and run a shader-compile smoke test before committing to the path (a context that exists but cannot compile is worse than none). Handle `webglcontextlost`/`restored`. On any failure, swap to Canvas2D live, preserving camera and state, with a toast.
**Acceptance criteria**
- [ ] Forcing a context loss mid-run recovers to a working Canvas2D view within 500 ms with no state loss.
- [ ] The probe correctly rejects a software/blocklisted context and falls back before the user sees anything.
- [ ] A `?renderer=canvas2d` override exists for testing and support, and is documented.

#### - [ ] P5-A-2 · Cell rendering
**Depends on:** P5-A-1 · **Files:** `src/render/webgl2/cells.ts`
**Implementation notes** Upload chunk state as `R8UI` textures, one texture per chunk in a pooled atlas, updated only for dirty chunks (`texSubImage2D` on the dirty sub-rectangle — never a full re-upload). Draw with a single instanced call over visible chunks. The fragment shader samples state and age and maps through the theme's palette texture.
**Acceptance criteria**
- [ ] 1,000,000 visible cells render in ≤ 4 ms.
- [ ] Uploads are proportional to dirty chunks, not total chunks (asserted by counting GL calls).
- [ ] Output is pixel-identical to Canvas2D at quality 0 within a 1% tolerance, for all 6 themes at 3 zoom levels (cross-renderer visual test).
- [ ] Texture pool is bounded and reuses allocations — no growth over a 10-minute pan-and-zoom session.

#### - [ ] P5-A-3 · Theme shader ports
**Depends on:** P5-A-2, P3-A-5 · **Files:** `src/themes/*/shaders/*.glsl`, `src/render/webgl2/post.ts`
**Implementation notes** Port the Phase 3 effect passes to fragment shaders: bloom (proper multi-pass downsample/upsample now that it is cheap), scanlines, chromatic aberration, vignette, grain, phosphor decay, starfield, hue-shift-by-age. Each theme's `shaders` field (declared in ADR-008 and unused until now) is finally consumed. Canvas2D passes remain the fallback and stay tested.
**Acceptance criteria**
- [ ] Every effect exists in both implementations and looks equivalent (side-by-side visual test, ≤ 3% pixel difference at matched quality).
- [ ] The GPU post-process chain costs ≤ 3 ms at 1080p for the heaviest theme.
- [ ] All shaders compile on Chromium, Firefox and WebKit; compile failures fall back per-pass, not wholesale.

#### - [ ] P5-A-4 · Density LOD
**Depends on:** P5-A-2 · **Files:** `src/render/lod/{density,extent}.ts`
**Implementation notes** Build an `RG16UI` texture of per-chunk (population, dominantState) and render it as a full-screen quad through the theme's density ramp, with bilinear smoothing and a sharpness control. This is one of the most visually striking things in the whole product — a civilisation viewed from orbit — and it should be treated as a feature, not a fallback.
**Acceptance criteria**
- [ ] A 10⁸-addressable-cell world with 10⁷ live cells renders at ≥ 60 fps in density mode.
- [ ] LOD transitions are cross-faded across a zoom band, with no visible pop.
- [ ] Density colours derive from theme tokens and are correct in all six themes.
- [ ] The density texture updates incrementally from dirty chunks only.

---

### Workstream B — Engine kernels

#### - [ ] P5-B-1 · Bitboard kernel
**Depends on:** Phase 4 · **Files:** `src/engine/kernels/bitboard.ts`, `src/engine/rules/compile.ts`
**Implementation notes** Exactly §2.3, parameterised by the compiled birth/survival masks so it serves the whole 2-state outer-totalistic family. Halo words come from the four edge-adjacent chunks; corners handled explicitly. The scalar kernel remains the reference.
**Acceptance criteria**
- [ ] **Equivalence gate:** for 10,000 random 32×32 chunk configurations × 8 rulesets × all four boundary conditions, bitboard output is byte-identical to scalar output. This test is the whole justification for the kernel existing.
- [ ] All ADR-004 oracle tests pass with the bitboard kernel selected.
- [ ] ≥ 6× speedup over scalar on the 512² soup benchmark.
- [ ] Falls back to scalar automatically for any rule outside its domain, verified for each builtin.

#### - [ ] P5-B-2 · Chunk skipping & activity tracking
**Depends on:** P5-B-1 · **Files:** `src/engine/grid/chunked-grid.ts`, `src/engine/simulation.ts`
**Implementation notes** A chunk whose interior is uniformly a `stableWhenIsolated` state and whose border neighbours are unchanged cannot change — skip it entirely. Maintain this with the existing `borderMask` plus a per-chunk `stableSince` counter. Correctness risk is real (a wrongly skipped chunk is a silent, catastrophic bug), so this task's tests matter more than its speed.
**Acceptance criteria**
- [ ] **Equivalence gate:** 10,000 generations across 8 rulesets and 20 seeds, with and without skipping, produce byte-identical state at every generation.
- [ ] A 4096² world at 1% density achieves ≥ 60 steps/sec.
- [ ] A pathological all-active field is not slowed by more than 3% versus no skipping (the check must not cost more than it saves).

#### - [ ] P5-B-3 · Memory discipline at scale
**Depends on:** P5-B-2 · **Files:** `src/engine/grid/chunked-grid.ts`, `src/engine/history/journal.ts`
**Implementation notes** Chunk pooling with a high-water mark and trimming; history eviction that reports; a hard total-memory ceiling with a warning threshold; and `navigator.deviceMemory`-informed defaults. Everything is reported — the memory meter from Phase 4 becomes accurate at scale here.
**Acceptance criteria**
- [ ] A 10⁷-live-cell simulation runs for 100,000 generations with flat memory (measured every 1,000 generations).
- [ ] Approaching the ceiling produces a warning and a documented degradation (history depth reduces first, then a clear refusal), never a crash.
- [ ] Reported memory is within 10% of actual heap usage.

---

### Workstream C — Threading

#### - [ ] P5-C-1 · OffscreenCanvas rendering
**Depends on:** P5-A-2 · **Files:** `src/worker/render-worker.ts`, `src/client/main.ts`
**Implementation notes** Transfer the canvas to the worker; the main thread sends only camera and theme updates. Because ADR-009 already forbids DOM access in `render/`, this should be a wiring change rather than a rewrite — if it is not, that is a boundary violation to fix. Keep the main-thread rendering path for browsers without OffscreenCanvas and for the visual test harness.
**Acceptance criteria**
- [ ] Main-thread block time per frame ≤ 1 ms during a 500 TPS run.
- [ ] Input responsiveness is unaffected by simulation load (input-to-pixel p95 ≤ 32 ms even at maximum TPS).
- [ ] Both paths (offscreen and main-thread) are exercised in CI.

#### - [ ] P5-C-2 · SharedArrayBuffer path
**Depends on:** P5-C-1 · **Files:** `src/worker/shared-state.ts`, `src/server/app.ts`
**Implementation notes** Serve COOP/COEP headers from our Express server, gate on `crossOriginIsolated`, and use `Atomics` for a lock-free double-buffered handoff (sequence-number-based, single-writer/single-reader — no locks needed). The transfer path remains fully supported and tested; SAB is an optimisation, not a requirement.
**Acceptance criteria**
- [ ] Zero copies per frame when `crossOriginIsolated` is true (asserted by counting allocations).
- [ ] No tearing under a 1,000 TPS run over 10 minutes (sequence-number validation on every read).
- [ ] Full functionality when SAB is unavailable; both paths covered by CI.
- [ ] COOP/COEP headers do not break any other feature (verify `/live`, share links, and any embedded content).

---

### Workstream D — HashLife *(optional; may be cut in full)*

#### - [ ] P5-D-1 · Quadtree canonicalisation
**Depends on:** P5-B-1 · **Files:** `src/engine/kernels/hashlife/{node,canonical,memo}.ts`
**Acceptance criteria**
- [ ] Canonical nodes are shared: an 8×8 empty region is one node instance regardless of how many times it occurs.
- [ ] The memo table is bounded with LRU eviction and reports its hit rate.

#### - [ ] P5-D-2 · Superspeed stepping
**Depends on:** P5-D-1 · **Files:** `src/engine/kernels/hashlife/step.ts`
**Acceptance criteria**
- [ ] **Equivalence gate:** HashLife and scalar agree exactly at generations 1, 2, 4, …, 4096 for 20 patterns.
- [ ] A breeder reaches generation 2³² in < 5 s.
- [ ] Memory stays bounded on a chaotic soup (where HashLife degrades) — it must not OOM, it must give up and report.

#### - [ ] P5-D-3 · UI integration & honest limits
**Depends on:** P5-D-2
**Implementation notes** An explicit "Turbo (HashLife)" toggle, available only for eligible rulesets. While active: per-tick statistics are unavailable (say so), the timeline switches to a coarse power-of-two mode (say so), and editing exits turbo. **Every limitation is stated in the UI, not in a doc nobody reads.**
**Acceptance criteria**
- [ ] Turbo is offered only when genuinely applicable.
- [ ] Every limitation is visible in the UI while turbo is on.
- [ ] Exiting turbo returns to an exact, fully-featured state at the current generation.

---

### Workstream E — Verification at scale

#### - [ ] P5-E-1 · The stress corpus
**Depends on:** P5-B-2 · **Files:** `tests/bench/scale/*`, `tests/fixtures/scale/*`
**Implementation notes** A committed corpus: 10⁶ and 10⁷ live-cell fields; a 10⁶ × 10⁶ sparse world; a breeder at generation 100,000; a full-density 2048² soup; a 24-state rule at 1024²; and a "worst case" adversarial field designed to defeat chunk skipping. Each runs in CI (the heavy ones nightly).
**Acceptance criteria**
- [ ] Every Phase 5 budget in README §3.6 is met and recorded in `bench-baseline.json`.
- [ ] Nightly CI runs the heavy corpus and reports a trend, not just a pass/fail.
- [ ] The adversarial field is documented with an explanation of why it is adversarial.

#### - [ ] P5-E-2 · Low-end hardware certification
**Depends on:** P5-E-1
**Implementation notes** Profiles: 4× CPU throttle, 6× CPU throttle, 512 MB memory cap, software rendering (no WebGL2), and a mobile viewport. For each, define and assert the *expected* experience — this is about graceful degradation, not about hitting desktop numbers.
**Acceptance criteria**
- [ ] Under every profile the app remains interactive (input-to-pixel p95 ≤ 100 ms) and never crashes.
- [ ] Degradation is announced to the user, not silent.
- [ ] The results are documented in `docs/performance.md` as an honest hardware guide.

#### - [ ] P5-E-3 · Cross-renderer equivalence suite
**Depends on:** P5-A-3 · **Files:** `tests/visual/cross-renderer/*`
**Acceptance criteria**
- [ ] Canvas2D and WebGL2 outputs match within 3% pixel difference for 6 themes × 3 zoom levels × 3 rulesets.
- [ ] Differences beyond tolerance are investigated and either fixed or documented with a rationale — never silently re-baselined.

---

## 4. Quality gates for Phase 5

| Gate | Threshold |
|---|---|
| All Phase 0–4 gates | still green |
| **Behavioural equivalence** | bitboard, chunk-skipping and HashLife all byte-identical to the scalar reference across the full equivalence corpus |
| Conway 512² soup | ≥ 400 steps/sec |
| Conway 4096² @1% | ≥ 60 steps/sec |
| Scale ceiling | 10⁷ live cells in a 10⁶ × 10⁶ world, stable for 100,000 generations |
| Frame time | ≤ 8 ms at 1080p, 10⁶ visible cells, WebGL2, heaviest theme |
| Density LOD | ≥ 60 fps with 10⁷ live cells |
| Main-thread block | ≤ 1 ms/frame at 500 TPS |
| Memory | flat over 100,000 generations at 10⁷ cells; reported within 10% of actual |
| Fallback | full functionality with no WebGL2, no OffscreenCanvas, no SAB |
| Low-end profiles | interactive under all five profiles; degradation announced |
| Cross-renderer | ≤ 3% pixel difference, all themes and zooms |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| An optimisation silently changes simulation results. | Catastrophic and hard to detect — every published pattern behaves subtly wrong. | Equivalence gates are the first acceptance criterion of every kernel task, run over a large random corpus and all oracle tests. The scalar kernel is never deleted; it is the permanent reference. |
| Bitboard halo handling is wrong at chunk corners. | Rare, localised, extremely hard-to-find corruption. | The 10,000-random-chunk equivalence test specifically includes patterns spanning all four corners and all four boundary modes. |
| Chunk skipping wrongly skips an active chunk. | Frozen regions that look plausible. | Full-generation equivalence over 10,000 generations, plus an adversarial fixture, plus a dev-mode assertion that periodically recomputes a skipped chunk and compares. |
| WebGL2 behaves differently across GPUs and drivers. | Works on the developer's machine only. | Cross-renderer equivalence suite in CI on three browsers, a shader-compile smoke test in the probe, per-pass fallback, and live fallback on context loss. |
| COOP/COEP headers break an unrelated feature. | Regression discovered late. | Feature-flagged, with a full regression pass over `/live`, share links, and exports before enabling by default. |
| HashLife expands to consume the phase. | Phase 5 does not land. | It is explicitly optional and boundaried (§2.4). If P5-D is not complete when A, B, C and E are, cut it. |
| Performance work degrades code clarity. | The engine becomes unmaintainable. | Kernels are separate, individually documented files behind one dispatch point. Each carries a comment explaining the technique and linking the equivalence test that guards it. |

---

## 6. Definition of Done — Phase 5

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason (P5-D may legitimately be `- [-]`).
- [ ] All Phase 5 quality gates (§4) green in CI on `main`.
- [ ] Behavioural equivalence is proven, not assumed, for every fast path.
- [ ] The app is fully functional with WebGL2, OffscreenCanvas, and SharedArrayBuffer all unavailable.
- [ ] `docs/performance.md` gives an honest account of what runs where, including on old hardware.
- [ ] The "Infinite Horizon" claim is documented precisely: what the real limits are and why.
- [ ] `CHANGELOG.md` has a dated `[0.6.0]` entry; the commit is tagged `v0.6.0`.
- [ ] `docs/demo/phase-5.*` shows the zoom from a single glider to an orbital density view of ten million cells.
