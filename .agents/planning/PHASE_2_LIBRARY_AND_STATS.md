# Phase 2 — The Library & The Stat Engine

> *"Play with gliders, make a gosper gun, sure… But also contains alternative rulesets, and catalogs of objects for each ruleset as applicable. Tweak parameters and create your own rulesets, go wild!"*
> *"Do you like math? A full suite of graphs and statistical analysis tools across alive/dead/trends/etc!"*

| | |
|---|---|
| **Status** | ☐ Not started |
| **Ships version** | `0.3.0` |
| **Prerequisites** | Phase 1 complete and tagged `v0.2.0`. All Phase 0–1 retro decisions landed in planning on `main` before this branch is cut (2026-09-11). |
| **Theme of the phase** | **Make it powerful.** |
| **The demo that proves it** | Search the library for "Gosper", drag the gun onto the grid, open the statistics panel and watch population climb linearly while the birth/death rates oscillate at period 30 — then open the Ruleset Studio, change `B3/S23` to `B36/S23`, hit apply, and watch the same seed behave completely differently, with the divergence visible on the chart. |

> **Thesis (do not cut under time pressure):** the phase-space plot, the "randomise rule" button
> with constraint sliders, and the animated library thumbnails are the features that make this a
> toy someone shows a friend. They are the deliverable, not the buffer.

---

## 1. Objectives

1. **Pattern I/O** — complete, correct RLE (including multi-state), plaintext, and Life 1.06 codecs, with `#C`/`#N`/`#O`/`#r` header handling.
2. **The Library** — a curated, searchable, filterable catalogue of objects per ruleset with real metadata, animated thumbnails, and one-drag placement.
3. **The Stat Engine** — real-time metrics derived from the `ChangeSet` stream, with cycle detection, growth classification, and long-run downsampling.
4. **The graphs** — a hand-written canvas charting module: time series, stacked area, sparklines, histograms, and a phase-space plot. No charting library (no-bloat rule).
5. **The Ruleset Studio** — "Rule-God Status": author, validate, test, name, save, share, and live-apply custom rulesets from inside the app.
6. **Data export** — CSV/JSON for the researcher; PNG/RLE for everyone else.
7. **Shell honesty** — panel host, composition-root refactor, classed bench gate, and gate-history so later phases inherit a real framework (appended workstreams F/G).

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
├── shared/
│   ├── rle.ts             purely syntactic codec (P2-A-1; no ruleset knowledge)
│   └── rng.ts             Mulberry32 (moved from engine/; ui + engine import it)
├── engine/
│   ├── patterns/{plaintext,life106,apgcode-lite}.ts, normalize.ts, catalog-types.ts
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

#### - [x] P2-A-1 · RLE decoder (full spec, multi-state) — @cursor, started 2026-09-11
**Depends on:** Phase 1 · **Files:** `src/shared/rle.ts` (syntactic codec), `scripts/check-boundaries.mjs`, `src/engine/rng.ts` → `src/shared/rng.ts` (or re-export), `src/ui/tools/select.ts`, `src/ui/tools/brush.ts`; optional thin `src/engine/patterns/*` wrappers for ruleset-aware helpers only
**Boundary decision (ADR-009 amendment 2026-09-11, retro §3.4):** pure-logic lane is **all of
`shared/`** — empirically clean under the forbidden-globals scan on 2026-09-11, so no
`shared/lib/` subdirectory. Reject `ui/ → engine/` for "pure" modules. This task lands the
checker change (`engine → shared/`, scan `shared/**`), the canonical syntactic RLE module in
`shared/`, moves/re-exports Mulberry32 into `shared/`, and **deletes** the Phase 1 duplicates in
`brush.ts` and `select.ts` (not "document as permanent").
**Supersedes:** P1-B-5's minimal encode/decode in `src/ui/tools/select.ts` (states 0–24 only).
**Implementation notes**
- **Land the lane first** (small edit to `check-boundaries.mjs`): MATRIX `engine` allows `shared`
  (not only `shared/types`); run `FORBIDDEN_ENGINE_GLOBALS` over `src/shared/**` as well as
  `engine/**`. Aligns the checker with `docs/ARCHITECTURE.md` and the ADR amendment.
