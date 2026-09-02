# AGENTS.md — the operating manual for every agent on fancy-gol

> **Read this file first, every session, before touching anything.**
> It is the contract. `.agents/` is the source of truth for this project.

---

## 0. What this project is

**fancy-gol** is a cellular automata simulator.

> *A cellular automata simulator with absolutely too much time spent on what's essentially a toy.
> But this toy doesn't care, it wants to be fabulous!*

It is also a full agentic coding experiment: **all agent files live in the repo**, in the open.
The way this gets built is part of the artefact. Work accordingly — someone will read your commits.

The standard is not "working". The standard is **excellent, optimised, and fabulous**:

- **Excellent** — a beginner can use it without documentation; an expert has everything at their fingertips.
- **Optimised** — nothing allocates in a hot loop, nothing re-renders without a state change, every budget is measured and gated.
- **Fabulous** — if it is boring, it is not finished. Find the version of it that makes someone smile.

If you produce something that is *just okay*, you are not done. That rule is in the inception
document by name (**Agit-Prop**) and it applies to you.

---

## 1. `.agents/` is the source of truth

Every development document and artefact lives here. Not in the wiki, not in an issue, not in a
chat transcript. **Here.**

```
.agents/
├── AGENTS.md                  ← this file. The contract.
├── dashboard.html             ← GENERATED status dashboard. Open it in a browser.
├── scripts/
│   └── build-dashboard.mjs    ← regenerates the dashboard from the phase plans
├── docs/
│   ├── INCEPTION.md           ← the founding vision. The standard. Re-read it every phase.
│   └── RETROSPECTIVE.md       ← written at 1.0.0 (Phase 6)
└── planning/
    ├── README.md              ← index + the cross-phase engineering rules (§3 is mandatory reading)
    ├── ARCHITECTURE_DECISIONS.md  ← ADR-001…010. Binding. Read once, in full, before Phase 0.
    ├── PHASE_0_FOUNDATION.md      ← 36 tasks   → v0.1.0
    ├── PHASE_1_INTERACTION.md     ← 28 tasks   → v0.2.0
    ├── PHASE_2_LIBRARY_AND_STATS.md ← 21 tasks → v0.3.0
    ├── PHASE_3_THEME_ENGINE.md    ← 19 tasks   → v0.4.0
    ├── PHASE_4_POWER_UX.md        ← 17 tasks   → v0.5.0
    ├── PHASE_5_SCALE_AND_PERF.md  ← 15 tasks   → v0.6.0
    └── PHASE_6_LAUNCH.md          ← 19 tasks   → v1.0.0
```

**The phase documents are the tracker.** They are living checklists, not a plan you read once.
You edit them in place as you work. 155 tasks, 470 acceptance criteria, all specified.

If you believe a plan is wrong, say so and amend the document with a reason. Do not silently
diverge from it, and do not silently follow it off a cliff.

---

## 2. The seven standing rules — from INCEPTION.md

These are quoted from the founding document. They are not suggestions.

### 1. No Bloat
> *"If a library can be written in 50 lines of TS, don't import a package for it."*

The **entire permitted runtime dependency surface is `express` and `ws`.** Nothing else.
Before adding any runtime dependency, your PR/commit description must state: what it does, why
50 lines of TypeScript cannot, and its transitive dependency count. Expect the answer to be no.

Written by hand *by design*, each a named task: the ruleset validator, the RLE codec, the charting
module, the fuzzy matcher, the easing solvers, the boundary checker, the audio synthesis, the
commit-message hook, and the changelog automation.

### 2. Pure Logic
> *"The simulation logic must never know the UI exists."*

`src/engine/**` may import only from `src/engine/**` and `src/shared/types/**`. It may not touch
`window`, `document`, `navigator`, `localStorage`, `fetch`, `console`, `process`, or `performance`
(inject a clock). This is machine-enforced by `scripts/check-boundaries.mjs` in CI from Phase 0.
A violation fails the build. Do not weaken the checker to pass; fix the code.

