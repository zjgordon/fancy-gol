# Phase 2 — The Library & The Stat Engine

> *"Play with gliders, make a gosper gun, sure… But also contains alternative rulesets, and catalogs of objects for each ruleset as applicable. Tweak parameters and create your own rulesets, go wild!"*
> *"Do you like math? A full suite of graphs and statistical analysis tools across alive/dead/trends/etc!"*

| | |
|---|---|
| **Status** | ☐ Not started |
| **Ships version** | `0.3.0` |
| **Prerequisites** | Phase 1 complete and tagged `v0.2.0`. |
| **Theme of the phase** | **Make it powerful.** |
| **The demo that proves it** | Search the library for "Gosper", drag the gun onto the grid, open the statistics panel and watch population climb linearly while the birth/death rates oscillate at period 30 — then open the Ruleset Studio, change `B3/S23` to `B36/S23`, hit apply, and watch the same seed behave completely differently, with the divergence visible on the chart. |

---

## 1. Objectives

1. **Pattern I/O** — complete, correct RLE (including multi-state), plaintext, and Life 1.06 codecs, with `#C`/`#N`/`#O`/`#r` header handling.
2. **The Library** — a curated, searchable, filterable catalogue of objects per ruleset with real metadata, animated thumbnails, and one-drag placement.
3. **The Stat Engine** — real-time metrics derived from the `ChangeSet` stream, with cycle detection, growth classification, and long-run downsampling.
4. **The graphs** — a hand-written canvas charting module: time series, stacked area, sparklines, histograms, and a phase-space plot. No charting library (no-bloat rule).
5. **The Ruleset Studio** — "Rule-God Status": author, validate, test, name, save, share, and live-apply custom rulesets from inside the app.
6. **Data export** — CSV/JSON for the researcher; PNG/RLE for everyone else.

### Explicitly *not* in Phase 2
No new themes (Phase 3). No timeline scrubbing or laboratory (Phase 4) — though the stat engine's data model must anticipate both.

---

## 2. Architecture introduced in this phase

### 2.1 Pattern pipeline

```
patterns/*.rle  ──build-time──▶  patterns/index.json  +  thumbnails (generated, committed)
       │                                    │
       │                        scripts/gen-thumbnails.mjs runs the real engine
       │                        headlessly and rasterises N generations to APNG/WebP
       ▼                                    ▼
  server /api/patterns  ◀───────────  client PatternLibrary panel
                                              │  drag / click
                                              ▼
                                        StampTool (Phase 1 interface, unchanged)
```

The Phase 1 stamp tool must not change. If it does, Phase 1's interface was designed wrong — fix the data source, not the tool.

### 2.2 Statistics data model

```ts
export interface StatSample {
  tick: number;
  population: number;
  perState: Uint32Array;
  births: number; deaths: number; transitions: number;
  activity: number;            // changed cells this tick
  density: number;             // population / bounded area, or / bbox area when infinite
  bbox: Rect;
  centroid: { x: number; y: number };
  entropy: number;             // Shannon entropy over a 16×16 block-occupancy histogram
  hash: number;                // Zobrist hash of live state, for cycle detection
}

export interface Series {
  push(s: StatSample): void;
  window(fromTick: number, toTick: number, maxPoints: number): StatSample[];  // LTTB-downsampled
  readonly capacity: number;   // ring buffer, tiered
}
```

**Tiered retention** (this is what makes million-generation runs graphable):
| Tier | Resolution | Span |
|---|---|---|
| 0 | every tick | last 4,096 ticks |
| 1 | every 16th (min/max/mean aggregated) | last 65,536 |
| 2 | every 256th | last 1,048,576 |
| 3 | every 4,096th | unbounded |

Aggregation is min/mean/max per bucket so a chart drawn from tier 2 still shows oscillation envelopes rather than a misleading smooth line. **A chart that hides an oscillation is a lying chart.**

### 2.3 Charting module (`src/ui/charts/`)

