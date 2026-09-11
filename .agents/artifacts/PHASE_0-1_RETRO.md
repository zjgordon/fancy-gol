# Phase 0–1 Retrospective

**Scope:** Phases 0 (`v0.1.0`) and 1 (`v0.2.0`), and a forward review of Phases 2–6.
**Date:** 2026-09-08 · **Branch at writing:** `main` (clean, `v0.2.0` tagged)
**Audience:** the operator and every agent that picks up Phase 2.
**Status:** advisory, with accepted decisions recorded in place. Recommendations still need operator
accept / amend / reject unless marked decided. Where one is accepted, it lands in the document it
belongs to (an ADR amendment, a phase task, `AGENTS.md`, `planning/README.md`) — not only here,
and not in a chat log.

**Decisions closed from this retro so far:**
- **2026-09-11 — Licensing (§5.3 / §9 Q1):** MIT for code; per-item pattern provenance + SPDX
  verify gate. Binding text: `planning/README.md` §3.9. Phase 2 AC updated; files on disk deferred
  to P2-B-1.
- **2026-09-11 — Benchmark gate (§3.1 / §9 Q2):** Fix it (three-class policy + calibration) **and**
  soften claims in the meantime. Binding text: `planning/README.md` §3.6; ADR-004 amended;
  owning task **P2-F-1**. Softened AGENTS/CLAUDE/INCEPTION/cursor-rule claims landed with this
  decision; harness code deferred to P2-F-1.
- **2026-09-11 — Pure-logic lane (§3.4 / §9 Q3):** `shared/` is pure, full stop (empirically
  clean — no `shared/lib/` needed). Reject `ui/ → engine/`. ADR-009 amended; owning task
  **P2-A-1** (checker + syntactic RLE + delete duplicates).
- **2026-09-11 — Changelog shape (§3.7 / §9 Q4):** Trim to user-visible + task ID from the
  `v0.3.0` boundary; reasoning stays in phase docs and module comments. Declared in
  `AGENTS.md` §2.6. Existing entries untouched.
- **2026-09-11 — Phase 2 sequencing (§9 Q5) + remaining recommended actions:** All open retro
  proposals landed in planning on `main` before cutting `phase/2-library-and-stats`. New task IDs:
  **P2-B-5**, **P2-C-6**, **P2-F-2**, **P2-F-3**, **P2-G-1**, **P2-G-2**. Agents should follow
  phase docs / ADRs / `planning/README.md` — not this retro — for implementation.

> This is **not** `.agents/docs/RETROSPECTIVE.md`. That one is written at `1.0.0` and closes the
> whole experiment (Phase 6). This is a mid-flight check that the momentum is pointed at the right
> thing before Phase 2 starts.

---

## 1. Where the project actually is

Measured, not asserted. Every number below was read out of the repo on 2026-09-08.

| | |
|---|---|
| Tasks | **64 / 155 done (41.3%)**, 0 blocked, 0 in progress, 0 abandoned |
| Acceptance criteria | **169 / 471 met**; 4 of Phase 0–1's 173 are `- [-]` *relocated*, and all four were later closed by the task they moved to |
| Releases | `v0.1.0` (2026-09-04), `v0.2.0` (2026-09-08), both tagged, both on `main` |
| Elapsed | 7 calendar days from `Initial commit` to `v0.2.0` |
| Commits | 136 — `feat` 64, `docs` 54, `fix` 6, `ci` 5, `refactor` 3, `build` 2, `test` 1 |
| Source | 15,322 lines across 86 `.ts` files (+ CSS/HTML) |
| Tests | 96 spec files; unit + integration + e2e (3 browsers) + visual + bench |
| Coverage (actual) | engine **99.1%** · shared **100%** · render **98.6%** · ui **97.9%** · server **97.4%** · worker **97.7%** · themes **93.2%** · **total 98.3%** statements |
| Runtime deps | **`express`, `ws`.** Nothing else. As specified, from commit one. |
| `TODO`/`FIXME`/`eslint-disable`/`@ts-expect-error` in `src/` and `scripts/` | **zero** |
| Bundle | 52.05 kB gzip against a 120 kB budget (43%) |
| Phase 1 rework | 20,445 insertions against **193 deletions** across the whole phase |

