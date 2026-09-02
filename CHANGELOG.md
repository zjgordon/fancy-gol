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

[Unreleased]: https://github.com/ZJGordon/fancy-gol/compare/main...HEAD
