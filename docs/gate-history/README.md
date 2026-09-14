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

`node scripts/gate-history.mjs cite visual-nonflake 3` exits 0 only when the
official streak is met. `--all-branches` is the debug view.

## Record ids

| id | Suite | Consumers |
|---|---|---|
| `e2e-nonflake` | Playwright functional (`chromium` + `firefox` + `webkit`) | P1-H-1 follow-up, any later "N consecutive e2e" criterion |
| `visual-nonflake` | Playwright visual (`--project=visual`) | **P3-D-2**, browser-class benches (absolute budget still gates in CI) |

A dedicated `browser-bench` id can be added when a nightly bench job exists.
Until then, browser-class cases keep their absolute budget in `npm run bench`
and inherit flake history from `visual-nonflake`.

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