```
charts/
├── scale.ts        linear / log / time scales, nice-tick generation
├── axis.ts         axis rendering, tick labels, gridlines
├── series.ts       line, area, stacked-area, stepped, band (min/max envelope)
├── chart.ts        Chart: canvas host, resize, theme tokens, crosshair, tooltip, legend
├── sparkline.ts    inline micro-charts for the status bar and library cards
├── histogram.ts    binning + rendering
└── phase.ts        phase-space scatter/trail (population vs births, etc.)
```

Requirements that make this non-negotiable to write ourselves: it must read colours from theme tokens, render on the same `devicePixelRatio` pipeline, cost under 2 ms/frame for six live charts, and animate under the theme's motion signature in Phase 3. No general-purpose library does those four things.

### 2.4 Cycle & growth detection

- **Zobrist hashing**: a per-(cell, state) random 32-bit table, XOR-updated incrementally from the `ChangeSet` — O(changes), not O(cells).
- Hashes go into a `Map<hash, tick[]>` over the retained window; a repeat with matching population is a **candidate cycle**, confirmed by an exact state comparison against the history journal (ADR-007 — this is a second feature the journal pays for).
- **Growth classification** by fitting population over the last N samples to constant / linear / quadratic / exponential and reporting R². This is how the app tells a user "this looks like a puffer" — genuine research value, and it is roughly 60 lines.

### 2.5 New files

```
src/
├── engine/
│   ├── patterns/{rle,plaintext,life106,apgcode-lite}.ts, normalize.ts, catalog-types.ts
│   └── stats/{zobrist,cycle-detect,growth,entropy,series}.ts
├── ui/
│   ├── charts/                (above)
│   └── panels/{library,statistics,ruleset-studio}/
├── server/routes/patterns.ts  (completed)
scripts/gen-thumbnails.mjs
patterns/<ruleset>/*.rle  +  patterns/index.json
```

---

## 3. Workstreams & tasks

---

### Workstream A — Pattern codecs

#### - [ ] P2-A-1 · RLE decoder (full spec, multi-state)
**Depends on:** Phase 1 · **Files:** `src/engine/patterns/rle.ts`
**Supersedes, with a boundary snag to resolve:** P1-B-5 shipped a minimal, hand-written encode/decode pair in `src/ui/tools/select.ts` (states 0–24 only: `b`, `o`, `A`–`X`; no headers, no `pA`/`qA`-style extended states) just to round-trip a selection through the system clipboard in Phase 1. This task's codec is the real one, but note `ui/` cannot import `engine/` at all (ADR-009) — so `select.ts` cannot simply switch to importing `src/engine/patterns/rle.ts` once it exists. Either give this codec a home reachable from both layers (e.g. `shared/`, alongside `shared/types.ts`'s own precedent for pure logic multiple layers need) or accept `select.ts`'s copy as a permanent, documented boundary-forced duplicate (the same treatment `brush.ts`'s hand-written PRNG already gets for the identical reason). Don't leave it unexamined — pick one and record which.
**Implementation notes**
- Header: `x = 3, y = 3, rule = B3/S23`. Body tokens: run counts, `b` (dead), `o` (alive), `$` (end of row, with run counts), `!` (end).
- **Multi-state (Generations/Golly) extension**: states 2–24 encode as `pA`…`pX`, `qA`…, `rA`… — implement it, because ADR-001 makes multi-state a first-class case and half our builtin rulesets need it.
- Comment lines: `#C`/`#c` comment, `#N` name, `#O` author, `#P`/`#R` offset, `#r` rule (old format).
- Robustness: unknown rule → decode cells anyway and return the rule string for the caller to resolve; malformed input → a `PatternParseError` naming line and column.
**Acceptance criteria**
- [ ] Round-trip `decode(encode(p)) === p` for 500 random multi-state patterns (property test).
- [ ] A corpus of ≥ 40 real-world `.rle` files from the wild (committed as fixtures, with provenance noted) all decode to expected dimensions and populations.
- [ ] Decoding a 100k-cell RLE takes < 30 ms.
- [ ] Every malformed fixture produces a line/column and a hint.