### 3. Stay Fancy
> *"If a feature is 'boring,' find a way to make it visually interesting."*

Grid lines fade with zoom instead of toggling. The ruleset picker runs live animated thumbnails
instead of being a `<select>`. The library has a "randomise rule" button. The dashboard you are
about to update has Conway's Life running in its background. This is the expected standard of care.

### 4. Automated Proof
> *"Every step must pass its Vitest suite before being considered 'done.'"*

No task is checked off until its tests exist and pass, `npm run verify` is green, and the coverage
and performance gates hold. See §5.

### 5. Agit-Prop
> *"If an agent produces code that is 'just okay,' demand it be 'excellent.'"*

Applies to your own output. Before you check a box, read your diff as a hostile reviewer.

### 6. Changelog
> *"A changelog and semantic versioning from the beginning."*

`CHANGELOG.md` is Keep-a-Changelog format, updated **in the same commit as the change**, never
retroactively. Semver from commit one; each phase bumps the minor version per the table in §6.

### 7. Conventional commits, logically parsed
> *"Agents are allowed to commit code, using conventional commit messages, and in a logical and
> parsed manner - conducive to development."*

See §7. Small, atomic, independently green commits. One task is one to three commits.

---

## 3. Before you write any code

1. Read `.agents/docs/INCEPTION.md`. Every phase. It is short and it is the standard.
2. Read `.agents/planning/README.md` — especially **§3, the cross-phase engineering rules**
   (purity, no-bloat, coverage gates, performance budgets, accessibility baseline, determinism).
3. Read `.agents/planning/ARCHITECTURE_DECISIONS.md` in full, once. Ten binding decisions with
   their TypeScript contracts. Most "should I do X?" questions are already answered there.
4. Open `.agents/dashboard.html` in a browser. It tells you the next task.
5. Read the phase document for the phase you are in.

Do not start from a summary of these documents. Read the documents.

---

## 4. The work loop

```
┌─ 1. Find the next task ─────────────────────────────────────────────────┐
│    Open .agents/dashboard.html → the "Next up" banner names it.          │
│    Or scan the phase doc top-to-bottom for the first  - [ ]  task whose  │
│    "Depends on" list is fully  - [x] . Workstreams are ordered so this   │
│    heuristic is almost always right.                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─ 2. Claim it ───────────────────────────────────────────────────────────┐
│    Change  #### - [ ] P0-A-1 ·  to  #### - [~] P0-A-1 ·                  │
│    Regenerate the dashboard. Commit. Now everyone knows it is live.      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─ 3. Build it ───────────────────────────────────────────────────────────┐
│    Follow the task's Implementation notes. They exist because someone    │
│    already thought about the failure modes. Honour the ADR contracts.    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─ 4. Prove it ───────────────────────────────────────────────────────────┐
│    Write the tests named in the task. Tick each acceptance criterion     │
│    - [ ] → - [x] only when it is genuinely, measurably true.             │
│    Run:  npm run verify   (typecheck + lint + boundaries + test + build) │
│    Run:  npm run bench    if the task touches a hot path                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─ 5. Close it ───────────────────────────────────────────────────────────┐
│    Task checkbox  - [~] → - [x]                                          │
│    Update CHANGELOG.md in the same commit                                │
│    node .agents/scripts/build-dashboard.mjs        ← MANDATORY           │
│    Commit the code, the doc, the changelog and the dashboard together.   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Status markers (used in the phase docs, read by the dashboard)

| Marker | Meaning |
|---|---|
| `- [ ]` | Not started |
| `- [~]` | In progress — add `— @owner, started YYYY-MM-DD` |
| `- [x]` | Done, merged, gates green |
| `- [!]` | Blocked — add the blocking task ID or the open question |
| `- [-]` | Cut — add a one-line reason. Never delete a task; never renumber an ID. |

---

## 5. Updating the dashboard is mandatory

**`.agents/dashboard.html` must be regenerated and committed whenever a task or an acceptance
criterion changes status.** A commit that ticks a checkbox without regenerating the dashboard is
incomplete.

```bash
node .agents/scripts/build-dashboard.mjs          # regenerate in place
node .agents/scripts/build-dashboard.mjs --check  # exit 1 if out of date  (wire into CI)
```

- The generator reads the checkboxes in `.agents/planning/PHASE_*.md`. **The phase docs are the
  single source of truth; the dashboard is a projection of them.** Never hand-edit the generated
  `PROJECT_STATE` block.
- It is dependency-free, needs only Node ≥ 18, and rewrites nothing but the marked state block.
- The dashboard is a single self-contained file. Open it directly in a browser — no server, no build.
- Once Phase 0's CI exists (task P0-I-5), add `--check` to the pipeline so a stale dashboard fails the build.

---

## 6. Branch and release model

**`main` holds only the tested, stable output of a completed phase.** Each phase is developed on
its own branch and merged back when every gate for that phase is green.

```
main ──●─────────────────────────●─────────────────────────●──────▶
       │ planning landed         │ merge + tag v0.1.0      │ merge + tag v0.2.0
       │                         ↑                         ↑
       └── phase/0-foundation ───┘                         │
                                 └── phase/1-interaction ──┘