- **Syntactic codec only in `shared/rle.ts`:** parse to coordinates and raw state numbers. No
  knowledge of rulesets or state alphabets — interpretation stays in `engine/`. Otherwise the
  lane starts growing things it shouldn't.
- Header: `x = 3, y = 3, rule = B3/S23`. Body tokens: run counts, `b` (dead), `o` (alive), `$`
  (end of row, with run counts), `!` (end).
- **Multi-state (Generations/Golly) extension**: states 2–24 encode as `pA`…`pX`, `qA`…, `rA`… —
  implement it, because ADR-001 makes multi-state a first-class case and half our builtin
  rulesets need it.
- Comment lines: `#C`/`#c` comment, `#N` name, `#O` author, `#P`/`#R` offset, `#r` rule (old
  format). Provenance/`SPDX-*` `#C` lines (README §3.9) are opaque comments to the codec.
- Robustness: unknown rule → decode cells anyway and return the rule string for the caller to
  resolve; malformed input → a `PatternParseError` naming line and column.
- Delete `select.ts`'s local RLE helpers; import `@shared/rle`. Delete `brush.ts`'s local
  Mulberry32; import `@shared/rng` (move the engine module or leave a one-line re-export).
**Acceptance criteria**
- [x] `check-boundaries.mjs`: `engine` may import `shared/`; forbidden-globals scan covers `shared/**`; a fixture proves both.
- [x] `src/shared/rle.ts` is purely syntactic (no ruleset/state-alphabet imports); round-trip `decode(encode(p)) === p` for 500 random multi-state patterns (property test).
- [x] A corpus of ≥ 40 real-world `.rle` files from the wild (committed as fixtures, with provenance noted) all decode to expected dimensions and populations.
- [x] Decoding a 100k-cell RLE takes < 30 ms.
- [x] Every malformed fixture produces a line/column and a hint.
- [x] `ui/tools/select.ts` and `ui/tools/brush.ts` contain no duplicated RLE codec / Mulberry32 — both import `shared/`.

#### - [x] P2-A-2 · RLE encoder — @cursor, started 2026-09-11
**Depends on:** P2-A-1
**Implementation notes** Emit canonical, minimal output: trim to bounding box, wrap at 70 columns, emit the rule string, and include `#N`/`#O`/`#C` when metadata is present. Multi-state encoding must match what Golly reads.
**Acceptance criteria**
- [x] Output for the standard glider is byte-identical to the canonical published RLE.
- [x] Encoded multi-state patterns re-import correctly into the decoder and produce identical grids.
- [x] Output line length never exceeds 70 characters.

#### - [x] P2-A-3 · Plaintext & Life 1.06 codecs — @cursor, started 2026-09-11
**Depends on:** P2-A-1 · **Files:** `src/engine/patterns/{plaintext,life106}.ts`
**Acceptance criteria**
- [x] `.cells` files with `!Name:` headers decode correctly, including trailing-whitespace-trimmed rows.
- [x] Life 1.06 coordinate lists round-trip, including negative coordinates.
- [x] Format sniffing picks the right decoder for all fixtures without an extension hint.

#### - [x] P2-A-4 · Pattern normalisation & identity — @cursor, started 2026-09-11
**Depends on:** P2-A-1 · **Files:** `src/engine/patterns/normalize.ts`
**Intent:** So the library can say "you just drew a loaf" and so duplicates are detectable.
**Implementation notes** Canonical form = translate to origin, then choose the lexicographically smallest of the 8 dihedral transforms. Hash that. Store the hash in the catalogue index.
**Acceptance criteria**
- [x] All 8 orientations of an asymmetric pattern produce the same canonical hash.
- [x] The catalogue contains no two entries with the same canonical hash and different names (build-time check).

---

### Workstream B — The Library