#### - [ ] P2-A-2 · RLE encoder
**Depends on:** P2-A-1
**Implementation notes** Emit canonical, minimal output: trim to bounding box, wrap at 70 columns, emit the rule string, and include `#N`/`#O`/`#C` when metadata is present. Multi-state encoding must match what Golly reads.
**Acceptance criteria**
- [ ] Output for the standard glider is byte-identical to the canonical published RLE.
- [ ] Encoded multi-state patterns re-import correctly into the decoder and produce identical grids.
- [ ] Output line length never exceeds 70 characters.

#### - [ ] P2-A-3 · Plaintext & Life 1.06 codecs
**Depends on:** P2-A-1 · **Files:** `src/engine/patterns/{plaintext,life106}.ts`
**Acceptance criteria**
- [ ] `.cells` files with `!Name:` headers decode correctly, including trailing-whitespace-trimmed rows.
- [ ] Life 1.06 coordinate lists round-trip, including negative coordinates.
- [ ] Format sniffing picks the right decoder for all fixtures without an extension hint.

#### - [ ] P2-A-4 · Pattern normalisation & identity
**Depends on:** P2-A-1 · **Files:** `src/engine/patterns/normalize.ts`
**Intent:** So the library can say "you just drew a loaf" and so duplicates are detectable.
**Implementation notes** Canonical form = translate to origin, then choose the lexicographically smallest of the 8 dihedral transforms. Hash that. Store the hash in the catalogue index.
**Acceptance criteria**
- [ ] All 8 orientations of an asymmetric pattern produce the same canonical hash.
- [ ] The catalogue contains no two entries with the same canonical hash and different names (build-time check).

---

### Workstream B — The Library

#### - [ ] P2-B-1 · Catalogue schema & content
**Depends on:** P2-A-1 · **Files:** `patterns/**`, `src/engine/patterns/catalog-types.ts`
**Metadata per entry:** `id, name, aliases[], ruleset, category, discoverer, year, width, height, population, period, speed (e.g. "c/4 diagonal"), heat, description, source (URL/citation), tags[], canonicalHash`.
**Categories:** `still-life`, `oscillator`, `spaceship`, `puffer`, `rake`, `gun`, `methuselah`, `wick`, `agar`, `reflector`, `logic` (for WireWorld), `seed`, `curiosity`.
**Minimum content to ship:**
- **Conway: ≥ 120 patterns** spanning every category — all common still lifes, oscillators to period 30, LWSS/MWSS/HWSS, the standard glider guns, a puffer, a rake, a breeder, the classic methuselahs, and at least one Turing-relevant construction with a citation.
- **HighLife: ≥ 10**, including the replicator.
- **Day & Night, Seeds, Maze, Diamoeba, Replicator, 2×2, Life-without-Death: ≥ 5 each.**
- **Brian's Brain: ≥ 8** (including ships and oscillators).
- **WireWorld: ≥ 10** — diode, AND/OR/XOR gates, a clock, a full adder if available.
- **Generations rules: ≥ 5 each** for the two shipped.
- **The multi-state terrain rule: ≥ 4** documented seeds.
**Implementation notes** Every entry is licence-clean and attributed. Where a pattern comes from LifeWiki or the jslife collection, record the source URL and licence in `patterns/SOURCES.md`. **Do not ship a pattern we cannot attribute.**
**Acceptance criteria**
- [ ] Build-time validation: every entry decodes, matches its declared width/height/population, and its declared period is verified by actually running it.
- [ ] Every entry has a `source`; `patterns/SOURCES.md` is complete and licence-clear.
- [ ] Declared `speed` values are verified by simulation for all spaceships.

#### - [ ] P2-B-2 · Thumbnail generation
**Depends on:** P2-B-1 · **Files:** `scripts/gen-thumbnails.mjs`
**Implementation notes** Build-time, headless, using the real engine and the `recorder`-style rasteriser: render one period (or 60 generations for aperiodic patterns) to an animated WebP, plus a static PNG poster. Size to 128×128, theme-neutral (rendered with a token-derived greyscale so it reads in every theme). Committed to the repo so the client needs no runtime generation.
**Acceptance criteria**
- [ ] All thumbnails regenerate deterministically — running the script twice produces byte-identical files.
- [ ] Total thumbnail payload < 3 MB for the full catalogue.
- [ ] Animated thumbnails loop seamlessly for periodic patterns (first frame === frame `period`).

