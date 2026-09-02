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
- `src/engine/rules/schema.ts` and `docs/ruleset-schema.md` — the `RuleSetDocument` shape
  (a `RuleSet` plus a schema `version`) and a complete, human-readable field-by-field
  reference with a copy-pasteable worked example for every `transition` kind: Conway, Seeds,
  and Brian's Brain (`totalistic`), a Generations demo, WireWorld (`stateTable`, generated —
  262,144 entries is not something a human hand-writes), Highlands/Liquid (`weighted`, the
  inception document's own terrain example), and Langton's Ant (`turmite`). (P0-D-1)
- `src/engine/rules/validate.ts` — a hand-written (no `ajv`) `RuleSetDocument` validator: every
  check collected into one structured `RuleValidationError`, never stopping at the first
  failure, with a real JSON-pointer `path` and a `hint` on every issue. 43 negative fixtures in
  `tests/fixtures/rules/invalid/`. Fixed a real false positive in
  `scripts/check-boundaries.mjs`'s global scanner along the way: validator prose like `'a rule
  document must be...'` was tripping the `document` ban, because the scanner only stripped
  comments, not string/template literals, before matching. (P0-D-2)
- `src/engine/rules/parse.ts` — `parseRuleNotation`/`formatRuleNotation`: one entry point that
  sniffs B/S, legacy S/B, and Generations (both `B../S../G<n>` and Golly-order) notation, plus
  a trailing V/H neighbourhood suffix, and rejects Hensel/non-totalistic notation by name
  rather than mis-parsing it. 27 table-driven cases, each canonicalising idempotently. (P0-D-3)
- `src/engine/rules/compile.ts` — `compileRule` turns a `RuleSet` into a `CompiledRule`: `lut8`
  for 2-state Moore-r1 totalistic (Conway is an 18-byte table), `lutN` for other small
  totalistic/generations rules, `denseTable` for a `stateTable` that fits under 4 MiB
  (WireWorld's 256 KiB table), and a monomorphic `closure` for everything else. Cached on
  ruleset identity (`compileRule.cache.clear()` for tests). 50,000-input equivalence against
  the forced-closure reference for every worked example and every catalogue notation. (P0-D-4)
- `src/engine/rules/builtin/**` — the 14-entry built-in catalogue: nine Life-like rules, Brian's
  Brain, WireWorld (table generated, byte-identical to the schema fixture), Star Wars,
  Bloomerang, and Highlands/Liquid. Each validates, compiles, carries tags for Phase 2's
  library, and has a published behavioural oracle. Highlands/Liquid thresholds were retuned
  (`0–6 / 7–14 / 15–24`) so a land/water wall is stable and a documented soup bands within 200
  generations; the schema worked example matches. (P0-D-5)
- `src/engine/simulation.ts` — the step function. Active chunks only; per-chunk back pages so
  neighbours still see last tick's cells; Conway-class `lut8` via a 34×34 halo into an 18-byte
  table; `ChangeSet` arrays reused across ticks. ADR-004 oracles: R-pentomino → 1103 / 116,
  acorn → 5206 / 633, glider (1,1) in 4 gens. ≥ 60 steps/sec on a 512×512 50% soup. (P0-E-1)
- Boundary modes honoured at the world extent, not only at chunk seams: a page that straddles a
  `bounded` wall or a `toroidal` wrap fills its halo through `normalize`, so a 24×24 wall inside
  a 32×32 page still kills a glider (Conway ashes: a 2×2 block on that wall, never on the far
  side). A glider on a 32×32 torus returns to its starting cells at generation 128. A 10,000-
  generation infinite glider lands at (2500, 2500) without a trailing-chunk tax — empty pages
  behind it are reclaimed, and late-run throughput stays within 20% of generation 100. (P0-E-2)
- `Simulation.paint` / `clear` / `seedRandom` / `setRuleset`. Paint returns a step-shaped
  `ChangeSet` (same reused arrays) and writes 100,000 cells in one call in under 20 ms.
  `seedRandom(0.5, seed)` is reproducible on a 1024×1024 field and lands within ±0.5% of
  target density. Switching Conway → Brian's Brain without a `StateMigration` throws a
  message that names both palettes; Conway → HighLife (same dead/alive palette) does not.
  (P0-E-3)
- `Simulation.snapshot` / `restore` is a transferable, canonical capture: sorted chunk keys,
  concatenated 1024-byte pages, tick, and unsigned RNG state. Round-trips through
  `structuredClone` and a real `postMessage` transfer (sender buffers detach). Restore loads
  pages in bulk (`Chunk.load`) rather than per-cell `set`. Property: for five rulesets,
  snapshot → restore → 100 steps matches a twin that never left. A 1M-live 1024×1024 island
  in a 4096×4096 world serialises in < 100 ms and is ≥ 90% smaller than the dense world.
  (P0-E-4)
- Hybrid history journal (ADR-007): keyframe every K ticks (default 64) plus a copied
  per-tick delta, chunk-RLE keyframes that stay raw when soup would expand, a hard byte
  ceiling (default 256 MB), and oldest-keyframe-first eviction that emits an event.
  `Simulation.seek(t)` replays from the nearest keyframe; 200 random seeks match a twin
  that never left. Seeking back 4,000 ticks with K = 64 is < 250 ms. A 1M-cell chaotic
  payload run for 10,000 ticks stays under a configured ceiling and reports evictions.
  `truncateAfter` drops discarded deltas (`bytes` falls). History is off unless opted in.
  Node unit tests run sequentially so the 512² soup floor isn't racing other files.
  (P0-F-1)

[Unreleased]: https://github.com/ZJGordon/fancy-gol/compare/main...HEAD
