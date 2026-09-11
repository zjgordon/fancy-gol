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

Supporting document: **[ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md)** — the ten binding
decisions (ADR-001 … ADR-010) that these phases implement. Read it once, in full, before Phase 0.

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
| `src/worker/**` | **95%** (from P2-F-1) | **90%** | **95%** |
| `src/render/**` | 85% | 75% | 85% |
| `src/ui/**`, `src/themes/**` | 70% | 60% | 70% |
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
gates (decided 2026-09-11; implemented by **P2-F-1**). Until P2-F-1 lands, be honest about what
the build actually does today (below).

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

#### Target gate policy (three classes — P2-F-1)

Every bench case lands in **exactly one** class and inherits that class's policy. There is no
per-case `baselineGate: false` escape hatch — that valve was pulled ten times in Phases 0–1 and
is retired.

| Class | Examples | Policy |
|---|---|---|
| **Deterministic** | `client-js-gzip`, `grid-1m-memory` | Tight regression gate **2–3%**. No noise excuse exists. |
| **Wall-clock CPU** | `conway-512-soup`, `conway-4096-1pct`, `paint-1m`, `snapshot-restore`, `seek-4000`, `stats-overhead` | Noise-aware gate on a **calibration ratio** (below), not raw milliseconds. |
| **Browser / GPU / paint** | `render-frame-cpu`, `main-thread-block`, `pan-1000pxs-1080p`, `zoom-32-0.5-32-min-fps`, interaction paint latency | **Absolute budget only**, plus accumulating **gate-history** once that mechanism exists (§3.2 / before Phase 3). |

**Every case gets a budget or a class gate, or is deleted.** A measured number nobody checks is
decoration (`default-theme-palette-lookup` and `snapshot-restore` currently gate nothing — fix or
cut in P2-F-1).

**Calibration (wall-clock class):** `scripts/bench.mjs` runs a fixed synthetic workload (no
allocation, no I/O) in the same process as the suite. Wall-clock cases report raw milliseconds
for humans but **gate on `median / calibration`**. A slower runner slows the calibration too, so
the ratio holds across machines and the baseline stops being machine-bound — this replaces
per-runner baseline files and closes the Node-24-sandbox-vs-Node-22-CI provenance skew for CPU
cases. Band on the ratio may still be noise-aware (use the spread already computed across the
median-of-7); do not fall back to "turn the gate off".

**Transcribed / non-timed cases:** rename `cold-load-recorded` so its transcribed nature is
visible in the runner output (it is not re-timed by `npm run bench`). It does not pretend to be a
live wall-clock measurement.

#### Interim honesty (until P2-F-1)

Today: absolute budgets are enforced where a case declares `budget`; the flat **>10% baseline
regression** check runs only for cases that leave `baselineGate` at its default (6 of 16 as of
the Phase 0–1 retro). Ten cases opt out; two have neither budget nor gate. **Do not claim a
uniform >10% regression gate** in process docs, commit messages, or PR templates until P2-F-1
closes. Softened claims point here.

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

### 3.10 Gate-history criteria (decided 2026-09-11)

Some acceptance criteria cannot be proven inside the task that owns them (e.g. "non-flaky over 10
consecutive CI runs"). Those are a **gate-history** class:

- Discharged by an **accumulating CI / nightly record**, not by the implementing task.
- The record's home is named in **P2-F-3** (workflow + path under `docs/gate-history/` or agreed
  equivalent).
- A task may cite `gate-history: <record-id> ≥ N green` instead of pretending to run N CI jobs
  in-process. Phase 3's **P3-D-2** and browser-class benches consume this.

Until P2-F-3 is `- [x]`, criteria that need gate-history keep an honest interim note (local
repeats + "literal CI streak deferred") — never a silent tick.

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