#### - [ ] P2-B-1 · Catalogue schema, policy & seed set
**Depends on:** P2-A-1 · **Files:** `patterns/**`, `patterns/SOURCES.md`, `LICENSE`, `LICENSES/**`, `NOTICE`, `scripts/check-pattern-licenses.mjs`, `package.json` (`license` field), `src/engine/patterns/catalog-types.ts`
**Intent:** Unblock the library workstream with a real but partial catalogue. Full ≥200 content is **P2-B-5** (split 2026-09-11 — never renumbered).
**Metadata per entry:** `id, name, aliases[], ruleset, category, discoverer, year, width, height, population, period, speed (e.g. "c/4 diagonal"), heat, description, source (URL/citation), tags[], canonicalHash`, plus in-file SPDX provenance (`SPDX-License-Identifier`, `SPDX-FileCopyrightText`, `source:`, `verified:` on `#C` lines).
**Categories:** `still-life`, `oscillator`, `spaceship`, `puffer`, `rake`, `gun`, `methuselah`, `wick`, `agar`, `reflector`, `logic` (for WireWorld), `seed`, `curiosity`.
**Seed content (this task):** ≥ **40** verified, attributed patterns spanning ≥ **4** rulesets (include Conway staples: still lifes, oscillators, LWSS, Gosper gun, a methuselah; plus at least one multi-state rule). Retrofit the existing ten. Full minimums live on **P2-B-5**.
**Licensing (binding — `planning/README.md` §3.9, decided 2026-09-11):** two layers. Code is **MIT** (`LICENSE` + `"license": "MIT"` beside `"private": true`). Pattern content is per-item: **take facts, write your own words**; never paste wiki prose. Provenance classes A/B/C allowed, D omitted. Repo shape: `LICENSES/` (full texts), `NOTICE` (attribution roll-up), `patterns/SOURCES.md` (policy + per-source table with the LifeWiki footer string verified 2026-09-11), REUSE-style SPDX on every `.rle`. Gate: `scripts/check-pattern-licenses.mjs` in `verify` — every pattern needs `#N`, `#O` (discoverer; `unknown` ok, blank not), `source:` URL, and an allowlisted `SPDX-License-Identifier`. **Do not ship a pattern we cannot attribute.**
**Implementation notes** Land the licence scaffolding and `SOURCES.md` policy **before** importing any third-party catalogue content. Descriptions in the library are original. Hand-pick entries; do not mirror an archive wholesale.
**Acceptance criteria**
- [ ] `LICENSE` is MIT; `package.json` has `"license": "MIT"` while remaining `"private": true`.
- [ ] `patterns/SOURCES.md` states the two-layer policy, the Class A–D allowlist, and records the LifeWiki footer licence string verbatim with verification date 2026-09-11.
- [ ] `LICENSES/` holds the full text of every content licence in use; `NOTICE` rolls up attributions.
- [ ] `scripts/check-pattern-licenses.mjs` runs in `npm run verify` and fails on missing `#N`, blank `#O`, missing `source:`, or non-allowlisted SPDX.
- [ ] Every shipped `.rle` carries SPDX + provenance `#C` lines; the pre-existing ten patterns are retrofitted.
- [ ] ≥ 40 entries across ≥ 4 rulesets: each decodes, matches declared width/height/population, and has period (where applicable) verified by simulation.
- [ ] Every entry has a `source`; catalogue descriptions are original (no pasted wiki prose).
- [ ] Declared `speed` values are verified by simulation for all spaceships in the seed set.

#### - [ ] P2-B-2 · Thumbnail generation
**Depends on:** P2-B-1 · **Files:** `scripts/gen-thumbnails.mjs`
**Implementation notes** Build-time, headless, using the real engine and the `recorder`-style rasteriser: render one period (or 60 generations for aperiodic patterns) to an animated WebP, plus a static PNG poster. Size to 128×128, theme-neutral (rendered with a token-derived greyscale so it reads in every theme). Committed to the repo so the client needs no runtime generation. Re-run when **P2-B-5** adds patterns.
**Acceptance criteria**
- [ ] All thumbnails regenerate deterministically — running the script twice produces byte-identical files.
- [ ] Total thumbnail payload < 3 MB for the full catalogue (asserted again after P2-B-5).
- [ ] Animated thumbnails loop seamlessly for periodic patterns (first frame === frame `period`).