Phase 0 delivered 36 tasks in 3 days; Phase 1 delivered 28 larger ones in 4. Both phases shipped
with their demo asset, their changelog entry, their tag and a green CI run
([34199267453](https://github.com/zjgordon/fancy-gol/actions/runs/34199267453)).

**Assessment: the trajectory is good.** The rest of this document is calibration, not rescue. The
single most important finding is §3.1 — a gate that reads stronger in the documentation than it is
in the build — and it is fixable in an afternoon.

---

## 2. What went well

### 2.1 The honest-substitution discipline — the most valuable behaviour in the log

Four acceptance criteria could not be honestly met when their task ran. Not one of them was
quietly ticked. Each was marked `- [-]`, given a written reason, given an *interim* proof at the
level that was actually available, **relocated by ID to the task that could really prove it**, and
annotated *"do not re-add here."* All four were then closed:

| Criterion | Cut from | Interim proof | Closed by |
|---|---|---|---|
| dpr 1 vs 2 pixel identity | P0-H-2 | `resize()` backing-store test | P1-H-2 (`tests/visual/dpr.spec.ts`) |
| pinch-zoom about the midpoint | P1-A-2 | unit test to 1e-6 on the anchor math | P1-H-1 (`pan-zoom.spec.ts`) |
| every binding exercised in a browser | P1-C-2 | full dispatch round-trip through the real registry | P1-H-1 (`bindings.spec.ts`) |
| layout from 320 px to 5120 px | P1-D-1 | token/flex reasoning, stated as reasoning | P1-H-2 (screenshot set) |

This is exactly the behaviour the "Automated Proof" and "honesty is a feature" rules were written
to produce, and it happened without anyone policing it. **Protect it.** It is worth more to this
project than any individual feature.

### 2.2 The gates are real, and they are machine-enforced

Not one of them is a convention someone remembers to follow:

- `scripts/check-boundaries.mjs` enforces ADR-009's matrix *and* the forbidden-globals scan — and
  it went further than the ADR by banning `Date` as another hidden non-determinism source.
- `scripts/eslint-rules/no-literal-design-tokens.mjs` — a hand-written lint rule that makes the
  Phase 3 theme work possible by refusing literal colours *today*, while there is one theme to fix.
- `build-dashboard.mjs --check` runs in CI; a stale dashboard fails the build.
- CI runs verify on Node 20 + 22, build, bench, docker health, Playwright on Chromium/Firefox/WebKit,
  and a visual-regression job with committed baselines.

The Phase 1 risk table predicted "token discipline erodes" and "the command registry erodes" and
then *shipped the enforcement for both in the same phase*. That is planning doing its job.

### 2.3 Architecture decisions are paying the dividends they promised

- ADR-010's per-chunk `population` / `perState` / `borderMask` summaries already exist and are
  maintained incrementally. Phase 2's entropy work, Phase 5's density LOD and the stat engine all
  read the same structure. The "three features, one data structure" claim is real.
- ADR-007's `ChangeSet`-as-first-class-output means `StatsCollector` never rescans the grid —
  measured stat overhead is **0.91%** against a 3% budget.
- ADR-006's headless in-memory port means the worker protocol is tested with no browser at all
  (`tests/integration/worker-protocol.spec.ts`, `worker-client.spec.ts`).
- ADR-001's multi-state engine did **not** cost the inner loop: Conway 512² soup runs at **246
  steps/sec** against a 60 floor; 4096² @1% at **439** against a floor of 5.

The one ADR that turned out to be incomplete (ADR-006 had no way to push a `Snapshot` back into a
worker) got a proper appended **amendment block** naming the task that forced it, rather than a
silent divergence. That is the process working under stress.

### 2.4 Documentation that explains *why*

`src/client/main.ts` opens with 100 lines of commentary explaining which seam each Phase 1 task
closed and why. `src/ui/tools/brush.ts` explains why its Mulberry32 is a deliberate duplicate
rather than an import. `bench-baseline.json`'s `note` field is a dated audit trail of every bundle
jump with its cause. The AGENTS bar — *"someone reading the diff in a year can tell why, not just
what"* — is being met, consistently, by more than one agent.

### 2.5 Escalation happened instead of guessing

`SANDBOX-FEEDBACK-01.md` is the model: an environment problem that blocked a named acceptance
criterion (P0-I-3) was diagnosed to the mount level, written up with a reproduction, escalated,
and then **updated in place** when the platform fixed it. The tempting workaround — rewriting
`docker-compose.dev.yml` so it "worked here" — was explicitly identified and refused, because it
would have made the product file lie. That instinct is the whole game.

### 2.6 Real humans were in the loop where the plan demanded it

Phase 1's Definition of Done says *"Verify this with an actual person, not an assumption."* The
final commits on `main` (`902eef8`, `18aaf8a`) tick that gate only after a human actually drove the
app. The temptation to self-certify a human-verification criterion is enormous. It was resisted.

---

## 3. Friction points

Ordered by how much they will cost if left alone. None of these are crises; §3.1 and §3.4 are the
two worth acting on before Phase 2 code starts.

### 3.1 The benchmark regression gate is materially weaker than the documentation claims — **high** · **decided 2026-09-11**

`AGENTS.md` §8, `CLAUDE.md` and `planning/README.md` §3.6 previously stated that benchmarks fail
the build on a **>10% regression**. In the committed suite, **10 of 16 cases carry
`baselineGate: false`**, which switches that check off:

| Regression-gated (6) | Gate off (10) |
|---|---|
| `client-js-gzip`, `cold-load-recorded`, `conway-512-soup`, `conway-4096-1pct`, `paint-1m`, `grid-1m-memory` | `render-frame-cpu`, `main-thread-block`, `default-theme-render-frame`, `default-theme-palette-lookup`, `snapshot-restore`, `seek-4000`, `stats-overhead`, `paint-stroke-latency-p95`, `pan-1000pxs-1080p`, `zoom-32-0.5-32-min-fps` |

Two cases — `default-theme-palette-lookup` and `snapshot-restore` — have **neither** a baseline gate
**nor** an absolute budget. They are measured, recorded, and gate nothing. `cold-load-recorded` is a
constant transcribed from an earlier Playwright run ("recorded … not re-timed"), so the 1500 ms
cold-load budget is not re-measured by `npm run bench` at all.

Every individual decision here was defensible and was documented at the time: a 10% band around a
sub-millisecond timer *is* noise, and the CPU-side `CanvasRecorder` frame timings genuinely cannot
speak for GPU raster. The problem is the aggregate. The pressure valve for "this number is noisy"
has been "turn the gate off", and it has been pulled ten times in two phases. **Phase 5 is the
phase where every optimisation is validated against a benchmark.** If the trend continues, Phase 5
starts with a regression gate that covers the bundle size and two engine kernels.

There is also a measurement-provenance problem underneath it: `bench-baseline.json` was recorded on
Node **v24.20.0** on an 8-CPU/63 GiB sandbox, while the CI `bench` job runs Node **22** on a
GitHub-hosted runner. The baseline being compared against was never produced by the machine doing
the comparing. `SANDBOX-FEEDBACK-01` §6.1 flagged this skew on 2026-09-03; it was never closed.

**Decision (operator + team, 2026-09-11): fix it, and soften the claim in the meantime.**

The root mistake was holding three kinds of number to one policy. Split them:

| Class | Examples | Policy |
|---|---|---|
| **Deterministic** | `client-js-gzip`, `grid-1m-memory` | Tight gate, **2–3%**. No noise excuse. |
| **Wall-clock CPU** | `conway-512-soup`, `paint-1m`, `snapshot-restore`, `seek-4000`, … | Noise-aware gate on a **calibration ratio** (same-process fixed synthetic workload; raw ms still printed). Dissolves the Node-24-vs-22 provenance problem without per-runner baselines. |
| **Browser / GPU / paint** | `render-frame-cpu`, `pan-1000pxs-1080p`, `zoom-32-0.5-32-min-fps`, … | Absolute budget only, plus **gate-history** from §3.2 when that mechanism exists. |

Every case lands in exactly one class. **No** `baselineGate: false`. Every case gets a budget or a
gate, or is deleted. Rename `cold-load-recorded` so its transcribed nature is visible in output.

**Lands in:** `planning/README.md` §3.6 (binding + interim honesty), ADR-004 amendment,
softened AGENTS/CLAUDE/INCEPTION/`.cursor/rules/030-testing-and-gates.mdc`, Phase 2 task
**P2-F-1** (implementation — not this pass). Phase 5 prerequisites now name P2-F-1.
Gate-history for the browser class remains the §3.2 / action #13 item (before Phase 3).

### 3.2 Criteria that cannot be proven inside the task that owns them — **medium**

Two Phase 1 criteria ask for evidence that only accumulates over time:

- P1-H-1: *"non-flaky over 10 consecutive CI runs"* — closed with 10 consecutive **local** repeats
  plus an honest note that the literal criterion cannot be performed in-task.
- P1-H-2: *"stable across three consecutive CI runs"* — same treatment.

Both notes are scrupulously honest, and there was no better answer available. But the criterion as
written is unmeetable by construction, and Phase 3 multiplies the visual baseline by six themes,
which is precisely when flake history starts to matter.

**Proposal:** add a scheduled (nightly) workflow that re-runs the e2e and visual suites N times and
records the result, and introduce a documented **"gate-history"** criterion class in
`planning/README.md` §3 — criteria discharged by an accumulating CI record rather than by the task,
with a named place the record lives. Phase 3's `P3-D-2` inherits the problem; give it the mechanism
first.

### 3.3 A 37,000-line committed snapshot — **medium**

`tests/integration/__snapshots__/canvas-bridge.spec.ts.snap` is a single 37,092-line snapshot of
the full draw-call log for 100 generations of a Gosper gun. It is a genuinely good test — it is the
inception document's "Canvas Bridge" — but a human cannot review a diff in it. When it changes, the
only available responses are "accept the new snapshot" or "revert the change", which is exactly the
re-baselining reflex `AGENTS.md` §9 forbids.

**Proposal:** keep the test, change the assertion shape — assert a stable digest of the call log
plus a set of named invariants (call counts by method, dirty-rect coverage, the painted-cell set at
generations 0/1/4/100), and keep a *short* readable snapshot of the first N calls. A reviewer can
then tell *what* changed. Cheap to do while there is one such snapshot; expensive after Phase 3 and
Phase 5 add renderers.

### 3.4 Boundary-forced duplication has no policy, and Phase 2 walks straight into it — **medium** · **decided 2026-09-11**

ADR-009 forbids `ui/ → engine/`. Two pure modules have therefore been hand-duplicated into `ui/`,
each with a comment explaining why:

- `src/ui/tools/brush.ts` — a second Mulberry32, duplicating `engine/rng.ts`.
- `src/ui/tools/select.ts` — a minimal RLE codec (states 0–24, no headers), duplicating what
  `engine/patterns/rle.ts` will be.

P2-A-1 already named this and demanded a decision ("pick one and record which"). It needed to be
decided **before** P2-A-1 starts, because P2-A-4 (normalisation), P2-B-3 (library panel), P2-D-4
(RLE export) and P4-A-1 (the fuzzy scorer shared with P2-B-3) all sit on the same seam.

**Decision (operator + team, 2026-09-11):** adopt the pure-logic lane. Reject `ui/ → engine/` for
"pure" modules (not machine-checkable; decays). Empirically, every file under `src/shared/**` is
already clean under the engine forbidden-globals scan (ran 2026-09-11 via
`scanForbiddenGlobals` — 5 files, 0 hits), so the simpler rule wins: **`shared/` is pure, full
stop** — no `shared/lib/` subdirectory unless a future module needs an impurity (then keep the
exception *outside* `shared/`, or carve a pure sub-lane then). The matrix already lets every
consumer layer import `shared/`; the change is (1) widen `engine → shared/types` to
`engine → shared/` (matching `docs/ARCHITECTURE.md`), and (2) extend the forbidden-globals scan
to `shared/**`. When RLE lands in `shared/rle.ts`, keep it **purely syntactic** (coordinates +
raw state numbers; no ruleset/alphabet knowledge). Delete the brush/select duplicates rather than
documenting them as permanent.

**Lands in:** ADR-009 amendment, `planning/README.md` §3.1, AGENTS.md §2.2, `docs/ARCHITECTURE.md`,
`.cursor/rules/020-engine-purity.mdc`, **P2-A-1** acceptance criteria. Checker/code moves deferred
to P2-A-1.

### 3.5 Coverage thresholds have drifted far below reality — **medium**

Thresholds may be raised and never lowered (`README` §3.5), but they have never been raised:

| Path | Threshold | Actual | Slack |
|---|---|---|---|
| `src/ui/**` | 70% | **97.9%** | 28 points |
| `src/themes/**` | 70% | 93.2% | 23 |
| `src/render/**` | 85% | 98.6% | 14 |
| `src/server/**` | 85% | 97.4% | 12 |
| `src/engine/**` | 95% | 99.1% | 4 |
| `src/worker/**` | **none** | 97.7% | — |
| `src/client/**` | **excluded from collection entirely** | — | — |

Phase 2 adds three panels, a chart module and a rule editor to `src/ui/**`. With 28 points of slack,
several thousand untested UI lines can land and CI stays green. The gate is currently ratifying a
standard the team is already beating by a wide margin — which means it will not catch the phase
where the standard slips.

Two structural gaps sit alongside it: **`src/worker/**` has no threshold at all** (it is the
protocol boundary — ADR-006's whole point), and **`src/client/**` is excluded from coverage**, which
means `main.ts` — 1,049 lines, the composition root, where integration bugs actually live — is
measured by nothing but Playwright.

**Proposal:** make "ratchet the thresholds to a few points under measured actuals" a line in every
phase's Definition of Done; add a `src/worker/**` threshold now (it would pass today at 95/90/95);
and either bring `src/client/**` under a threshold or decompose `main.ts` (see §3.6) so the parts
worth testing live somewhere that is measured.

### 3.6 `main.ts` is becoming the place where everything meets — **medium, and it compounds**

1,049 lines, 57% of `src/client/`, untested by unit tests and excluded from coverage. It is
*extremely* well documented, and its growth is honest — every Phase 1 task legitimately closed a
seam there. But Phase 2 adds three panels, a chart host, an export path and the studio's live-apply
plumbing, all of which have exactly one natural home today.

Related: Phase 1 shipped 20,445 insertions against **193 deletions**, and the whole repo has **3
`refactor` commits**. No consolidation pass has ever happened. That is a reasonable outcome for two
phases of greenfield work, and it is not sustainable through four more.

**Proposal:** budget one explicit `refactor(ui)` task in Phase 2 (a new ID appended to a workstream
— never inserted, never renumbering an existing one) that extracts the composition root into
testable wiring modules, landing *before* the panels do. `AGENTS.md` §7 already forbids mixing a
refactor with a feature; give the refactor its own task so it is not forced to.

### 3.7 Bookkeeping is a large and growing fraction of the work — **low** · **decided 2026-09-11**

54 of 136 commits (**40%**) are `docs`, 46 of them `docs(planning)`. `CHANGELOG.md` is **62 KB / 727
lines** after two phases; individual entries run to eight-line paragraphs of design rationale.

This is not waste — this repo *is* an open agentic coding experiment, and the reasoning trail is
part of the artefact. But extrapolated, the changelog is ~200 KB at `1.0.0`, and rule 6 forbids
retroactive editing, so the only moment to change the shape is at a phase boundary. It is also
worth noticing that the rationale is currently written **three times**: in the module doc comment,
in the phase-doc acceptance note, and in the changelog entry.

**Decision (operator + team, 2026-09-11):** trim it, and declare the trim. Size is not the
problem; triple-written rationale is. From the **`v0.3.0` / Phase 2 boundary** onward:

- `CHANGELOG.md` entry = user-visible statement + task ID.
- Phase doc keeps acceptance-level reasoning (checkbox-gated).
- Module comment / commit body keeps the code-level *why*.
- One line per phase release section points at the phase doc (reasoning in one hop).

Keep-a-Changelog stays user-facing; design rationale was never its job. The open-agentic value
survives because phase docs and commit bodies were always the durable record. **Do not touch
existing `[0.1.0]` / `[0.2.0]` entries.**

**Lands in:** `AGENTS.md` §2.6 (explicit choice), `planning/README.md` §3.4, CLAUDE/CONTRIBUTING,
Phase 2 DoD, P6-G-1 notes. No rewrite of `CHANGELOG.md` in this pass.

### 3.8 Small, concrete inaccuracies — **low**

| Where | Issue |
|---|---|
| `build-dashboard.mjs` | Synthesises the next branch name from the phase-doc **title**, producing `phase/2-the-library-and-the-stat-engine`. `AGENTS.md` §6 and `CLAUDE.md` both mandate `phase/2-library-and-stats`. It would have mis-named Phase 1's branch too. The generator should read the branch names from the §6 table rather than inventing them. |
| `AGENTS.md` §1, `CLAUDE.md` | State "470 acceptance criteria". The generator counts **471** (relocations added one). Better: stop restating a number the generator owns, and point at the dashboard. |
| `PHASE_0_FOUNDATION.md` §6 | The Phase 0 DoD line *"All Phase 0 quality gates green in CI on `main`"* is still `- [ ]`, with the note "the first Actions run is the merge to `main`". That merge has since happened and run 34199267453 was green. The box can be ticked with the run URL; leaving it open makes a completed phase read as incomplete. |
| repo root | **There is no `LICENSE` file** and no `license` field in `package.json`. **Decided 2026-09-11** (MIT code + per-item pattern content — see §5.3 / §9 Q1). Implementation lands with P2-B-1; planning is in `planning/README.md` §3.9. |

---

## 4. Opportunities

1. **The token lint is a template.** `no-literal-design-tokens` is the single highest-leverage
   thing built in Phase 1: it makes a Phase 3 problem impossible in Phase 2 code, automatically.
   The same trick applies to at least two other future problems — a minimum-width contract for
   panels (Phase 6's responsive work) and an axe assertion per panel (Phase 6's a11y audit). Both
   are cheap now and archaeology later. See §5.4 and §6.3.
2. **Phase 2 contains the project's actual thesis.** The phase-space plot, the "randomise rule"
   button with constraint sliders, and the animated library thumbnails are the features that make
   this a toy someone shows a friend. They are also the ones that look cuttable when a phase runs
   long. They are not decoration; they are the deliverable. Worth stating in the Phase 2 header so
   nobody has to re-derive it at 2 a.m.
3. **The demo capture is already a pipeline.** `scripts/capture-phase1-demo.mjs` exists. Phase 6's
   `P6-F-1` plans a general capture pipeline. Generalising it during Phase 2 (rather than writing a
   third one-off) costs almost nothing and pays for four more phases of demo assets.
4. **The stat engine can pay for the Laboratory early.** P2-C-3's Zobrist hashing plus P2-C-4's
   growth classifier are 80% of P4-D-4's divergence metrics. Designing the stat API with two
   simulations in mind (an instance-scoped collector, not a singleton) costs nothing in Phase 2 and
   removes a rewrite in Phase 4.
5. **Two phases of evidence say the estimates are good.** 64 tasks in 7 days with zero blocked
   tasks and zero rework is a strong base rate. The plan does not need re-scoping; it needs the
   half-dozen contract decisions in §5 made before the code starts.

---

## 5. Trajectory review — Phase 2, before the branch is cut

Phase 2 is **28 tasks** after the 2026-09-11 planning append (catalogue split, statsWindow,
panel host, composition refactor, bench/gate-history/snapshot tasks). All Phase 0–1 retro
operator questions are closed; remaining work is implementation on `phase/2-library-and-stats`.

### 5.1 There is no way for the UI to read the stat series — an ADR-006 gap

`src/shared/protocol.ts` declares `{ type: 'stats'; series: StatSample }` and **nothing ever emits
it** (`worker/client.ts` line 122: *"no Phase 0 consumer yet"*). More importantly, Phase 2 §2.2's
`Series.window(fromTick, toTick, maxPoints)` — the LTTB-downsampled read that every chart depends
on — has **no command in the protocol**. `TickStats` rides along on each `frame`, which covers the
status bar, but not the charts.

That leaves P2-D-1 with three options, two of which are bad: mirror the tiered `Series` on the main
thread (duplicating engine logic into `ui/`, straight into §3.4's problem), stream every sample and
re-aggregate in the UI (defeats the tiering), or add the query to the protocol.

**Proposal:** amend ADR-006 with a `statsWindow` command and its reply *before* P2-C-5 and P2-D-1
run — the same treatment ADR-006 got for `restore` in P0-G-3. Assign it explicitly to P2-C-5 or a
new appended task, so the worker→main plumbing has an owner. Today it belongs to nobody: P2-C-1's
files are `src/engine/stats/*.ts` only.

### 5.2 Three panels land in Phase 2 and there is no panel framework task

P2-B-3 (library), P2-D-3 (statistics) and P2-E-1 (ruleset studio) each build a panel. P2-D-3's
implementation notes say panels are *"dockable/resizable/collapsible and remember their layout in
the session"* — a shared framework requirement, stated inside one task's notes and owned by none.
`shell.ts` provides an empty `panel-dock` region and nothing else. Without a framework task, the
first panel to land defines the contract by accident and the other two conform to it or diverge.

**Proposal:** append a panel-host task (new ID at the end of its workstream — never insert, never
renumber) covering the dock, focus management, resize/collapse, session-persisted layout, and the
`Escape`/focus-trap conventions `dialog.ts` already establishes. Make P2-B-3, P2-D-3 and P2-E-1
depend on it. This is also where §5.4's minimum-width contract and the per-panel axe assertion
naturally live — one task, three future phases de-risked.

### 5.3 The pattern catalogue is the highest-risk task in the project — licensing **decided 2026-09-11**

P2-B-1 asks for **≥200 attributed patterns across ≥10 rulesets**, each verified by simulation, each
licence-clean, with a complete `patterns/SOURCES.md`. It blocks P2-B-2, P2-B-3 and P2-B-4 — most of
a workstream sits behind one content task.

Today `patterns/` holds **10** files. They carry `#N`/`#O`/`#C` attribution but no `source` URL, so
they will need retrofitting to pass P2-B-1's own build-time check. The repository still has no
`LICENSE` file on disk — **that is intentional until P2-B-1 implements the scaffolding**; the
decision itself is no longer open.

**Decision (operator + team, 2026-09-11) — two layers, not one:**

1. **Code** (`src/`, `scripts/`, `tests/`, config): **MIT.** `"private": true` stays; add
   `"license": "MIT"` beside it. Apache-2.0 rejected (patent grant not needed; GPLv2 tradeoff
   irrelevant — we will not vendor Golly).
2. **Content** (`patterns/`): per-item provenance, per-item licence. Policy: **take facts, write
   your own words.** Cell layouts / discoverer / year / period / etc. are facts; library
   descriptions are original. Attribute generously (discoverer + year + source link; Credits
   dialog). Classes A/B/C allowlisted, D omitted. Gate:
   `scripts/check-pattern-licenses.mjs` in `verify` (REUSE-style SPDX in `#C` lines,
   `LICENSES/`, `NOTICE`, `patterns/SOURCES.md`).

**LifeWiki licence string (operator-read from site footer, 2026-09-11), verbatim:**

> All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available
> under the Creative Commons CC0 License; text in the other namespaces is available under the
> Creative Commons Attribution-ShareAlike License; additional terms may apply.

(Earlier draft of this retro asserted "CC BY-SA 3.0"; that version pin was unverified and is
**withdrawn**. Secondary sources mentioning GFDL may be stale MediaWiki `$wgRightsText`. The
facts-only approach avoids embedding wiki prose either way. Record the footer string in
`SOURCES.md` when P2-B-1 writes it.)

**Lands in:** `planning/README.md` §3.9 (binding), `PHASE_2_LIBRARY_AND_STATS.md` P2-B-1 / P2-B-3
acceptance criteria, `AGENTS.md` §9. **Not implemented in this retro pass** — no `LICENSE` file,
no checker script, until Phase 2 code starts.

**Still open from the original §5.3 proposal (see §9 Q5):** splitting P2-B-1 so a partial catalogue
unblocks P2-B-2/B-3 — sequencing, not licensing.

### 5.4 Phase 2 is the cheapest moment to pre-empt two Phase 6 problems

Phase 6 carries responsive layout (`P6-B-1`) and a WCAG 2.2 AA audit (`P6-C-1`) for the entire UI —
and Phases 2, 3 and 4 will roughly quadruple that UI's surface. Phase 1 already proved the pattern
that avoids this: it did not defer token discipline to Phase 3, it shipped a lint rule in Phase 1.

**Proposal:** two lines added to the Phase 2 panel-host task's acceptance criteria — every panel
declares and holds a minimum usable width, and every panel has an axe assertion in its spec —
convert two large Phase 6 retrofits into a habit. Phase 3's per-theme contrast gate then inherits
a clean starting point.

### 5.5 Phase 2 items that are already right — leave them alone

The anti-lying-chart requirements (min/max envelope bands mandatory for tiers ≥ 1, tier labelled on
every chart and in every export), the "insufficient-data" refusal in the growth classifier, the
visible sampling rate on entropy, and the zero-false-positive cycle-detection gate are the best
specified parts of the plan. They are the inception document's honesty rule made testable. No
changes proposed.

---

## 6. Trajectory review — Phases 3–6

The overall shape is sound: `powerful → fabulous → pro tool → enormous → real` still reads
correctly, ADR-003's split is holding, and no phase has been rendered obsolete by what Phases 0–1
actually built. The notes below are adjustments, not re-plans.

### 6.1 Phase 3 (Themes) — the visual-baseline load is the risk, not the shaders

`P3-D-2` extends visual regression to six themes. Whatever the Phase 1 baseline set costs to
maintain, Phase 3 multiplies by six *and* adds motion and post-processing — the two things
screenshot diffing is worst at. §3.2's flake-history mechanism and §3.3's snapshot-shape change
should both land before this phase, not during it.

Also worth pre-declaring: **`src/audio/**` has no coverage threshold** in `vitest.config.ts` (the
directory does not exist yet, and ADR-009's matrix already anticipates it). Add the threshold in
the task that creates the directory, or it will be the one layer nothing measures.

### 6.2 Phase 4 (Power UX) — well positioned; one dependency worth making explicit

`P4-A-1`'s fuzzy scorer is shared with `P2-B-3`'s library search — Phase 2 writes it first. The
Phase 2 task should be told it is writing the Phase 4 component (its home, its contract, its test
bar), rather than Phase 4 discovering a library-shaped matcher it has to generalise. One sentence
in P2-B-3's notes.

### 6.3 Phase 5 (Scale) — depends on P2-F-1 more than any other phase

Phase 5's non-negotiable constraint is *"nothing may change behaviour; every optimisation is
validated against the existing engine as an oracle"*, and its budgets tighten across the board. Both
of those cash out as benchmark and equivalence gates. **P2-F-1** (three-class gate + calibration)
is now an explicit Phase 5 prerequisite; §3.1 is decided. Keep `P5-D` (HashLife) explicitly
cuttable.

### 6.4 Phase 6 (Launch) — the biggest remaining unknown is mobile

19 tasks / 64 criteria, carrying production hardening, mobile, a11y certification, the browser
matrix, four documents, demo assets and release engineering. Of those, `P6-B-1`/`P6-B-2` (responsive
layout + touch) are the only ones whose size is genuinely unknown today, because they are sized by
however much UI Phases 2–4 produce. §5.4's per-panel minimum-width contract is the cheapest way to
keep that from becoming a phase-length retrofit.

The rest of Phase 6 is well specified and much of it (`P6-A-1` server hardening, `P6-E-*` docs) can
be pulled forward opportunistically if a phase runs short — `docs/ARCHITECTURE.md` and `README.md`
are already being kept current phase-by-phase, which is most of `P6-E-1`/`P6-E-4` done incrementally
and honestly.

---

## 7. Recommended actions

**All items below are done (planning) as of 2026-09-11.** Implementation waits for the named
Phase 2 / Phase 3 tasks on `phase/2-library-and-stats` (and later). Agents must not need this
retro to discover work — the phase docs, ADRs, and `planning/README.md` are the source of truth.

### Before cutting `phase/2-library-and-stats`

| # | Action | Lands in | Status |
|---|---|---|---|
| 1 | Pure-logic lane | ADR-009, README §3.1, **P2-A-1** | **done (planning)** |
| 2 | ADR-006 `statsWindow` + owning task | ADR-006 amendment, **P2-C-6**, P2-D-1 depends | **done (planning)** |
| 3 | Licence MIT + pattern provenance | README §3.9, P2-B-1/B-3 | **done (planning)** |
| 4 | Panel host + panel deps + min-width/axe | **P2-G-2**; B-3/D-3/E-1 depend | **done (planning)** |
| 5 | Three-class bench gate | README §3.6, **P2-F-1** | **done (planning)** |
| 6 | Dashboard branch table; Phase 0 DoD CI; stale totals | `build-dashboard.mjs` (`PHASE_BRANCHES`), PHASE_0 DoD ticked, AGENTS points at dashboard | **done (planning)** |

### During Phase 2 (task IDs appended — no renumbering)

| # | Action | Lands in | Status |
|---|---|---|---|
| 7 | Coverage ratchet + worker threshold + client decision | README §3.5, **P2-F-1** AC, **P2-G-1**, Phase 2 DoD | **done (planning)** |
| 8 | Composition-root refactor before panels | **P2-G-1** | **done (planning)** |
| 9 | Split catalogue so seed set unblocks library | **P2-B-1** (seed) + **P2-B-5** (completion) | **done (planning)** |
| 10 | Per-panel min-width + axe | **P2-G-2** AC | **done (planning)** |
| 11 | P2-B-3 writes P4-A-1's fuzzy matcher | P2-B-3 notes; P4-A-1 notes | **done (planning)** |
| 12 | Canvas-bridge snapshot → digest + invariants | **P2-F-2** | **done (planning)** |

### Before / into Phase 3

| # | Action | Lands in | Status |
|---|---|---|---|
| 13 | Gate-history class + nightly flake workflow | README §3.10, **P2-F-3**, P3-D-2 | **done (planning)** |
| 14 | `src/audio/**` coverage with the directory | README §3.5, **P3-B-1** AC | **done (planning)** |
| 15 | Changelog shape at `v0.3.0` | AGENTS §2.6, Phase 2 DoD, P6-G-1 | **done (planning)** |

---

## 8. What should not change

Course-correction has its own failure mode. These are working and should be left alone:

- **The phase-doc-as-tracker model.** 64 tasks, zero drift between the docs and the code, a
  generated dashboard that has never been hand-edited. It works.
- **The seven standing rules, unweakened.** Two runtime dependencies. Zero engine impurity. Zero
  suppressed lint. No gate has ever been lowered to go green.
- **The relocation discipline** (§2.1). It is the single behaviour most worth protecting.
- **The `- [-]` convention with a written reason and permanent IDs.** Every new task proposed above
  gets a **new** ID appended to its workstream. Nothing is inserted, nothing is renumbered.
- **Phase scope as written.** Nothing in §5 or §6 proposes removing a feature or lowering a bar.
  Phase 2's "wow" features are the deliverable, not the buffer.
- **The commentary standard in the source.** It is verbose and it is worth it.

---

## 9. Open questions for the operator

1. ~~**Licence.**~~ **Decided 2026-09-11** — see §5.3 / `planning/README.md` §3.9.
2. ~~**The benchmark gate.**~~ **Decided 2026-09-11** — see §3.1 / `planning/README.md` §3.6 / **P2-F-1**.
3. ~~**The pure-logic lane.**~~ **Decided 2026-09-11** — see §3.4 / ADR-009 / **P2-A-1**.
4. ~~**The changelog's shape.**~~ **Decided 2026-09-11** — see §3.7 / `AGENTS.md` §2.6.
5. ~~**Phase 2 sequencing.** Should the catalogue split (§5.3 remaining) and the panel host (§5.2) be
   added as new task IDs before the branch is cut, or handled as the first two tasks on the branch?~~
   **Decided 2026-09-11:** add the IDs on `main` before cutting the branch. Catalogue split =
   **P2-B-1** (seed) + **P2-B-5** (completion). Panel host = **P2-G-2** (after **P2-G-1**
   composition refactor). All other recommended actions also landed in planning (§7).

**No open operator questions remain from this retro.** Implementation proceeds from the phase
documents.

---

*Two phases in, on time, on the bar, with the gates real and the documentation honest. The work
below is calibration for the next four. Stay fancy.*