#### - [ ] P2-B-3 · Library panel UI
**Depends on:** P2-B-2, P1-D-1 · **Files:** `src/ui/panels/library/*`
**Implementation notes**
- Virtualised grid of cards (hand-written windowing — the catalogue is 200+ entries with animated thumbnails; rendering them all would burn the frame budget).
- Filter by ruleset (defaults to the active one), category, tag, size, period. Free-text search across name, alias, discoverer and description with a hand-written fuzzy matcher (subsequence + gap-penalty scoring, ~50 lines) shared with Phase 4's command palette.
- Thumbnails animate **only when the card is visible and the pointer is near** — an `IntersectionObserver` plus a distance check. 200 simultaneously animating thumbnails is a frame-budget catastrophe; this is the difference between fabulous and unusable.
- Select a pattern → the Phase 1 stamp tool activates with a ghost preview; drag from the card onto the canvas also works.
- A detail view shows full metadata, the source citation, and a "run this in isolation" button.
**Acceptance criteria**
- [ ] Panel opens in < 100 ms with 250 entries loaded.
- [ ] Scrolling the full catalogue holds 60 fps.
- [ ] Searching "gosp" finds the Gosper glider gun; searching "p30" finds period-30 oscillators.
- [ ] Fully keyboard navigable: arrow keys move, `Enter` picks up the stamp, `Escape` closes.
- [ ] Switching to WireWorld changes the default filter and the visible set without a reload.

#### - [ ] P2-B-4 · Server pattern routes (complete)
**Depends on:** P2-B-1, P1-G-2 · **Files:** `src/server/routes/patterns.ts`
**Implementation notes** Serve `patterns/index.json` with query filtering, and individual RLE bodies. Also accept `POST /api/patterns` for user-saved patterns (validated, size-capped, stored in the data volume). The client must still work fully offline from a bundled subset.
**Acceptance criteria**
- [ ] Filtered queries return in < 20 ms for the full catalogue.
- [ ] The client degrades to its bundled subset when the API is unreachable, with a visible but non-blocking notice.
- [ ] User-saved patterns appear in the library alongside curated ones, visually distinguished.

---

### Workstream C — The Stat Engine

#### - [ ] P2-C-1 · Incremental metrics
**Depends on:** P0-F-2 · **Files:** `src/engine/stats/*.ts`
**Implementation notes** Extend the Phase 0 collector with density, bounding box, centroid, and per-state flux. Every metric is maintained incrementally from the `ChangeSet` — the total cost must stay independent of grid size. Bounding box needs care: shrinking it on deletion requires either a periodic recompute (cheap: per-chunk bounds are already tracked, ADR-010) or a lazy dirty flag. Use the per-chunk summaries.
**Acceptance criteria**
- [ ] Every metric matches a brute-force recount after 5,000 chaotic generations across 6 rulesets.
- [ ] Full stat collection adds < 5% to step time on the 512² soup benchmark.
- [ ] Bounding box is correct after a pattern shrinks (the classic bug — test it explicitly).

#### - [ ] P2-C-2 · Entropy & spatial measures
**Depends on:** P2-C-1 · **Files:** `src/engine/stats/entropy.ts`
**Implementation notes** Shannon entropy over a 16×16 block-occupancy histogram, computed on a sampled subset of chunks (configurable rate, default every 8th tick) because it is the one genuinely O(cells) metric. Also expose per-chunk population for the Phase 5 density LOD — one computation, two consumers.
**Acceptance criteria**
- [ ] Entropy of a uniform random field ≈ maximum; of a still life ≈ near-zero; of a checkerboard agar is between (documented expected ranges asserted in tests).
- [ ] Sampled entropy tracks the exact value within 5% on 20 chaotic fixtures.
- [ ] Sampling rate is user-visible in the UI — never present an approximation as exact.