#### - [ ] P2-B-3 · Library panel UI
**Depends on:** P2-B-2, P2-G-2, P1-D-1 · **Files:** `src/ui/panels/library/*`, `src/ui/search/fuzzy.ts` (or equivalent shared home)
**Implementation notes**
- Virtualised grid of cards (hand-written windowing — the catalogue is 200+ entries with animated thumbnails; rendering them all would burn the frame budget). Works against the P2-B-1 seed set; must remain correct when P2-B-5 lands the full catalogue.
- Filter by ruleset (defaults to the active one), category, tag, size, period. Free-text search across name, alias, discoverer and description with a hand-written fuzzy matcher (subsequence + gap-penalty scoring, ~50–80 lines).
- **This matcher is P4-A-1's component.** Write it once in a shared module (`src/ui/search/fuzzy.ts` or similar), with the contract and test bar Phase 4 needs (table-driven ranking, match indices for highlighting, < 1 ms / 1,000 candidates). P4-A-1 promotes/extends it; it must not discover a library-shaped one-off to generalise.
- Thumbnails animate **only when the card is visible and the pointer is near** — an `IntersectionObserver` plus a distance check. 200 simultaneously animating thumbnails is a frame-budget catastrophe; this is the difference between fabulous and unusable.
- Select a pattern → the Phase 1 stamp tool activates with a ghost preview; drag from the card onto the canvas also works.
- A detail view shows full metadata, the source citation, and a "run this in isolation" button.
- **Attribution as UI (README §3.9):** every card (or its detail view) shows discoverer and year with a link to `source`. A Credits dialog lists every collection in `SOURCES.md` and that collection's recorded terms — delightful first, compliance second.
- Panel hosts via **P2-G-2** (dock/resize/collapse/session layout/min-width/axe).
**Acceptance criteria**
- [ ] Panel opens in < 100 ms with 250 entries loaded (or the full catalogue once P2-B-5 is present).
- [ ] Scrolling the full catalogue holds 60 fps.
- [ ] Searching "gosp" finds the Gosper glider gun; searching "p30" finds period-30 oscillators.
- [ ] Fully keyboard navigable: arrow keys move, `Enter` picks up the stamp, `Escape` closes.
- [ ] Switching to WireWorld changes the default filter and the visible set without a reload.
- [ ] Discoverer and year are visible for every pattern that has them; `source` is one activation away.
- [ ] Credits dialog lists every `SOURCES.md` collection and its terms.
- [ ] Fuzzy matcher lives in a shared module with tests that meet P4-A-1's ranking/perf bar (or an explicit subset documented for P4-A-1 to extend).

#### - [ ] P2-B-4 · Server pattern routes (complete)
**Depends on:** P2-B-1, P1-G-2 · **Files:** `src/server/routes/patterns.ts`
**Implementation notes** Serve `patterns/index.json` with query filtering, and individual RLE bodies. Also accept `POST /api/patterns` for user-saved patterns (validated, size-capped, stored in the data volume). The client must still work fully offline from a bundled subset. Remains correct when P2-B-5 expands the catalogue.
**Acceptance criteria**
- [ ] Filtered queries return in < 20 ms for the full catalogue.
- [ ] The client degrades to its bundled subset when the API is unreachable, with a visible but non-blocking notice.
- [ ] User-saved patterns appear in the library alongside curated ones, visually distinguished.

#### - [ ] P2-B-5 · Catalogue completion
**Depends on:** P2-B-1 · **Files:** `patterns/**`
**Intent:** Grow the seed set to the full ship bar. Appended 2026-09-11 so P2-B-2/B-3/B-4 are not blocked on content volume.
**Minimum content to ship (cumulative with P2-B-1):**
- **Conway: ≥ 120 patterns** spanning every category — all common still lifes, oscillators to period 30, LWSS/MWSS/HWSS, the standard glider guns, a puffer, a rake, a breeder, the classic methuselahs, and at least one Turing-relevant construction with a citation.
- **HighLife: ≥ 10**, including the replicator.
- **Day & Night, Seeds, Maze, Diamoeba, Replicator, 2×2, Life-without-Death: ≥ 5 each.**
- **Brian's Brain: ≥ 8** (including ships and oscillators).
- **WireWorld: ≥ 10** — diode, AND/OR/XOR gates, a clock, a full adder if available.
- **Generations rules: ≥ 5 each** for the two shipped.
- **The multi-state terrain rule: ≥ 4** documented seeds.
**Acceptance criteria**
- [ ] Catalogue ships ≥ 200 attributed patterns across ≥ 10 rulesets; every new entry passes the same build-time validation and licence gate as P2-B-1.
- [ ] Thumbnails regenerated for all new entries; total thumbnail payload still < 3 MB.
- [ ] No two entries share a canonical hash under different names (build-time check).

