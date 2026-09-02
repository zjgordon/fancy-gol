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

`src/engine/**` may import only from `src/engine/**` and `src/shared/types/**`. It may not
reference `window`, `document`, `navigator`, `performance` (use an injected clock), `console`,
or any DOM/Node API. This is machine-enforced by `scripts/check-boundaries.mjs` in CI from
Phase 0 onward. A violation fails the build.

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
  never generated retroactively. Every phase closes by moving `[Unreleased]` into a dated release heading.
- Commits are small, logical, and independently green. One task ≈ one to three commits.

### 3.5 Coverage gates (ratcheted, never lowered)

Enforced by `vitest --coverage` thresholds in `vitest.config.ts`:

| Path | Statements | Branches | Functions |
|---|---|---|---|
| `src/engine/**` | **95%** | **90%** | **95%** |
| `src/shared/**` | 95% | 90% | 95% |
| `src/render/**` | 85% | 75% | 85% |
| `src/ui/**`, `src/themes/**` | 70% | 60% | 70% |
| `src/server/**` | 85% | 75% | 85% |

Thresholds may be **raised** by a phase. They may never be lowered; a phase that would lower one
must instead delete or fix the untested code.

### 3.6 Performance budgets (CI-enforced from Phase 0)

`npm run bench` runs a committed suite and fails on regression beyond the stated tolerance (10%).
Budgets tighten per phase; each phase document restates the numbers it must hit.

| Metric | Phase 0 floor | Phase 5 target |
|---|---|---|
| Conway steps/sec @ 512×512 dense random (soup) | ≥ 60 | ≥ 400 |
| Conway steps/sec @ 4096×4096, 1% density | ≥ 5 | ≥ 60 |
| Largest live grid without OOM | 10⁶ live cells | 10⁸ addressable / 10⁷ live |
| Frame time, 1080p viewport, steady state | ≤ 16.6 ms | ≤ 8 ms |
| Main-thread block per tick | ≤ 4 ms | ≤ 1 ms |
| Cold interactive load (local, gzip) | ≤ 1500 ms | ≤ 800 ms |
| Client JS bundle (gzip, excl. themes) | ≤ 120 kB | ≤ 180 kB |

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
├── patterns/                        RLE catalogue, per ruleset
├── scripts/
│   ├── check-boundaries.mjs         layering enforcement (hand-written)
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
│   ├── shared/          types crossing thread & network boundaries
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
