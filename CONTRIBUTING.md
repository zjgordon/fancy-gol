# Contributing

fancy-gol is planned and built in the open — the full contract lives in
[`.agents/AGENTS.md`](./.agents/AGENTS.md). Read it before opening a PR; this file is
the short version.

## Getting set up

```bash
nvm use            # or install the Node version in .nvmrc
npm ci
npm run verify      # typecheck + lint + boundaries + test + build
```

`npm install`/`npm ci` wires `git config core.hooksPath .githooks` automatically via the
`prepare` script, which enables commit-message validation.

## Branching

`main` holds only the tested, stable output of a completed phase. Work happens on a
`phase/<n>-<name>` branch (see `.agents/AGENTS.md` §6) and merges back only when every gate
for that phase is green. Documentation-only changes under `.agents/**` may land on `main`
directly.

## Commits

Conventional Commits, enforced by `.githooks/commit-msg`:

```
type(scope): imperative subject, no trailing period, ≤72 chars
```

- Types: `feat` `fix` `perf` `refactor` `test` `docs` `build` `ci` `chore` `style` `revert`
- Scopes: `engine` `rules` `grid` `history` `worker` `render` `ui` `themes` `audio` `server`
  `docker` `bench` `planning` `agents`

Keep commits small and independently green — every commit on a phase branch should pass
`npm run verify` on its own.

## Before you open a PR

- [ ] `npm run verify` is green.
- [ ] Coverage gates hold (`npm run coverage`); thresholds may only be raised, never lowered.
- [ ] `npm run bench` shows no regression beyond 10%, if you touched a hot path.
- [ ] `CHANGELOG.md` is updated in the same commit as the change.
- [ ] `.agents/dashboard.html` is regenerated (`node .agents/scripts/build-dashboard.mjs`) if a
      task or acceptance criterion changed status.

## Non-negotiables

- No runtime dependency beyond `express` and `ws`.
- `src/engine/**` never touches the DOM, Node, or any I/O.
- Never weaken a coverage threshold, boundary rule, or performance budget to go green — fix
  the code, or escalate per `.agents/AGENTS.md` §10.

*Stay fancy.*