---

### Workstream C — The Stat Engine

#### - [ ] P2-C-1 · Incremental metrics
**Depends on:** P0-F-2 · **Files:** `src/engine/stats/*.ts`
**Implementation notes** Extend the Phase 0 collector with density, bounding box, centroid, and per-state flux. Every metric is maintained incrementally from the `ChangeSet` — the total cost must stay independent of grid size. Bounding box needs care: shrinking it on deletion requires either a periodic recompute (cheap: per-chunk bounds are already tracked, ADR-010) or a lazy dirty flag. Use the per-chunk summaries. **Instance-scoped collector, not a singleton** — Phase 4's Laboratory runs two simulations; design the API so a second `StatsCollector` on a second `Simulation` is natural (P2-C-3 Zobrist + P2-C-4 growth are ~80% of P4-D-4 divergence metrics).
**Acceptance criteria**
- [ ] Every metric matches a brute-force recount after 5,000 chaotic generations across 6 rulesets.
- [ ] Full stat collection adds < 5% to step time on the 512² soup benchmark.
- [ ] Bounding box is correct after a pattern shrinks (the classic bug — test it explicitly).
- [ ] Two collectors on two simulations do not share mutable state (unit test).

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
**Implementation notes** Exactly the four tiers in §2.2, min/mean/max aggregation, typed-array ring buffers, hard memory cap. `window()` performs LTTB (Largest-Triangle-Three-Buckets) downsampling — ~40 lines, and it is the reason a million-point series still shows its real shape. Instance-scoped with the collector (P2-C-1).
**Acceptance criteria**
- [ ] One million ticks of stats occupy < 32 MB.
- [ ] `window()` over a million ticks at 800 output points completes in < 8 ms.
- [ ] An oscillation present in tier 0 remains visible as a min/max band in tier 3 (asserted by test — this is the anti-lying-chart guarantee).

#### - [ ] P2-C-6 · `statsWindow` protocol + worker plumbing
**Depends on:** P2-C-5 · **Files:** `src/shared/protocol.ts`, `src/worker/{handler,client}.ts`, `tests/integration/worker-protocol.spec.ts`
**Intent:** Charts must query tiered series without mirroring engine logic on the main thread or streaming every sample. Appended 2026-09-11 (ADR-006 amendment).
**Implementation notes** Add `statsWindow` command + reply per ADR-006 amendment. `TickStats` on `frame` stays for the status bar; charts call `statsWindow({ fromTick, toTick, maxPoints, … })` and receive an LTTB-downsampled `StatSample` (or equivalent) with tier labelled. Do not duplicate `Series` in `ui/`.
**Acceptance criteria**
- [ ] Protocol types include `statsWindow` request and reply; exhaustiveness switches updated.
- [ ] Integration test: seed a known series in the worker, query a window, assert point count ≤ maxPoints and min/max envelope preserved for tiers ≥ 1.
- [ ] `WorkerClient` exposes a typed helper; no `ui/ → engine/` import for series reads.

---

### Workstream D — Charts & the statistics panel

#### - [ ] P2-D-1 · Charting core
**Depends on:** P2-C-6 · **Files:** `src/ui/charts/{scale,axis,chart}.ts`
**Implementation notes** Canvas-based, dpr-correct, token-driven. Nice-tick algorithm (1/2/5 × 10ⁿ). Linear and log Y. Crosshair with a value tooltip, legend with per-series toggling, brush-to-zoom on the X axis with a linked reset. Charts share one rAF pass and are throttled to 20 Hz — the data updates faster than a human can read. Data comes only via **P2-C-6** `statsWindow` (never a mirrored tiered `Series` on the main thread).
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
**Depends on:** P2-D-2, P2-G-2 · **Files:** `src/ui/panels/statistics/*`
**Implementation notes**
- **Two modes.** *Simple*: three big numbers (population, births/deaths, generation) plus one sparkline — a child can read it. *Advanced*: the full chart grid, cycle/growth report, the phase plot, and the entropy trace. One toggle. This is the inception document's "child … or a serious researcher" requirement made concrete, and it should exist in every panel.
- Dock/resize/collapse/session layout come from **P2-G-2** — do not invent a second panel contract here.
- The cycle-detection report is prominent: "**Period 30 oscillator detected at generation 412**" as a first-class, dismissible finding, not a number buried in a table.
**Acceptance criteria**
- [ ] Simple mode is comprehensible with no legend and no documentation.
- [ ] Advanced mode exposes every metric the engine computes — nothing is collected but hidden.
- [ ] Panel layout survives reload (via P2-G-2 session persistence).
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
**Depends on:** P0-D-2, P1-D-5, P2-G-2 · **Files:** `src/ui/panels/ruleset-studio/*`
**Intent:** "Rule-God Status." This panel is the single most differentiating feature in the product.
**Implementation notes**
- Hosted by **P2-G-2** (same dock/focus/min-width/axe contract as library and statistics).
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

