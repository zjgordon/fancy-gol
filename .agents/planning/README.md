# fancy-gol — Phased Build Plan

> This directory is the operational plan for building **fancy-gol**, derived from
> [`../docs/INCEPTION.md`](../docs/INCEPTION.md). Every phase document is a
> self-contained work order: an independent engineer should be able to open one,
> read nothing else but this index and [`ARCHITECTURE_DECISIONS.md`](./ARCHITECTURE_DECISIONS.md),
> and know exactly what to build next.

---

## 0. The Prime Directive

The inception document is not a spec, it is a **standard**. Re-read it before every phase.
Three lines from it govern every decision in these plans:

- **"Stay Fancy: If a feature is 'boring', find a way to make it visually interesting."**
- **"Agit-Prop: If an agent produces code that is 'just okay', demand it be 'excellent'."**
- **"The 'Wow' Factor: they should be struck by the fact that it's a 'toy' that feels like a professional tool."**

If a task in these documents can be completed in a way that is merely *correct*, it is not done.
It must also be **fast**, **beautiful**, and **obvious to a beginner while total for an expert**.

---

## 1. Phase Index

| # | Document | Ships | Version | Theme of the phase |
|---|---|---|---|---|
| 0 | [PHASE_0_FOUNDATION.md](./PHASE_0_FOUNDATION.md) | A pure, tested, multi-state engine running in a worker, painting a canvas, inside a container. | `0.1.0` | *Make it correct.* |
| 1 | [PHASE_1_INTERACTION.md](./PHASE_1_INTERACTION.md) | A genuinely usable simulator: paint, pan, zoom, play, Default theme, live API. | `0.2.0` | *Make it usable.* |
| 2 | [PHASE_2_LIBRARY_AND_STATS.md](./PHASE_2_LIBRARY_AND_STATS.md) | Pattern catalog, RLE I/O, the statistics suite, the ruleset authoring studio. | `0.3.0` | *Make it powerful.* |
| 3 | [PHASE_3_THEME_ENGINE.md](./PHASE_3_THEME_ENGINE.md) | Six full-sensory themes — shaders, motion signatures, sound design. | `0.4.0` | *Make it fabulous.* |
| 4 | [PHASE_4_POWER_UX.md](./PHASE_4_POWER_UX.md) | Command palette, Time-Traveler, the Laboratory, full keybinding mastery. | `0.5.0` | *Make it a pro tool.* |
| 5 | [PHASE_5_SCALE_AND_PERF.md](./PHASE_5_SCALE_AND_PERF.md) | WebGL2 renderer, bitboard kernel, LOD, OffscreenCanvas, the Infinite Horizon. | `0.6.0` | *Make it enormous.* |
| 6 | [PHASE_6_LAUNCH.md](./PHASE_6_LAUNCH.md) | Hardening, docs, demo assets, a11y audit, `1.0.0`. | `1.0.0` | *Make it real.* |

Supporting document: **[ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md)** — the twelve binding
decisions (ADR-001 … ADR-012) that these phases implement. Read it once, in full, before Phase 0.

---

## 2. How to use a phase document

Each phase document has an identical structure:

1. **Header block** — status, version, prerequisites, and the single-sentence demo that proves the phase is done.
2. **Objectives** — what changes about the product.
3. **Architecture for this phase** — the interfaces, types, file layout, and data flow being introduced. This is the technical contract; do not improvise around it without an ADR amendment.
4. **Workstreams & tasks** — the checklist. Every task has an ID, dependencies, files, intent, implementation notes, acceptance criteria, and required tests.
5. **Quality gates** — the hard, measurable bar the phase must clear.
6. **Risks & mitigations.**
7. **Definition of Done** — the final sign-off checklist.

### Task ID scheme

```
P<phase>-<workstream letter>-<number>       e.g.  P0-C-3
```

Workstream letters are stable within a phase. IDs are permanent — never renumber. If a task is
dropped, mark it `☒ CUT` with a one-line reason rather than deleting it.