```

| Phase | Branch | Merges to main as |
|---|---|---|
| 0 | `phase/0-foundation` | `v0.1.0` |
| 1 | `phase/1-interaction` | `v0.2.0` |
| 2 | `phase/2-library-and-stats` | `v0.3.0` |
| 3 | `phase/3-theme-engine` | `v0.4.0` |
| 4 | `phase/4-power-ux` | `v0.5.0` |
| 5 | `phase/5-scale-and-perf` | `v0.6.0` |
| 6 | `phase/6-launch` | `v1.0.0` |

### ⚠️ ACTION REQUIRED BY THE NEXT AGENT

> **The `phase/0-foundation` branch has NOT been created yet.**
> `main` currently contains planning artefacts only — no implementation code.
>
> **Before writing a single line of Phase 0 code:**
> ```bash
> git checkout main && git pull
> git checkout -b phase/0-foundation
> ```
> **Do not commit implementation code to `main`.** Merge back only when every Phase 0 gate in
> `PHASE_0_FOUNDATION.md` §4 is green, then tag `v0.1.0`.

Documentation-only fixes to `.agents/**` may land on `main` directly. Everything else branches.

---

## 7. Commits

**Conventional Commits**, enforced from Phase 0 by `.githooks/commit-msg` (hand-written, ~40 lines).

```
type(scope): imperative subject, no trailing period, ≤72 chars

Optional body explaining WHY, wrapped at 72.
Reference the task ID it closes.
```

- **Types:** `feat` `fix` `perf` `refactor` `test` `docs` `build` `ci` `chore` `style` `revert`
- **Scopes:** `engine` `rules` `grid` `history` `worker` `render` `ui` `themes` `audio` `server`
  `docker` `bench` `planning` `agents`
- Commits are small, logical, and **independently green** — every commit on a phase branch should
  pass `npm run verify` on its own.
- One task is typically one to three commits: the implementation, the tests, and the bookkeeping
  (checkbox + changelog + dashboard) — or all three together if small.
- Never mix a refactor with a feature. Never mix a formatting sweep with anything.

Example:
```
feat(engine): add chunked sparse grid with per-chunk summaries

Implements P0-C-2. Chunks are 32x32 Uint8Array pages in a Map keyed by
packed signed chunk coords, with lazy allocation and hysteresis-delayed
reclamation. Per-chunk population and per-state counts are maintained
incrementally so the stat engine and the Phase 5 density LOD get them free.

Closes P0-C-2.
```

---

## 8. The quality bar — what "done" actually means

A task is `- [x]` only when **all** of these hold:

- [ ] Every acceptance criterion in the task is individually ticked and genuinely true.
- [ ] Tests exist, are behavioural (their failure would indicate a user-visible defect), and pass.
- [ ] `npm run verify` is green — typecheck, lint, **boundaries**, unit tests, build.
- [ ] Coverage gates hold: **95% statements on `src/engine/**`**, per `planning/README.md` §3.5.
      Thresholds may be raised, never lowered.
- [ ] Performance budgets hold, with no benchmark regression beyond 10% (`planning/README.md` §3.6).
- [ ] From Phase 1: the Playwright spec for the feature exists and passes.
- [ ] From Phase 3: it looks deliberate in **all six themes** and passes contrast in each.
- [ ] `CHANGELOG.md` updated in the same commit.
- [ ] Dashboard regenerated and committed.

And the standing definition of *excellent* (`planning/README.md` §5):

- [ ] A beginner can discover it without documentation.
- [ ] An expert can drive it entirely from the keyboard.
- [ ] It does not allocate in the hot loop.
- [ ] It degrades gracefully — reduced motion, no WebGL, no SharedArrayBuffer, no network.
- [ ] Its failure mode is a legible message, never a blank screen or a silent no-op.
- [ ] Someone reading the diff in a year can tell *why*, not just *what*.

---

## 9. Hard prohibitions

Do not:

- **Add a runtime dependency** beyond `express` and `ws` without meeting the §2.1 bar.
- **Reference the DOM, Node, or any I/O from `src/engine/**`.**
- **Weaken a gate to make a build pass** — not the coverage threshold, not the boundary checker,
  not a performance budget, not a visual baseline. Fix the code or raise the problem.
- **Re-baseline a failing visual or benchmark test** without investigating and recording why.
- **Change simulation behaviour in a performance task.** Every fast path (Phase 5) must prove
  byte-identical equivalence against the scalar reference kernel.
- **Delete or renumber a task ID.** Mark it `- [-]` with a reason.
- **Hand-edit the generated `PROJECT_STATE` block** in the dashboard.
- **Commit implementation code to `main`.** Use the phase branch.
- **Silently discard user data or history.** Every destructive action needs an explicit,
  informative confirmation. This is a gate in Phase 4 and a launch criterion in Phase 6.
- **Present an approximation as exact.** Sampled entropy, downsampled charts and reduced-quality
  rendering are all *labelled* as such. A tool that quietly lies about its own numbers is worthless.
- **Ship a pattern you cannot attribute** (Phase 2) or a claim you have not verified (Phase 6).

---

## 10. Escalate rather than guess

Stop and ask the human operator when:

- an ADR appears wrong or two ADRs conflict;
- a task's acceptance criteria cannot be met as written;
- meeting a performance budget would require breaking a design principle;
- you would need to add a runtime dependency;
- a phase gate cannot be made green.

Record the answer in the relevant document. A decision that lives only in a chat log did not happen.

---

## 11. Quick reference

```bash
npm run verify        # typecheck + lint + boundaries + test + build   ← the gate
npm run test          # vitest
npm run coverage      # vitest with thresholds
npm run bench         # performance budgets, fails on >10% regression
npm run e2e           # Playwright (from Phase 1)
npm run boundaries    # layering + engine purity enforcement

node .agents/scripts/build-dashboard.mjs           # regenerate the dashboard  ← after every task
node .agents/scripts/build-dashboard.mjs --check   # CI: fail if stale
```

| I want to… | Read |
|---|---|
| know the vision and the standard | `.agents/docs/INCEPTION.md` |
| know the next task | `.agents/dashboard.html` |
| know the rules that apply everywhere | `.agents/planning/README.md` §3 |
| know why the architecture is the way it is | `.agents/planning/ARCHITECTURE_DECISIONS.md` |
| know exactly what to build | `.agents/planning/PHASE_<n>_*.md` |
| know how to work and commit | this file |

---

*Stay fancy.*
