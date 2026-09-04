# Contributing

fancy-gol is planned and built in the open. The full contract is
[`.agents/AGENTS.md`](.agents/AGENTS.md). Read it before a PR; this file is the short version.

## Getting set up

```bash
nvm use                 # Node 22; 20 is the engines floor
npm ci
npm run verify          # typecheck + lint + boundaries + test + build
npm run dev             # Vite on :5173, Express on :8080
```

`npm ci` sets `core.hooksPath` to `.githooks` (Conventional Commits on every commit).

## What to open first

| Need | Open |
|---|---|
| **What is next** | [`.agents/dashboard.html`](.agents/dashboard.html) in a browser |
| The contract | [`.agents/AGENTS.md`](.agents/AGENTS.md) |
| The vision | [`.agents/docs/INCEPTION.md`](.agents/docs/INCEPTION.md) |
| Binding ADRs | [`.agents/planning/ARCHITECTURE_DECISIONS.md`](.agents/planning/ARCHITECTURE_DECISIONS.md) |
| The current checklist | [`.agents/planning/PHASE_0_FOUNDATION.md`](.agents/planning/PHASE_0_FOUNDATION.md) (then `PHASE_1_…` once Foundation is on `main`) |
| Architecture map | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

`.agents/` is the source of truth. The dashboard is **generated** — never hand-edit the
`PROJECT_STATE` block. After any checkbox change:

```bash
node .agents/scripts/build-dashboard.mjs          # rewrite dashboard.html
node .agents/scripts/build-dashboard.mjs --check  # CI: fail if stale
```

## The work loop

1. **Find** — dashboard “Next up”, or the first `- [ ]` in the phase doc whose `Depends on` list is fully `- [x]`.
2. **Claim** — `- [ ]` → `- [~]`, regenerate the dashboard, commit.
3. **Build** — implementation notes + the ADRs. Stay fancy.
4. **Prove** — named tests, tick a criterion only when it is measurably true, `npm run verify` (and `npm run bench` on a hot path).
5. **Close** — `- [x]`, `CHANGELOG.md`, regenerate the dashboard, commit together.

Markers: `- [ ]` not started · `- [~]` in progress · `- [x]` done · `- [!]` blocked · `- [-]` cut (with a reason). Never delete or renumber a task ID.

## Branching

`main` holds **only the tested, stable output of a completed phase.** Implementation lives on
`phase/<n>-<name>` and merges when that phase's gates are green, then is tagged.

| Phase | Branch | Tag |
|---|---|---|
| 0 | `phase/0-foundation` | `v0.1.0` |
| 1 | `phase/1-interaction` | `v0.2.0` |
| 2 | `phase/2-library-and-stats` | `v0.3.0` |
| 3 | `phase/3-theme-engine` | `v0.4.0` |
| 4 | `phase/4-power-ux` | `v0.5.0` |
| 5 | `phase/5-scale-and-perf` | `v0.6.0` |
| 6 | `phase/6-launch` | `v1.0.0` |

Documentation-only changes under `.agents/**` may land on `main`. Implementation code may not.

## Commits

```
type(scope): imperative subject, no trailing period, ≤72 chars
```

Types: `feat` `fix` `perf` `refactor` `test` `docs` `build` `ci` `chore` `style` `revert`.
Scopes: `engine` `rules` `grid` `history` `worker` `render` `ui` `themes` `audio` `server`
`docker` `bench` `planning` `agents`.

Small, independently green. Changelog in the **same** commit as the change. Reference the task
ID (`Closes P0-I-6.`).

## Before you open a PR

- [ ] `npm run verify` is green.
- [ ] Coverage holds (`npm run coverage`). Thresholds only go up.
- [ ] `npm run bench` shows no >10% regression if you touched a hot path.
- [ ] `CHANGELOG.md` updated in the same commit.
- [ ] Dashboard regenerated if a checkbox moved.

## Non-negotiables

- Runtime dependencies: `express` and `ws`. Nothing else without meeting the no-bloat bar.
- `src/engine/**` never touches the DOM, Node, or I/O.
- Never weaken a coverage threshold, boundary rule, or performance budget to go green.
- Never present an approximation as exact.

*Stay fancy.*