### Status legend

Update the checkbox and the status marker in place; the document *is* the tracker.

| Marker | Meaning |
|---|---|
| `- [ ]` | Not started |
| `- [~]` | In progress (add `— @owner, started YYYY-MM-DD`) |
| `- [x]` | Done, merged, gates green |
| `- [!]` | Blocked (add the blocking task ID or question) |
| `- [-]` | Cut (add a one-line reason) |

### Finding the next task

Scan top-to-bottom for the first `- [ ]` whose **Depends on** list is fully `- [x]`.
Workstreams are ordered so that this heuristic is almost always right.

---

## 3. Cross-phase engineering rules

These apply to **every** task in **every** phase. They are not repeated in each document.

### 3.1 The purity rule (non-negotiable)

> *"Pure Logic: the simulation logic must never know the UI exists."* — INCEPTION.md

`src/engine/**` may import only from `src/engine/**` and `src/shared/**`. `src/shared/**` may
import only from `src/shared/**`. Neither may reference `window`, `document`, `navigator`,
`performance` (use an injected clock), `console`, `localStorage`, `fetch`, `process`, `require`,
`Date`, or any DOM/Node API. **`shared/` is the pure-logic lane** every other layer already may
import (ADR-009 amendment 2026-09-11). Empirically clean as of that date — no `shared/lib/`
subdirectory unless impurity appears later. Machine-enforced by `scripts/check-boundaries.mjs`
from Phase 0 onward (P2-A-1 extends the forbidden-globals scan to `shared/**` and widens
`engine → shared/types` to `engine → shared/`). A violation fails the build. Do not allow
`ui/ → engine/` as a "pure module" escape hatch.

### 3.2 The no-bloat rule

> *"If a library can be written in 50 lines of TS, don't import a package for it."*

Before adding **any** runtime dependency, the task must record in its PR description:
what it does, why 50 lines of TS cannot, and its transitive dependency count.
The following are pre-approved as the *entire* permitted runtime surface:
`express`, `ws`. Everything else is a dev dependency or is written by hand.
Charting, fuzzy search, validation, easing, colour maths, RLE parsing, audio synthesis
and the command bus are all **hand-written** by design — each is a named task below.

### 3.3 Automated proof

> *"Every step must pass its Vitest suite before being considered 'done'."*

No task is `- [x]` until:
- its unit tests exist and pass,
- `npm run verify` is green (typecheck + lint + boundaries + unit + build),
- coverage gates hold (see §3.5),
- performance budgets hold (see §3.6),
- and — from Phase 1 — its Playwright spec exists and passes.

### 3.4 Commits, versioning, changelog

- **Conventional Commits**, enforced by a hand-written `.githooks/commit-msg` (~40 lines, no `commitlint`).
  Types: `feat` `fix` `perf` `refactor` `test` `docs` `build` `ci` `chore` `style` `revert`.
  Scopes track the source tree: `engine` `rules` `grid` `history` `worker` `render` `ui` `themes` `audio` `server` `docker` `bench`.
- **Semantic versioning from commit one.** Pre-1.0, each completed phase bumps the minor
  version per the table in §1. `1.0.0` is cut in Phase 6.
- **`CHANGELOG.md`** is Keep-a-Changelog format, updated *in the same commit* as the change,
  never generated retroactively. Every phase closes by moving `[Unreleased]` into a dated release
  heading. **From Phase 2 / `v0.3.0` (decided 2026-09-11):** entries are user-visible statement +
  task ID only; one line per release section points at the phase doc for reasoning. Module
  comments and phase-doc notes keep the *why*. Do not rewrite pre-`0.3.0` entries. See
  `AGENTS.md` §2.6.
- Commits are small, logical, and independently green. One task ≈ one to three commits.

### 3.5 Coverage gates (ratcheted, never lowered)

Enforced by `vitest --coverage` thresholds in `vitest.config.ts`:

| Path | Statements | Branches | Functions |
|---|---|---|---|
| `src/engine/**` | **95%** | **90%** | **95%** |
| `src/shared/**` | 95% | 90% | 95% |
| `src/worker/**` | **95%** (P2-F-1) | **90%** | **95%** |
| `src/render/**` | 85% | 75% | 85% |
| `src/ui/**` | 70% | 60% | 70% |
| `src/themes/**` | **75%** (P2-F-1) | **65%** | **75%** |
| `src/server/**` | 85% | 75% | 85% |
| `src/audio/**` | **95/90/95 when the directory is created (P3-B-1)** | | |
| `src/client/**` | **85%** (P2-G-1; `main.ts` excluded) | **75%** | **75%** |

Thresholds may be **raised** by a phase. They may never be lowered; a phase that would lower one
must instead delete or fix the untested code.

**Ratchet rule (decided 2026-09-11):** every phase's Definition of Done includes raising thresholds
toward a few points under measured actuals where slack is large. Do not leave 20+ points of slack
as a silent permission to ship untested UI.

**`src/client/**` (decided 2026-09-11, recorded P2-G-1):** option (a) — modest threshold on the
residual `client/**` (85/75/75). `src/client/main.ts` stays excluded: it is the Playwright-owned
composition root. Extracted wiring is gated; do not re-exclude the whole tree.

### 3.6 Performance budgets (CI-enforced from Phase 0)

Budgets tighten per phase; each phase document restates the numbers it must hit. The **regression
policy is not a single 10% band** — three kinds of number share one harness and inherit different
gates (decided 2026-09-11; implemented by **P2-F-1**, landed 2026-09-14). The three-class policy
below is in force; there is no interim exception left to cite.

#### Absolute floors (unchanged)

| Metric | Phase 0 floor | Phase 5 target |
|---|---|---|
| Conway steps/sec @ 512×512 dense random (soup) | ≥ 60 | ≥ 400 |
| Conway steps/sec @ 4096×4096, 1% density | ≥ 5 | ≥ 60 |
| Largest live grid without OOM | 10⁶ live cells | 10⁸ addressable / 10⁷ live |
| Frame time, 1080p viewport, steady state | ≤ 16.6 ms | ≤ 8 ms |
| Main-thread block per tick | ≤ 4 ms | ≤ 1 ms |
| Cold interactive load (local, gzip) | ≤ 1500 ms | ≤ 800 ms |
| Client JS bundle (gzip, excl. themes) | ≤ 120 kB | ≤ 180 kB |

#### Target gate policy (three classes — P2-F-1, in force)

Every bench case lands in **exactly one** class and inherits that class's policy. There is no
per-case `baselineGate: false` escape hatch — that valve was pulled ten times in Phases 0–1 and
is retired.

| Class | Examples | Policy |
|---|---|---|
| **Deterministic** | `client-js-gzip`, `grid-1m-memory` | Tight regression gate **2–3%**. No noise excuse exists. |
| **Wall-clock CPU** | `conway-512-soup`, `conway-4096-1pct`, `paint-1m`, `snapshot-restore`, `seek-4000`, `stats-overhead`, `zobrist-update` | Noise-aware gate on a **calibration ratio** (below), not raw milliseconds. Same-process ratios (`selfCalibrated`) skip the calibrator divisor. |
| **Browser / GPU / paint** | `render-frame-cpu`, `main-thread-block`, `pan-1000pxs-1080p`, `zoom-32-0.5-32-min-fps`, interaction paint latency | **Absolute budget only**, plus accumulating **gate-history** (`docs/gate-history/`, P2-F-3). |

**Every case gets a budget or a class gate, or is deleted.** `scripts/bench.mjs` enforces this at
load time now: a case with no `class` (or a `browser`-class case with no `budget`, its only gate)
fails the run rather than silently measuring nothing. `default-theme-palette-lookup` and
`snapshot-restore` — the two cases that used to gate nothing — are `wall-clock` now.