### Workstream F — Benchmark harness honesty

> Appended from the Phase 0–1 retro (§3.1), decided 2026-09-11. Phase 5's optimisation phase
> rests on this gate; landing it on the Phase 2 branch (early) is deliberate. Does not renumber
> any prior ID.

#### - [ ] P2-F-1 · Three-class bench gate + calibration
**Depends on:** P0-I-4 (harness exists) · **Files:** `scripts/bench.mjs`, `tests/bench/types.ts`, `tests/bench/*.bench.ts`, `tests/unit/bench-runner.spec.ts`, `bench-baseline.json`
**Intent:** Replace the binary `baselineGate: false` pressure valve with a classed policy so every
case is gated honestly, and dissolve the sandbox-vs-CI machine provenance problem for CPU timings.
**Implementation notes** Binding policy: `planning/README.md` §3.6. Summary:
- Every case declares `class: 'deterministic' | 'wall-clock' | 'browser'` (exact field name free;
  no `baselineGate: false` remains).
- **Deterministic** (e.g. gzip size, allocated grid memory): tight **2–3%** regression gate.
- **Wall-clock CPU**: run a fixed no-alloc/no-I/O **calibration** workload in-process; print raw ms
  for humans; **gate on median/calibration**. Noise-aware band on the ratio is fine; opting out
  is not. Re-record baseline ratios once on CI-like hardware after the change.
- **Browser / GPU / paint**: absolute budget only in this task; wire **gate-history** when
  **P2-F-3** lands — do not block this task on it.
- Give every case a budget or a class gate, or delete it. Rename `cold-load-recorded` so the
  runner output makes the transcribed (not re-timed) nature obvious.
- Softened process-doc claims already point at §3.6 interim language; once this task is `- [x]`,
  flip AGENTS/CLAUDE/`npm run bench` blurbs to the three-class wording (no more "until P2-F-1").
- While here: add `src/worker/**` coverage thresholds to `vitest.config.ts` at **95/90/95**
  (statements/branches/functions) — measured actuals already clear this; ratchet `ui`/`themes`/
  `render`/`server` toward a few points under measured actuals per `planning/README.md` §3.5.
**Acceptance criteria**
- [ ] No bench case uses `baselineGate: false` (or any equivalent per-case opt-out).
- [ ] Every remaining case is classified and has either an absolute budget, a class regression gate, or both; zero "measure-only" orphans.
- [ ] Wall-clock cases gate on calibration ratio; raw ms still appear in the ASCII table.
- [ ] Deterministic cases gate at ≤ 3% regression against baseline.
- [ ] `cold-load-recorded` is renamed so its transcribed nature is visible in runner output.
- [ ] `tests/unit/bench-runner.spec.ts` proves: deterministic tight fail, wall-clock ratio fail, browser budget fail; deliberate slowdown still exits non-zero.
- [ ] `planning/README.md` §3.6 interim paragraph is removed or marked superseded; AGENTS.md / CLAUDE.md / ADR-004 cite the three-class policy as in force.
- [ ] `src/worker/**` has coverage thresholds ≥ 95/90/95; at least one other layer's thresholds are ratcheted upward toward actuals without lowering any gate.

