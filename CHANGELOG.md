# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository toolchain scaffold: `package.json` scripts (`dev`, `build`, `test`, `coverage`,
  `lint`, `typecheck`, `boundaries`, `verify`, …), strict TypeScript configuration, Vite +
  Vitest configuration with per-directory coverage thresholds, flat ESLint config with an
  engine-purity global ban, Prettier, and a hand-written Conventional Commits `commit-msg`
  hook. (P0-A-1, P0-A-2, P0-A-3, P0-A-4, P0-A-6)
- `scripts/check-boundaries.mjs` — hand-written layer-boundary checker enforcing the ADR-009
  dependency matrix and the `src/engine/**` global ban, with unit fixtures proving it catches
  cross-layer and forbidden-global violations. (P0-A-5)
- `src/engine/types.ts` — the engine's public type vocabulary (ADR-001): `StateId`, `StateDef`,
  `Neighborhood`, `TransitionSpec`, `RuleSet`, `ChangeSet`, `GridView`, `Snapshot`,
  `StateMigration`, and friends, pinned by compile-time `expectTypeOf` assertions. (P0-B-1)
- `src/engine/rng.ts` — a hand-written, deterministic Mulberry32 PRNG (`next`, `nextInt`,
  `fork`, `state`), verified deterministic across runs and uniform by a chi-square test.
  (P0-B-2)
- `src/engine/clock.ts` — an injectable `Clock` interface and `TestClock`, so the engine can
  measure its own step time without ever touching `performance` or `Date`. The boundary
  checker's forbidden-global list now also bans `Date` in `src/engine/**`, and no longer
  misfires on globals merely mentioned in a comment. (P0-B-3)
- `src/engine/grid/coords.ts` — chunk sizing, cell/chunk coordinate packing, and boundary-mode
  (`bounded`/`toroidal`/`infinite`) normalisation, with the `WORLD_LIMIT` (±1,048,576 cells)
  documented and enforced rather than silently exceeded. (P0-B-4)
- `src/engine/grid/chunk.ts` — a pooled, recyclable 32×32 `Chunk` maintaining its own
  population, per-state counts, and an 8-region border-occupancy mask incrementally, never by
  rescanning. (P0-C-1)
- `src/engine/grid/chunked-grid.ts` — the sparse `Map<number, Chunk>` grid: lazy chunk
  allocation, hysteresis-delayed empty-chunk reclamation, an `activeChunks` work-list, and a
  read-only `GridView` façade for the renderer and stats engine. (P0-C-2 — the 1M-live-cell
  memory budget is deferred to the `tests/bench` harness, P0-I-4, which doesn't exist yet.)
- `src/engine/neighborhood/**` — `Int8Array` offset tables for Moore, von Neumann, hex
  (row-parity-aware, verified symmetric), and validated custom neighbourhoods, compiled once
  per ruleset rather than per cell. `src/engine/rules/errors.ts` introduces the structured
  `RuleValidationError` a phase early, since custom-offset validation needs it and P0-D-2 will
  reuse it unchanged. (P0-C-3)

[Unreleased]: https://github.com/ZJGordon/fancy-gol/compare/main...HEAD