#### - [ ] P2-C-3 · Zobrist hashing & cycle detection
**Depends on:** P2-C-1 · **Files:** `src/engine/stats/{zobrist,cycle-detect}.ts`
**Implementation notes** Incremental XOR from the `ChangeSet`. Candidate cycle on a hash+population repeat, confirmed by exact comparison against the history journal. Detect both true periodicity and **translational periodicity** (spaceships: same shape, displaced) by hashing the pattern normalised to its bounding-box origin as a second hash.
**Acceptance criteria**
- [ ] Blinker → period 2; pulsar → period 3; pentadecathlon → period 15; Gosper gun → period 30 (with translational awareness so the emitted gliders do not defeat detection — document the windowing used).
- [ ] A glider is reported as a translating oscillator of period 4 with displacement (1,1).
- [ ] Zero false positives across 20 chaotic 5,000-generation runs.
- [ ] Hash update cost is O(changes) — proven by a benchmark showing flat cost as grid size grows 100×.

#### - [ ] P2-C-4 · Growth classification
**Depends on:** P2-C-1 · **Files:** `src/engine/stats/growth.ts`
**Implementation notes** Least-squares fit of population over the trailing window to constant, linear, quadratic and exponential models; report the best by adjusted R² with a confidence band, and refuse to classify below a minimum sample count. **Say "insufficient data" rather than guessing** — a research tool that confidently mislabels is worse than one that abstains.
**Acceptance criteria**
- [ ] Gosper gun → linear (R² > 0.99). Breeder → quadratic. Still life → constant. Random soup pre-stabilisation → unclassified or chaotic.
- [ ] Below 64 samples the classifier returns `insufficient-data`, and the UI shows that plainly.

#### - [ ] P2-C-5 · Tiered series storage
**Depends on:** P2-C-1 · **Files:** `src/engine/stats/series.ts`
**Implementation notes** Exactly the four tiers in §2.2, min/mean/max aggregation, typed-array ring buffers, hard memory cap. `window()` performs LTTB (Largest-Triangle-Three-Buckets) downsampling — ~40 lines, and it is the reason a million-point series still shows its real shape.
**Acceptance criteria**
- [ ] One million ticks of stats occupy < 32 MB.
- [ ] `window()` over a million ticks at 800 output points completes in < 8 ms.
- [ ] An oscillation present in tier 0 remains visible as a min/max band in tier 3 (asserted by test — this is the anti-lying-chart guarantee).

---

### Workstream D — Charts & the statistics panel

#### - [ ] P2-D-1 · Charting core
**Depends on:** P2-C-5 · **Files:** `src/ui/charts/{scale,axis,chart}.ts`
**Implementation notes** Canvas-based, dpr-correct, token-driven. Nice-tick algorithm (1/2/5 × 10ⁿ). Linear and log Y. Crosshair with a value tooltip, legend with per-series toggling, brush-to-zoom on the X axis with a linked reset. Charts share one rAF pass and are throttled to 20 Hz — the data updates faster than a human can read.
**Acceptance criteria**
- [ ] Six live charts together cost < 2 ms/frame.
- [ ] Axis labels never collide or overflow at any size from 200 px to 1200 px wide.
- [ ] Log scale handles zero and negative values without producing `NaN` geometry.
- [ ] Charts repaint correctly on theme switch with no reload.

#### - [ ] P2-D-2 · Series renderers
**Depends on:** P2-D-1 · **Files:** `src/ui/charts/{series,sparkline,histogram,phase}.ts`
**Implementation notes** Line, stepped, area, **stacked area** (for per-state populations — this is the chart that makes multi-state rulesets legible), min/max envelope band (for downsampled tiers), sparkline, histogram, and a phase-space plot with a fading trail. The phase plot (population vs. birth rate, or activity vs. entropy) is the "wow" chart: chaotic rules trace visibly different attractors, and it costs almost nothing to draw.
**Acceptance criteria**
- [ ] Stacked areas sum exactly to total population at every sample (no gaps or overdraw).
- [ ] The envelope band renders correctly from tier 1–3 aggregated data.
- [ ] The phase plot's trail fade is driven by a motion token and is stable at 20 Hz.