#### - [ ] P2-F-2 · Reshape canvas-bridge snapshot
**Depends on:** Phase 1 · **Files:** `tests/integration/canvas-bridge.spec.ts`, `tests/integration/__snapshots__/*`
**Intent:** Replace the 37k-line draw-call snapshot with a reviewable assertion shape before Phase 3/5 multiply renderers (retro §3.3).
**Implementation notes** Keep the test. Assert a stable digest of the call log plus named invariants (call counts by method, dirty-rect coverage, painted-cell set at generations 0/1/4/100). Keep a *short* readable snapshot of the first N calls only. A reviewer must be able to tell *what* changed.
**Acceptance criteria**
- [ ] Full 37k-line snapshot file is gone (or reduced to a short first-N excerpt).
- [ ] Digest + invariants still catch a deliberate renderer regression (fixture test).
- [ ] Suite runtime does not increase materially.

#### - [ ] P2-F-3 · Gate-history criterion class + nightly flake workflow
**Depends on:** P1-H-1, P1-H-2 · **Files:** `.github/workflows/nightly-flake.yml` (or similar), `planning/README.md` §3.10, `docs/gate-history/` (or agreed path)
**Intent:** Criteria like "stable across N consecutive CI runs" are unmeetable inside a task. Document a **gate-history** class and accumulate the record before Phase 3 multiplies visual baselines (retro §3.2). Browser-class benches (P2-F-1) and **P3-D-2** consume this.
**Implementation notes** Binding text in `planning/README.md` §3.10. Nightly (or scheduled) workflow re-runs e2e + visual suites N times and appends results to a committed or artifact-backed record agents can cite. Task-owned criteria may say "gate-history: e2e-nonflake ≥ 10 green" instead of pretending to run 10 CI jobs in-task.
**Acceptance criteria**
- [ ] `planning/README.md` §3.10 defines the gate-history class and where the record lives.
- [ ] Scheduled workflow exists and has produced at least one recorded run on `main`.
- [ ] P3-D-2's "stable across 3 CI runs" criterion is rewritten to reference gate-history (or an explicit interim note until the first three nightlies land).

---

### Workstream G — Shell & composition

> Appended 2026-09-11 (retro §3.6, §5.2, §5.4). Lands before the three panels. Does not renumber
> any prior ID.

#### - [ ] P2-G-1 · Composition-root refactor
**Depends on:** Phase 1 · **Files:** `src/client/main.ts`, extracted wiring modules under `src/client/` (and/or `src/ui/` as appropriate)
**Intent:** `main.ts` is ~1,049 lines and excluded from coverage. Extract testable wiring *before* three panels land more seams there. Own `refactor(ui)` / `refactor(client)` commit(s) — never mixed with a feature (`AGENTS.md` §7).
**Implementation notes** Pull seams into focused modules (worker subscription, tool/command wiring, session restore, overlay hosts, …). Leave `main.ts` as a thin composition root. Decision on `src/client/**` coverage (`planning/README.md` §3.5): after extraction, either (a) put a modest threshold on remaining `client/**`, or (b) keep `client/**` excluded **only if** the extracted modules live under paths that already have thresholds and a comment in `vitest.config.ts` states why. Prefer (a) if the residual root is still large.
**Acceptance criteria**
- [ ] `main.ts` line count drops by ≥ 40% with behaviour preserved (Playwright smoke / existing e2e green).
- [ ] Extracted modules have unit or integration tests; coverage policy for `client/**` is recorded in `vitest.config.ts` per §3.5.
- [ ] No feature work in the same commit as the refactor.

#### - [ ] P2-G-2 · Panel host / dock framework
**Depends on:** P2-G-1, P1-D-1 · **Files:** `src/ui/shell/panel-host.ts` (or equivalent), session layout slice
**Intent:** One contract for library, statistics, and ruleset-studio panels — dock, focus, resize/collapse, session persistence, Escape/focus-trap (align with `dialog.ts`). Also the cheapest place for Phase 6 pre-emption: **minimum usable width** + **per-panel axe** (retro §5.4).
**Implementation notes** `shell.ts` today has an empty `panel-dock`. Build the host here; P2-B-3, P2-D-3, P2-E-1 depend on this task and must not invent parallel layout systems.
**Acceptance criteria**
- [ ] Panels are dockable/resizable/collapsible; layout survives reload via session.
- [ ] Focus trap + Escape match `dialog.ts` conventions; keyboard users never lose focus to the void.
- [ ] Every panel declares and holds a minimum usable width (asserted; below-min layout does not clip controls into unusable states).
- [ ] Every panel ships an axe-core assertion in its spec (zero violations on the panel root).
- [ ] Adding a fourth panel requires no change to B-3/D-3/E-1 — only a new consumer of the host.