**Calibration (wall-clock class):** `scripts/bench.mjs` runs a fixed synthetic workload (no
allocation, no I/O) in the same process as the suite. Wall-clock cases report raw milliseconds
for humans but **gate on `median / calibration`**. A slower runner slows the calibration too, so
the ratio holds across machines and the baseline stops being machine-bound — this replaces
per-runner baseline files and closes the Node-24-sandbox-vs-Node-22-CI provenance skew for CPU
cases. Band on the ratio may still be noise-aware (use the spread already computed across the
median-of-7); do not fall back to "turn the gate off".

**Self-calibrated wall-clock cases:** `stats-overhead` (already `(combined − step) / step`) and
`zobrist-update` (already 320² / 32² apply cost for the same ChangeSet) set `selfCalibrated:
true`. Their machine cancelled in the measurement. Dividing that figure by the synthetic
calibrator makes a faster runner look like a regression — observed 2026-09-14 on GHA
(`zobrist-update` cost ratio 0.998 vs 1.004 flagged +17.3% because calibration went 8.78 ms →
7.22 ms). Those cases still use the noise-aware wall-clock band, on `1/median`; they still have
to meet their absolute budgets (5% and 1.5). This is not a `baselineGate: false` opt-out.

**Costs are measured, never declared (P3-D-4 / ADR-011):** the EWMA the degrade governor feeds on,
never an `EffectPass.cost` declaration, is what a gate may cite. The declarations turned out to be
optimistic by 5–70×, and a gate built on them certified nothing.

**Theme costs are not a Node bench case (moved by P3-E-8, 2026-10-06 — a gate moved, not dropped).**
`theme-*-q3-stack-cost`, `theme-heaviest-stack-cost` and `theme-*-q0-throttled-frame` are deleted
(`tests/bench/themes.bench.ts`). Under ADR-012 the passes are composited: on a Node recording surface
a pass costs only call *dispatch*, which prices nothing, and a software raster overstates the GPU-side
blits by ~6× — so neither Node harness could ever give a number that means "frame time". Their subject
now lives where it can be measured:

| Was (Node bench) | Now (real Chromium) | Tier |
|---|---|---|
| `theme-*-q3-stack-cost`, `theme-heaviest-stack-cost` | `browser-floor`: per-stage `renderStats().stageMs`, heap-span allocation check, same-runner ratio ≤ 2.5× Default | blocking CI (P3-E-1) |
| `theme-*-q3-stack-cost` ≤ 18.18 ms, absolute | `browser-bench`: ≥ 55 fps at q3, 1080p, ~100k cells | reference certificate (D6) |
| `theme-*-q0-throttled-frame` | `browser-bench`: ≥ 60 fps at q0 under a CDP 4× throttle | reference certificate (D6) |

**Budgets may not be lowered to go green** — they moved, with their numbers intact. The CI `bench` job
stays `continue-on-error` until `client-js-gzip` (135.7 kB against the 120 kB floor) is fixed by P3-E-7;
that, not theme cost, is now the only reason it is non-blocking.