#### - [ ] P2-D-3 · Statistics panel
**Depends on:** P2-D-2 · **Files:** `src/ui/panels/statistics/*`
**Implementation notes**
- **Two modes.** *Simple*: three big numbers (population, births/deaths, generation) plus one sparkline — a child can read it. *Advanced*: the full chart grid, cycle/growth report, the phase plot, and the entropy trace. One toggle. This is the inception document's "child … or a serious researcher" requirement made concrete, and it should exist in every panel.
- Panels are dockable/resizable/collapsible and remember their layout in the session.
- The cycle-detection report is prominent: "**Period 30 oscillator detected at generation 412**" as a first-class, dismissible finding, not a number buried in a table.
**Acceptance criteria**
- [ ] Simple mode is comprehensible with no legend and no documentation.
- [ ] Advanced mode exposes every metric the engine computes — nothing is collected but hidden.
- [ ] Panel layout survives reload.
- [ ] Opening the panel costs < 50 ms and does not drop a frame in the simulation.

#### - [ ] P2-D-4 · Data export
**Depends on:** P2-D-3
**Implementation notes** CSV and JSON of the full retained series (with a tier warning in the header when data is downsampled — never export an approximation silently); PNG export of any chart at 2× scale; RLE export of the current grid or selection; PNG export of the grid view itself. All via `Blob` + `showSaveFilePicker` with an anchor-download fallback.
**Acceptance criteria**
- [ ] Exported CSV opens cleanly in a spreadsheet with correct headers and no locale-dependent decimal issues.
- [ ] Exported CSV states the resolution tier and the aggregation used for every downsampled column.
- [ ] Chart PNG export is pixel-crisp at 2×.

---

### Workstream E — The Ruleset Studio

#### - [ ] P2-E-1 · Studio shell & JSON editor
**Depends on:** P0-D-2, P1-D-5 · **Files:** `src/ui/panels/ruleset-studio/*`
**Intent:** "Rule-God Status." This panel is the single most differentiating feature in the product.
**Implementation notes**
- A hand-written code editor: a `<textarea>` overlaid by a syntax-highlighted `<pre>` (~150 lines — a real editor library is a 2 MB dependency and violates the no-bloat rule), with line numbers, bracket matching, and inline error markers.
- Validation runs on every keystroke (debounced 150 ms) using the engine's `validateRuleSet`; `issues[].path` maps to a line via a small JSON-pointer→offset index. Errors appear **next to the offending line**, with the `hint`.
- Live apply: valid changes hot-swap into the running simulation without resetting it (with a "reset on apply" toggle for the common case).
**Acceptance criteria**
- [ ] Editing `B3/S23` → `B36/S23` and applying changes behaviour within one tick, with no reload and no reset.
- [ ] Every validator issue renders on its correct line with its hint text.
- [ ] The editor handles a 2,000-line ruleset without input lag (> 55 fps while typing).
- [ ] `Mod+Z` in the editor undoes text, not grid edits (focus-scoped keybindings — verify).

#### - [ ] P2-E-2 · Form-based rule builder
**Depends on:** P2-E-1
**Intent:** The child-to-researcher spectrum again: JSON for the expert, a form for everyone else.
**Implementation notes**
- Visual B/S builder: two rows of 0–8 toggle chips, live-updating the notation string and the JSON simultaneously — all three views stay in sync, edit any one.
- Neighbourhood picker with a live diagram of the offsets.
- State editor: add/remove/rename states, pick colours, set `countsAsAlive` and `kind`.
- A transition-table grid editor for small state counts.
- A **"randomise rule"** button with constraint sliders (birth/survival density, symmetry) — genuinely the most fun feature in the app, and about 40 lines. Pair it with the growth classifier so the app can say "this one is explosive" before you run it.
**Acceptance criteria**
- [ ] Form, notation, and JSON are always consistent — a property test drives random edits through all three entry points and asserts convergence.
- [ ] The neighbourhood diagram matches the compiled offset table exactly.
- [ ] "Randomise" produces a valid, compilable ruleset 100 times out of 100.

#### - [ ] P2-E-3 · Rule test bench
**Depends on:** P2-E-2, P2-C-4
**Intent:** Do not make people guess whether their rule is any good.
**Implementation notes** Runs the candidate rule against a standard battery in background workers: random soups at 5 densities, a single cell, a small block, a random 8×8. Reports for each: stabilisation generation, final population, growth class, detected period, and a thumbnail. Results appear as a small card grid within ~2 seconds.
**Acceptance criteria**
- [ ] The battery completes in < 3 s for a typical rule on a mid-range machine.
- [ ] It never blocks the UI (runs in workers, cancellable).
- [ ] Conway scores as expected against a committed reference report (regression guard on the whole stats stack).

