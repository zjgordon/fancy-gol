# CLAUDE.md

Guidance for Claude Code when working in this repository.

## ⚠️ Read this first

**`.agents/AGENTS.md` is the operating manual for this project. Read it in full before doing
anything.** This file is a summary that exists so nothing critical is missed; it is not a
substitute for the real documents.

`.agents/` is the **source of truth** for all development documents and artefacts.

```
.agents/AGENTS.md                        the contract — read every session
.agents/dashboard.html                   generated status board — tells you the next task
.agents/scripts/build-dashboard.mjs      regenerates it
.agents/docs/INCEPTION.md                the founding vision and the standard
.agents/planning/README.md               index + cross-phase engineering rules (§3 mandatory)
.agents/planning/ARCHITECTURE_DECISIONS.md   ADR-001…010, binding
.agents/planning/PHASE_<0-6>_*.md        the task checklists — 155 tasks, 470 criteria
```

## What this is

**fancy-gol** — a cellular automata simulator that intends to be fabulous. It is also an open
agentic coding experiment; the agent files are in the repo on purpose.

The bar is **excellent, optimised, and fabulous** — not "working". If your output is *just okay*,
it is not done. That rule is named **Agit-Prop** in the inception document and it applies to you.

## Current state

- `main` contains **planning artefacts only**. No implementation code yet.
- Next task: **P0-A-1** (see `.agents/dashboard.html`).
- **The `phase/0-foundation` branch does not exist yet. Create it before writing any code.**

## Branching — important

`main` holds **only the tested, stable output of a completed phase.** Every phase is built on its
own branch and merged back when all of that phase's gates are green.

```bash
git checkout main && git pull
git checkout -b phase/0-foundation      # ← do this before any Phase 0 code
```

Branch names: `phase/0-foundation`, `phase/1-interaction`, `phase/2-library-and-stats`,
`phase/3-theme-engine`, `phase/4-power-ux`, `phase/5-scale-and-perf`, `phase/6-launch`.

Documentation-only changes under `.agents/**` may land on `main`. **Implementation code may not.**

## The work loop

1. Open `.agents/dashboard.html` — the "Next up" banner names the task.
2. Mark it in progress in the phase doc: `#### - [ ] P0-A-1 ·` → `#### - [~] P0-A-1 ·`
3. Build it, following the task's implementation notes and the ADR contracts.
4. Write the tests it names. Tick each acceptance criterion only when measurably true.
5. `npm run verify` (and `npm run bench` if you touched a hot path).
6. Mark done `- [x]`, update `CHANGELOG.md`, **regenerate the dashboard**, commit it all together.

## Non-negotiable rules

**No Bloat** — the entire permitted runtime dependency surface is `express` and `ws`. If it can be
written in 50 lines of TypeScript, write it. The validator, RLE codec, charts, fuzzy matcher,
easing solvers, audio synthesis and boundary checker are all hand-written by design.

**Pure Logic** — `src/engine/**` must never touch the DOM, Node, or I/O (`window`, `document`,
`navigator`, `localStorage`, `fetch`, `console`, `process`, `performance`). Machine-enforced by
`scripts/check-boundaries.mjs`. Never weaken the checker to pass — fix the code.

**Stay Fancy** — if a feature is boring, find the version of it that is visually interesting.

**Automated Proof** — nothing is done until its tests pass, `npm run verify` is green, coverage
holds (**95% statements on `src/engine/**`**), and benchmarks show no >10% regression.

**Changelog** — Keep-a-Changelog format, updated in the *same commit* as the change. Semver from
commit one; each phase bumps the minor version.

**Dashboard** — `node .agents/scripts/build-dashboard.mjs` after any checkbox change, committed
alongside. `--check` exits 1 when stale. Never hand-edit the generated `PROJECT_STATE` block.

## Commits

Conventional Commits, small and atomic, each independently green.

- Types: `feat` `fix` `perf` `refactor` `test` `docs` `build` `ci` `chore` `style` `revert`
- Scopes: `engine` `rules` `grid` `history` `worker` `render` `ui` `themes` `audio` `server`
  `docker` `bench` `planning` `agents`
- Reference the task ID in the body (`Closes P0-C-2.`).
- Never mix a refactor with a feature, or a formatting sweep with anything.

## Commands

```bash
npm run verify        # typecheck + lint + boundaries + test + build   ← the gate
npm run test          # vitest
npm run coverage      # vitest with thresholds
npm run bench         # performance budgets, fails on >10% regression
npm run e2e           # Playwright (from Phase 1)
npm run boundaries    # layering + engine purity enforcement

node .agents/scripts/build-dashboard.mjs           # after every task
node .agents/scripts/build-dashboard.mjs --check   # CI: fail if stale
```

*(These npm scripts arrive with task P0-A-1. Until then the repo has no `package.json`.)*

## Do not

- Add a runtime dependency beyond `express` and `ws`.
- Reference the DOM, Node, or I/O from `src/engine/**`.
- Weaken a coverage threshold, boundary rule, performance budget or visual baseline to go green.
- Re-baseline a failing benchmark or screenshot without investigating and recording why.
- Change simulation behaviour in a performance task — Phase 5 fast paths must prove byte-identical
  equivalence against the scalar reference kernel.
- Delete or renumber a task ID (mark it `- [-]` with a reason).
- Commit implementation code to `main`.
- Silently discard user data or history — every destructive action needs an explicit confirmation.
- Present an approximation as exact. Sampled, downsampled and degraded outputs are always labelled.

## Escalate rather than guess

Stop and ask when an ADR looks wrong or two conflict, when acceptance criteria cannot be met as
written, when a budget can only be met by breaking a design principle, when you would need a new
runtime dependency, or when a phase gate cannot be made green. Then record the answer in the
relevant document — a decision that lives only in a chat log did not happen.

---

*Stay fancy.*