**Wall-clock budgets in unit tests are calibrated (P3-E-8).** A unit test may not assert a raw
millisecond figure: on a CI runner ~3× slower than the machine that set the budget it measures the
runner, not the product (`theme-previews` read 7–10 ms against 3 ms on every CI run for six weeks). Use
`tests/support/timing.ts`: `calibratedBudget(base)` is `base × max(1, speedFactor())`, where
`speedFactor` is a same-process calibration workload against a recorded reference — so the budget is
exactly the number in the test on a reference-speed machine and scales up, never down, elsewhere (the
bench harness's calibration ratio, applied to unit tests). Declare such a test with `timingIt` and
`[timing]` in its name: it is skipped under `npm run coverage` (V8 instrumentation inflates `src/`
2–10×, which no test-side calibration can cancel) and run uncovered by `npm run test:timing`, a
blocking step of the `verify` job. The behavioural half of the check stays in a plain `it`. `scripts/bench.mjs` also refuses to write a
`bench-baseline.json` row for any case that missed its budget — so a red row's number lives in the
phase document and in the run output, never in a file that looks like an approval.

**Two-tier frame-rate gate for themes (decision D6, 2026-10-06, ADR-012).** A frame *rate* is
certified in a browser, never in Node. The tiers are:

| Tier | Where | Gate | Blocks merge? |
|---|---|---|---|
| **CI floor** | Blocking Playwright job on the CI runner (headless Chromium; software raster is acceptable) | Per theme: effect-liveness (each enabled stage changes pixels), zero steady-state heap growth over 300 frames, and **q3 frame ≤ 2.5× Default's frame on the same runner** (a same-runner ratio, like the wall-clock calibration above). | Yes |
| **Reference certificate** | The **reference machine**: a named, GPU-backed desktop recorded in `docs/gate-history/README.md` (CPU, GPU, browser version, OS) | Absolute ≥ 55 fps at q3 and ≥ 60 fps at q0 under a 4× CPU throttle, 1080p, ~100k visible cells | No: `gate-history: browser-bench`, per §3.10's merge-then-certify rule |

The 2.5× ratio is the initial value P3-E-1 commits. It may be tightened by measurement but never
loosened to go green.

**What the bundle floor measures (decision D4, 2026-10-06).** The §3.6 floor is "Client JS bundle
(gzip, **excl. themes**)", but before P3-E-7, `client-js-gzip` summed every emitted JS asset. Its
135.7 kB "failure" therefore measured a different quantity. From P3-E-7, each non-Default theme is
a dynamically imported chunk, named `theme-<id>` (and `theme-effects` for the passes they share) by
`vite.config.ts`. `client-js-gzip` sums every chunk except `theme-*`, so it matches the floor as
written. A new deterministic case, `theme-chunk-gzip-max`, gates the largest theme chunk (12 KiB
against 7.36 measured, ≤ 3% regression band). This aligns a measurement with its stated definition
and adds a gate. It does not loosen one.

**The floor is initial-load JS (P3-E-10, operator decision 2026-10-06).** With themes excluded the
floor still read 127.45 KiB, and the remaining 7.45 KiB was Phase 3's own non-theme infrastructure. A
metric that sums every emitted chunk cannot be improved by loading things lazily — a lazy chunk is
still emitted — so the floor is redefined as what loads at startup: the entry chunk `index.html`
names, everything it reaches through **static** imports, and the workers started at boot (`sim.worker`).
This is a statement about the *cold load*, which is what the floor exists to protect, and it is not a
loosening: **the 120 KiB budget is unchanged**, and the app measured 106.4 KiB under the new
definition before any panel was made lazy, and 85.3 KiB once Statistics, Library and Ruleset Studio
were (P3-E-10) (`bench.worker`, 21 KiB, is created on demand).

It is measured by import **reachability**, never by chunk name (`tests/bench/bundle-graph.ts`, unit
tested): a chunk that is lazy by name but statically imported by the entry is counted, so a
lazy-loading regression cannot hide. So that moving bytes out of startup never makes them invisible,
two sibling cases accompany it: `emitted-js-gzip` (every chunk, regression-gated, no budget) and
`on-demand-chunk-gzip-max` (the largest chunk that is not loaded at startup, budgeted).

| Case | Measures | Gate |
|---|---|---|
| `client-js-gzip` | initial-load JS | ≤ 120 KiB; ≤ 3% regression |
| `emitted-js-gzip` | all emitted JS, loaded or not | ≤ 3% regression |
| `on-demand-chunk-gzip-max` | largest chunk not loaded at startup | budgeted; ≤ 3% regression |
| `theme-chunk-gzip-max` | largest theme chunk | 12 KiB; ≤ 3% regression |

**Transcribed / non-timed cases:** `cold-load-recorded` is renamed `cold-load-transcribed` and
carries `transcribed: true`, which the runner's table marks with a `*` and a footnote — visible in
the output itself, not just this file's comment. It does not pretend to be a live wall-clock
measurement.

#### Status: in force (P2-F-1 closed 2026-09-14)

Every case in `tests/bench/*.bench.ts` declares a `class`; there is no `baselineGate: false`
opt-out left anywhere in the tree. The flat, uniform **>10% baseline regression** check described
in earlier revisions of this document no longer exists in any form — deterministic cases gate at
≤3%, wall-clock cases gate on the calibration ratio, browser cases gate on their absolute budget
alone. `tests/unit/bench-runner.spec.ts` proves a failing case in each of the three classes.

### 3.7 Accessibility & motion baseline

From Phase 1, every interactive control is keyboard-reachable with a visible focus ring,
every icon-only control has an accessible name, contrast meets WCAG AA for UI chrome in
**every** theme, and `prefers-reduced-motion: reduce` disables non-essential animation and
mutes ambient audio. A theme is not shippable until it passes these in Phase 3.

### 3.8 Determinism

Given the same ruleset, seed, boundary mode and edit log, the engine must produce
bit-identical state at any tick, on any platform, in any build. All randomness flows through an
injected, seedable PRNG (`Mulberry32`, hand-written, ~10 lines). This is what makes the
Time-Traveler, the Laboratory diff, and the test oracles possible — it is a load-bearing property,
not a nicety. Phase 0 ships a cross-run determinism test; every later phase keeps it green.

### 3.9 Licensing & attribution (two layers — decided 2026-09-11)

Licensing is **two decisions**, not one. Code and content do not share a licence.

#### Code (MIT)

Everything under `src/`, `scripts/`, `tests/`, and project config ships under **MIT**. Root
`LICENSE` carries the MIT text. `package.json` keeps `"private": true` **and** adds
`"license": "MIT"` (those do not conflict — private only blocks accidental npm publish).

Apache-2.0 was considered and rejected: the patent grant is not needed for this project, and
GPLv2 incompatibility would only matter if we vendored Golly (we will not).

#### Content (`patterns/`, and any non-code docs that carry third-party material)

Per-item provenance, per-item licence. No blanket content licence. Policy in one sentence:

> **Take facts, write your own words.** Name, discoverer, discovery year, period, speed,
> population, bounding box, and the cell layout are treated as facts. Library-panel descriptions
> are written fresh by this project — never paste LifeWiki (or other wiki) prose.

Attribute generously anyway: discoverer and year on every pattern; a Credits dialog listing every
collection and its terms. Community norm first; compliance second — they coincide here.

**Do not** wholesale-mirror a pattern archive. Hand-pick entries with recorded provenance.
A downstream repackager's licence (e.g. an npm pattern dump under ISC) does **not** launder
upstream terms — never copy that model.

#### LifeWiki terms (operator-verified 2026-09-11)

Read from the LifeWiki site footer (conwaylife.com), recorded verbatim:

> All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available
> under the Creative Commons CC0 License; text in the other namespaces is available under the
> Creative Commons Attribution-ShareAlike License; additional terms may apply.

The footer does **not** state a BY-SA version number. When `patterns/SOURCES.md` is written
(P2-B-1), copy this string and the verification date into it. Prefer facts / structured data
(CC0) and original descriptions; do not embed wiki prose (BY-SA / possible GFDL confusion in
older secondary sources) into the app.

#### Repo shape (implemented by P2-B-1 — planning only until that task runs)

```
LICENSE                     MIT, covering code
LICENSES/                   full text of every content licence in use
  CC0-1.0.txt
  CC-BY-SA-4.0.txt          (and others only when a Class-C source requires them)
NOTICE                      human-readable attribution roll-up
patterns/
  SOURCES.md                this policy, then the per-source table
  <name>.rle                SPDX + provenance in #C lines
scripts/check-pattern-licenses.mjs   runs in `npm run verify`
```

Per-pattern headers extend the existing `#N` / `#O` / `#C` convention:

```
#N Gosper glider gun
#O Bill Gosper, 1970
#C SPDX-License-Identifier: CC0-1.0
#C SPDX-FileCopyrightText: none claimed (configuration; see SOURCES.md §2)
#C source: https://conwaylife.com/wiki/Gosper_glider_gun
#C verified: fancy-gol P2-B-1, period 30, emits glider every 30 gens
```

#### Provenance classes (allowlist — the gate's teeth)

| Class | Meaning | SPDX / disposition |
|---|---|---|
| **A** | Originated here (agent-generated, hand-drawn, own soup search) | `CC0-1.0` |
| **B** | Canonical historical configuration; attributed; treated as fact | `CC0-1.0` + `SPDX-FileCopyrightText: none claimed …` |
| **C** | Named collection with published terms that permit redistribution | Terms recorded verbatim in `SOURCES.md`; per-file SPDX from allowlist |
| **D** | Unclear provenance | **Omitted.** Never shipped. |

`scripts/check-pattern-licenses.mjs` (wired into `verify`) fails the build unless every
`patterns/**/*.rle` has: a name (`#N`), a discoverer field (`#O` — `unknown` permitted, blank
not), a `source:` URL, and an `SPDX-License-Identifier` drawn from the allowlist. Same leverage
pattern as `no-literal-design-tokens`: the policy is a gate, not a convention.

UI (P2-B-3): library cards show discoverer + year with a link to `source`; a Credits dialog lists
every collection and its recorded terms.

### 3.10 Gate-history criteria (decided 2026-09-11; implemented P2-F-3, 2026-09-14)

Some acceptance criteria cannot be proven inside the task that owns them (e.g. "non-flaky over 10
consecutive CI runs"). Those are a **gate-history** class:

- Discharged by an **accumulating CI / nightly record**, not by the implementing task.
- The record lives at **`docs/gate-history/`**:
  - `records.jsonl` — source of truth, one JSON object per suite-sample
  - `INDEX.md` — generated summary (do not hand-edit)
  - `README.md` — how to cite
- The workflow is **`.github/workflows/nightly-flake.yml`**: nightly cron on the default branch,
  plus `workflow_dispatch` so a phase branch can seed the log before merge. Each run re-runs the
  e2e and visual suites (optional inner repeats) and appends to the jsonl. GitHub's
  `workflow_dispatch` API 404s until the file exists on the **default** branch — a phase-branch
  file cannot be dispatched. Until merge, seed samples may be appended from a green CI run of
  the same Playwright projects (`append --event push`); they are still seed samples, not an
  official streak.
- A task cites `gate-history: <record-id> ≥ N green` instead of pretending to run N CI jobs
  in-process. Current ids: `e2e-nonflake`, `visual-nonflake`. Check with
  `node scripts/gate-history.mjs cite visual-nonflake 3` (exits 0 only when the **official**
  streak is met).
- **Official** streak: samples on `main` whose `event` is `schedule`, `push`, or
  `workflow_dispatch`. Phase-branch dispatch samples prove the mechanism and are in the log;
  they do not increment the cite. Phase 3's **P3-D-2** consumes `visual-nonflake`; browser-class
  benches still hold their absolute budget in `npm run bench`.
- **`browser-bench` (added by P3-D-4, 2026-10-04; amended 2026-10-06).** `tests/perf/themes-fps.spec.ts`
  measures per-theme frame rate at 1080p with ~100k visible cells: quality 3, and quality 0 under a
  CDP 4× CPU throttle. It runs on the nightly as its own Playwright project and appends under this
  id. It exists because no Node harness can certify a frame rate, and because Node doubles diverge
  from the browser on exactly the behaviour that matters (ADR-011 amendment: in the browser the
  per-texel passes read zeros). Its samples are the **reference certificate** tier of §3.6's
  two-tier frame gate. The blocking CI floor tier (effect liveness, allocation, same-runner ratio)
  is a separate Playwright project that P3-E-1 adds.

Until three official `main` samples exist, criteria that need gate-history keep an honest
interim note naming the current official streak — never a silent tick.

**Merge-then-certify (decision D5, 2026-10-06).** An official streak can only accumulate on `main`,
so a phase can never satisfy a streak criterion *before* its merge. A phase branch may therefore
merge with gate-history criteria still open when **all** of the following hold:

1. Every non-history gate for the phase is green in CI on the branch.
2. Each open record id has **≥ 1 green branch sample** (a `workflow_dispatch` or seeded
   `append --event push`) that proves the mechanism works.
3. Each open criterion carries its interim note, and the phase's Definition of Done lists it as
   "certifying on `main`".

After the merge, the criteria are ticked from `main`'s official streak, in a docs-only commit on
`main` (permitted by `AGENTS.md` §6). A red official streak on `main` is a regression: it is fixed
on the next phase branch before that branch may merge. This rule changes **when** a streak is
cited, not **what** it requires.

---

## 4. Target repository layout

The end-state tree. Phases create it incrementally; the boundary checker knows this shape.

```
fancy-gol/
├── .agents/
│   ├── docs/INCEPTION.md
│   └── planning/                    ← you are here
├── .githooks/commit-msg
├── .github/workflows/ci.yml
├── docker/
│   ├── Dockerfile                   multi-stage production image
│   ├── Dockerfile.dev
│   ├── docker-compose.yml
│   └── docker-compose.dev.yml
├── LICENSE                          MIT (code)
├── LICENSES/                        full texts of content licences in use
├── NOTICE                           attribution roll-up for pattern sources
├── patterns/                        RLE catalogue, per ruleset (+ SOURCES.md)
├── scripts/
│   ├── check-boundaries.mjs         layering enforcement (hand-written)
│   ├── check-pattern-licenses.mjs   pattern provenance gate (Phase 2)
│   ├── gate-history.mjs             accumulating flake record (P2-F-3)
│   ├── bench.mjs                    benchmark runner + budget gate
│   └── gen-thumbnails.mjs           build-time pattern thumbnails
├── src/
│   ├── engine/          PURE. no DOM, no Node, no I/O.
│   │   ├── types.ts             StateId, Coord, ChangeSet, …
│   │   ├── rng.ts               Mulberry32
│   │   ├── grid/                ChunkedGrid, chunk maths, coordinate packing
│   │   ├── rules/               schema, validator, parser, compiler, builtin/
│   │   ├── neighborhood/        moore, vonNeumann, hex, custom offsets
│   │   ├── history/             keyframe + delta journal
│   │   ├── stats/               metric collectors, cycle detection
│   │   ├── patterns/            RLE / plaintext / Life1.06 codecs
│   │   ├── simulation.ts        the Simulation class
│   │   └── index.ts             the only public entry point
│   ├── shared/          pure-logic lane: types, protocol, codecs (rle, rng, color, …)
│   ├── worker/          sim.worker.ts + protocol implementation
│   ├── render/          Renderer interface, Canvas2D, WebGL2, LOD, dirty-rect
│   ├── themes/          one directory per theme: tokens, module, effects, sound
│   ├── audio/           WebAudio graph, synth voices, mixer
│   ├── ui/              HUD, panels, palette, timeline, laboratory, charts
│   ├── client/          index.html, main.ts, app wiring, state store
│   └── server/          express app, routes, ws hub
├── tests/
│   ├── unit/  integration/  e2e/  bench/  fixtures/  visual/
├── CHANGELOG.md
├── ARCHITECTURE.md
├── CONTRIBUTING.md
└── README.md
```

---

## 5. Standing definition of "excellent"

A task is excellent — not merely done — when all of these are true:

- [ ] A beginner can discover the feature without documentation.
- [ ] An expert can drive it entirely from the keyboard.
- [ ] It looks deliberate in all six themes.
- [ ] It does not allocate in the hot loop.
- [ ] It degrades gracefully: reduced motion, no WebGL, no SharedArrayBuffer, no network.
- [ ] Its failure mode is a legible message, never a blank screen or a silent no-op.
- [ ] Someone reading the diff a year later can tell *why*, not just *what*.