#### - [ ] P2-E-4 · Save, share, import
**Depends on:** P2-E-1, P1-G-1
**Implementation notes** Save to `localStorage` and, when the server is up, `POST /api/rulesets`. Export/import as a `.golrule.json` file. Shareable URL carrying an inline ruleset. User rulesets appear in the Phase 1 ruleset picker with a distinguishing badge and an edit affordance.
**Acceptance criteria**
- [ ] A ruleset saved on one browser loads from its share URL on another with no account.
- [ ] Importing a malformed file surfaces the structured issues rather than failing silently.
- [ ] User rulesets survive a Phase 3/4 session-format migration (migration test committed now).

---

## 4. Quality gates for Phase 2

| Gate | Threshold |
|---|---|
| All Phase 0 & 1 gates | still green |
| Engine coverage | ≥ 95% maintained (codecs and stats are engine code) |
| RLE corpus | ≥ 40 real-world files decode correctly; 500-pattern round-trip property test green |
| Catalogue integrity | every entry decodes, metadata verified by simulation, every entry attributed |
| Stat accuracy | every metric matches brute force after 5,000 generations, 6 rulesets |
| Stat overhead | < 5% added to step time |
| Cycle detection | zero false positives over 20 × 5,000-generation chaotic runs |
| Chart performance | 6 live charts < 2 ms/frame |
| Library scroll | 60 fps over 250 entries |
| Series memory | 1M ticks < 32 MB |
| Studio responsiveness | > 55 fps while typing in a 2,000-line ruleset |
| Bundle (gzip) | ≤ 160 kB (catalogue and thumbnails lazy-loaded, not bundled) |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pattern licensing/attribution is unclear for community patterns. | Legal and ethical exposure at launch. | `patterns/SOURCES.md` is a build-gated requirement: an entry without a `source` fails the build. When in doubt, omit the pattern. |
| Animated thumbnails destroy the frame budget in the library. | The marquee feature feels broken. | Visibility + proximity gating (P2-B-3), a hard cap of 12 concurrently animating thumbnails, and a bench that asserts 60 fps over the full catalogue. |
| The hand-written chart module becomes a half-finished chart library. | Months lost reinventing D3. | Scope is fixed to the seven renderers in §2.3. Anything beyond that is out of scope and gets a task ID in a later phase, not an improvisation. |
| Cycle detection produces false positives on large chaotic fields (hash collisions). | Users are told a lie about their simulation. | 32-bit hash + population match is only a *candidate*; confirmation is an exact state comparison via the journal. Zero-false-positive test is a gate. |
| The Ruleset Studio's live apply corrupts a running simulation mid-step. | Data loss, confusing behaviour. | Ruleset swaps are applied at a tick boundary inside the worker, never mid-step; state palette changes require an explicit migration (P0-E-3). |
| Downsampled charts mislead about oscillation. | A statistics tool that lies. | Min/max envelope bands are mandatory for tiers ≥ 1, asserted by test, and the tier is always labelled on the chart and in exports. |

---

## 6. Definition of Done — Phase 2

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [ ] All Phase 2 quality gates (§4) green in CI on `main`.
- [ ] The catalogue ships ≥ 200 attributed patterns across ≥ 10 rulesets, every one verified by simulation.
- [ ] A researcher can export a million-generation population series to CSV with honest resolution labelling.
- [ ] A user can invent a ruleset in the studio, test it, name it, save it, and send a friend a link that works.
- [ ] Simple mode of the statistics panel is comprehensible to a child; advanced mode satisfies an expert. **Verify with real people.**
- [ ] `CHANGELOG.md` has a dated `[0.3.0]` entry; the commit is tagged `v0.3.0`.
- [ ] `docs/demo/phase-2.*` shows a library drag-and-drop, live charts, and a custom rule being authored and applied.
