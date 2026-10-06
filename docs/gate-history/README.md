# Gate history

This directory is the **named home** of the gate-history criterion class
(`planning/README.md` §3.10, task **P2-F-3**).

Some acceptance criteria cannot be proven inside the task that owns them
("non-flaky over 10 consecutive CI runs", "stable across 3 CI runs"). Those
criteria cite this record instead of pretending to run N CI jobs in-process:

```
gate-history: e2e-nonflake ≥ 10 green
gate-history: visual-nonflake ≥ 3 green
```

## Where the record lives

| File | Role |
|---|---|
| [`records.jsonl`](./records.jsonl) | Source of truth. One JSON object per suite-sample. |
| [`INDEX.md`](./INDEX.md) | Generated summary (streaks + recent log). Do not hand-edit. |
| `.github/workflows/nightly-flake.yml` | Nightly cron on the default branch, plus `workflow_dispatch`. |
| `scripts/gate-history.mjs` | Append / summarize / cite. |

GitHub Actions artifacts (`gate-history-<run-id>`, 90-day retention) are the
backup if a commit-back fails. The cite always reads the committed jsonl.

## Official vs seed samples

**Official** streak (what a cite checks): samples on `main` whose `event` is
`schedule`, `push`, or `workflow_dispatch`.

A `workflow_dispatch` on a phase branch is a **seed** sample — it proves the
pipeline before the workflow file exists on `main`. It is in the log. It does
not increment the official streak.

GitHub 404s `workflow_dispatch` until the workflow file exists on the default
branch. Until merge, seed the log with `node scripts/gate-history.mjs append`
from a green CI run of the same Playwright projects (`event: push`). Do not
invent a `workflow_dispatch` event that did not happen.

`node scripts/gate-history.mjs cite visual-nonflake 3` exits 0 only when the
official streak is met. `--all-branches` is the debug view.

## Record ids

| id | Suite | Consumers |
|---|---|---|
| `e2e-nonflake` | Playwright functional (`chromium` + `firefox` + `webkit`) | P1-H-1 follow-up, any later "N consecutive e2e" criterion |
| `visual-nonflake` | Playwright visual (`--project=visual`) | **P3-D-2** (absolute budget for visual baselines still gates in CI) |
| `browser-bench` | Playwright per-theme frame rate (`--project=browser-bench`, 1080p, CDP 4× CPU throttle) | **P3-D-4** AC1/AC2 — the frame-rate criteria no Node harness can certify (ADR-011) |

Browser-class cases keep their absolute budget in `npm run bench`; `browser-bench` exists
because a *frame rate* cannot be measured there at all. Its samples are evidence, not a
gate: the quality-3 rows are red until post-processing moves to the GPU in Phase 5, and
the record is where that shows up nightly rather than being quietly dropped.

Run just that suite locally:

```
node scripts/gate-history.mjs sample --suites browser-bench --repeats 1 --event push --branch <name> --sha <hex>
node scripts/gate-history.mjs cite browser-bench 3
```

## How to cite from a task

In the phase doc, write the criterion as:

```
- [ ] Gate-history: `visual-nonflake` ≥ 3 green (`docs/gate-history/`).
```

Tick it only when `node scripts/gate-history.mjs cite visual-nonflake 3` is
green, or leave an honest interim note naming the current official streak.
Never silently tick "stable across N runs" from a single PR.

## Schema

Each `records.jsonl` line:

```json
{
  "v": 1,
  "id": "e2e-nonflake",
  "ok": true,
  "at": "2026-09-14T05:17:00.000Z",
  "event": "schedule",
  "branch": "main",
  "sha": "abc123…",
  "suite": "e2e",
  "runId": 34809043245,
  "runUrl": "https://github.com/zjgordon/fancy-gol/actions/runs/34809043245",
  "repeat": 1,
  "repeats": 1,
  "durationMs": 46000,
  "note": ""
}
```

## Visual baseline re-captures

A visual baseline is only re-captured after investigating why it changed, with the reason recorded
here (`AGENTS.md` §9).

### 2026-10-06 — P3-E-6: per-theme baselines re-captured with their effects

- **What changed:** 41 of the 48 `tests/visual/themes` baselines and the four Default chrome
  `shell` / `toolbar` shots (dark and light) in `tests/visual/chrome.spec.ts-snapshots`.
- **Why (themes):** the P3-D-2 baselines froze the themes *without* their effects. The post passes
  read an all-zero buffer on a real canvas and painted nothing (ADR-011 amendment), and Chiba-City
  and Flatline painted an opaque cell layer over their own backgrounds. P3-E-2 and P3-E-3 rebuilt
  the effects as composited passes and made those layers transparent, so the grids now show haze,
  scanlines, bloom, fringe, rain and ghosts. The other seven (the Themes panels for Default,
  Sid's Place, Void-Walker; Default's dialog and grids) are byte-identical.
- **Why (Default chrome):** stale since Phase 3 added a *Themes* entry to the toolbar (expected
  269×170, received 269×214 — a taller toolbar, not an environment difference).
- **Found while reviewing, fixed before capture:** the edge fringe added red and blue copies on top
  of the unmodified band, washing Synthwave's sides magenta. It now strips red and blue first
  (`5ecab57`).
- **How:** captured on the CI image (ubuntu-latest, Playwright's Chromium, DejaVu + Liberation
  fonts) from commit `5ecab57` by a throwaway workflow on a throwaway branch, then committed. Not
  captured locally, because the sandbox's Chromium revision differs from CI's.
- **Why the old baselines did not fail earlier:** `maxDiffPixelRatio: 0.001` with Playwright's
  default per-pixel colour threshold is blind to dark, low-contrast effects (haze, scanlines, grain)
  on a near-black frame; only a bright change (bloom, a washed edge) trips it. The baselines
  therefore guard layout and cell rendering; *effects are proven by `browser-floor` liveness*, not
  by these images.
- **Sample:** `visual-nonflake` green on run 37504998920 (phase branch, so a seed sample).