---

## 4. Quality gates for Phase 2

| Gate | Threshold |
|---|---|
| All Phase 0 & 1 gates | still green |
| Engine coverage | ≥ 95% maintained (codecs and stats are engine code) |
| Worker coverage | ≥ 95/90/95 (P2-F-1) |
| RLE corpus | ≥ 40 real-world files decode correctly; 500-pattern round-trip property test green |
| Catalogue integrity | every entry decodes, metadata verified by simulation, every entry attributed; `check-pattern-licenses` green; ≥ 200 / ≥ 10 rulesets via P2-B-5 |
| Stat accuracy | every metric matches brute force after 5,000 generations, 6 rulesets |
| Stat overhead | < 5% added to step time |
| Cycle detection | zero false positives over 20 × 5,000-generation chaotic runs |
| Chart performance | 6 live charts < 2 ms/frame |
| Library scroll | 60 fps over 250 entries |
| Series memory | 1M ticks < 32 MB |
| Studio responsiveness | > 55 fps while typing in a 2,000-line ruleset |
| Bundle (gzip) | ≤ 160 kB (catalogue and thumbnails lazy-loaded, not bundled) |
| Bench harness (P2-F-1) | three-class policy in force; no `baselineGate: false`; calibration ratio gates wall-clock cases |
| Panel host (P2-G-2) | min-width + axe on every panel; session layout shared |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pattern licensing/attribution is unclear for community patterns. | Legal and ethical exposure at launch. | Binding policy in `planning/README.md` §3.9 (MIT code / per-item content). `SOURCES.md` + SPDX headers + `check-pattern-licenses.mjs` in `verify`. Facts only, original descriptions; Class D omitted. When in doubt, omit the pattern. |
| Animated thumbnails destroy the frame budget in the library. | The marquee feature feels broken. | Visibility + proximity gating (P2-B-3), a hard cap of 12 concurrently animating thumbnails, and a bench that asserts 60 fps over the full catalogue. |
| The hand-written chart module becomes a half-finished chart library. | Months lost reinventing D3. | Scope is fixed to the seven renderers in §2.3. Anything beyond that is out of scope and gets a task ID in a later phase, not an improvisation. |
| Cycle detection produces false positives on large chaotic fields (hash collisions). | Users are told a lie about their simulation. | 32-bit hash + population match is only a *candidate*; confirmation is an exact state comparison via the journal. Zero-false-positive test is a gate. |
| The Ruleset Studio's live apply corrupts a running simulation mid-step. | Data loss, confusing behaviour. | Ruleset swaps are applied at a tick boundary inside the worker, never mid-step; state palette changes require an explicit migration (P0-E-3). |
| Downsampled charts mislead about oscillation. | A statistics tool that lies. | Min/max envelope bands are mandatory for tiers ≥ 1, asserted by test, and the tier is always labelled on the chart and in exports. |

---

## 6. Definition of Done — Phase 2

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [ ] All Phase 2 quality gates (§4) green in CI on `main`.
- [ ] The catalogue ships ≥ 200 attributed patterns across ≥ 10 rulesets, every one verified by simulation (**P2-B-5**).
- [ ] A researcher can export a million-generation population series to CSV with honest resolution labelling.
- [ ] A user can invent a ruleset in the studio, test it, name it, save it, and send a friend a link that works.
- [ ] Simple mode of the statistics panel is comprehensible to a child; advanced mode satisfies an expert. **Verify with real people.**
- [ ] Coverage thresholds ratcheted per `planning/README.md` §3.5 (`worker/**` gated; at least one other layer raised).
- [ ] `CHANGELOG.md` has a dated `[0.3.0]` entry; the commit is tagged `v0.3.0`.
- [ ] Phase 2 changelog entries follow `AGENTS.md` §2.6 (user-visible statement + task ID only); the `[0.3.0]` section includes one line pointing at this phase doc for reasoning. Pre-`0.3.0` entries are left untouched.
- [ ] `docs/demo/phase-2.*` shows a library drag-and-drop, live charts, and a custom rule being authored and applied. Prefer extending `scripts/capture-phase1-demo.mjs` toward the general capture pipeline (**P6-F-1**) rather than a third one-off.
