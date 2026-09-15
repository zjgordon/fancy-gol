# Gate history

Generated 2026-09-15 by `scripts/gate-history.mjs`. Do not hand-edit.
Source of truth: [`records.jsonl`](./records.jsonl). Policy: `planning/README.md` §3.10.

A task cites this file instead of pretending to run N CI jobs in-process:

```
gate-history: visual-nonflake ≥ 3 green
```

**Official** streak counts only samples on `main` from `schedule`, `push`, or `workflow_dispatch`.
Phase-branch dispatch samples prove the mechanism; they do not count toward the cite.

## Official streaks

| record-id | official (main) | all-branches | last official |
|---|---:|---:|---|
| `e2e-nonflake` | 1 | 2 | green 2026-09-15 |
| `visual-nonflake` | 1 | 2 | green 2026-09-15 |

## Log (newest first)

| at | id | ok | branch | event | run |
|---|---|---|---|---|---|
| 2026-09-15T10:07:59.131Z | `visual-nonflake` | green | `main` | schedule | [34956155241](https://github.com/zjgordon/fancy-gol/actions/runs/34956155241) |
| 2026-09-15T10:07:51.186Z | `e2e-nonflake` | green | `main` | schedule | [34956155241](https://github.com/zjgordon/fancy-gol/actions/runs/34956155241) |
| 2026-09-14T20:58:29.978Z | `visual-nonflake` | green | `phase/2-library-and-stats` | push | [34895308935](https://github.com/zjgordon/fancy-gol/actions/runs/34895308935) |
| 2026-09-14T20:58:29.944Z | `e2e-nonflake` | green | `phase/2-library-and-stats` | push | [34895308935](https://github.com/zjgordon/fancy-gol/actions/runs/34895308935) |
