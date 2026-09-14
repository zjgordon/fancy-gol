# Architecture

Phase 2 ships a **powerful simulator**: the Phase 1 interaction layer plus a searchable pattern
library, a real-time stat engine with charts, and a Ruleset Studio. UI wraps the engine; the
engine does not know the UI exists.

The binding decisions are [ADR-001…010](../.agents/planning/ARCHITECTURE_DECISIONS.md). This page
is the map; those pages are the law.

## Data flow

```
                 main thread                                worker thread
 ┌──────────────────────────────────────────┐   ┌──────────────────────────────────┐
 │ client/main.ts                           │   │ worker/sim.worker.ts             │
 │   Camera + gestures + input router       │   │   ┌────────────────────────────┐ │
 │   ToolRegistry → CommandBus → EditStack  │   │   │ Simulation                 │ │
 │   WorkerClient.postCommand() ────────────┼──▶│   │   ChunkedGrid              │ │
 │   Renderer.draw(frame) ◀─────────────────┼───┼── │   CompiledRule             │ │
 │     Canvas2DRenderer                     │   │   │   HistoryJournal           │ │
 │     + grid-lines / selection overlays    │   │   │   StatsCollector           │ │
 └──────────────────────────────────────────┘   │   └────────────────────────────┘ │
        transferable ArrayBuffers (zero-copy)   └──────────────────────────────────┘

 server: static host + /api/{sessions,rulesets,patterns} + /live WebSocket hub
 tests/ drive the SAME worker protocol through an in-memory MessagePort pair.
```

**The server is not the simulator.** [ADR-002](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-002--the-server-is-a-static-host-an-asset-api-and-a-broadcast-relay-it-is-not-the-simulator).

## Layers

One package, hard internal boundaries, machine-enforced by `npm run boundaries`
([ADR-009](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-009--one-package-hard-internal-boundaries-machine-enforced)):

| Layer | May import from | Role |
|---|---|---|
| `src/engine/` | `engine/`, `shared/` | Simulation. No DOM, Node, or I/O. |
| `src/shared/` | `shared/` | Types, worker wire protocol, live/session codecs. |
| `src/worker/` | `engine/`, `shared/` | Worker entry, handler, main-thread client. |
| `src/render/` | `shared/` | Canvas2D + the headless recorder. |
| `src/ui/` | `shared/`, `render/types` | Camera, tools, commands, chrome components. |
| `src/themes/` | `shared/`, `render/types` | Default theme + token contract. |
| `src/client/` | not `server/` | Composition root (`main.ts`), harness, session, live client. |
| `src/server/` | `shared/` (and engine for validation) | Express + `/live` hub. |

`src/engine/**` is banned from `window`, `document`, `navigator`, `localStorage`,
`fetch`, `console`, `process`, `performance`, and `Date`. **`src/shared/**` carries the same
ban** (ADR-009 amendment 2026-09-11): it is the pure-logic lane every layer may import. No
`ui/ → engine/` escape hatch for "pure" modules.

## ADRs

| | Decision |
|---|---|
| [ADR-001](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-001--the-engine-is-multi-state-from-commit-one) | Multi-state from commit one. Conway is the 2-state degenerate case. |
| [ADR-002](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-002--the-server-is-a-static-host-an-asset-api-and-a-broadcast-relay-it-is-not-the-simulator) | Server hosts and relays. It does not step the grid. |
| [ADR-003](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-003--seven-phases-each-independently-demoable) | Seven independently demoable phases. |
| [ADR-004](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-004--three-quality-gates-coverage-performance-and-visual-regression) | Coverage, performance, and visual regression. |
| [ADR-005](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-005--canvas2d-now-webgl2-in-phase-5-both-behind-one-renderer-interface) | Canvas2D now, WebGL2 in Phase 5, one `Renderer` interface. |
| [ADR-006](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-006--the-simulation-runs-in-a-web-worker-state-crosses-as-transferable-buffers) | Sim in a worker; state crosses as transferable buffers. |
| [ADR-007](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-007--history-is-a-hybrid-keyframe--delta-journal) | History is a hybrid keyframe + delta journal. |
| [ADR-008](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-008--themes-are-full-sensory-experiences-tokens--render-hooks--motion--sound) | Themes are tokens + render hooks + motion + sound (Phase 3). |
| [ADR-009](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-009--one-package-hard-internal-boundaries-machine-enforced) | One package, enforced layering. |
| [ADR-010](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-010--the-grid-is-a-sparse-map-of-dense-chunks) | Sparse map of dense 32×32 chunks. |

## Phase 2, honestly

Ships as `0.3.0` on `main` (tag `v0.3.0`):

- Searchable, filterable library of ≥ 200 attributed patterns across ≥ 10 rulesets, with animated thumbnails and stamp-or-drag placement.
- Incremental stats (density, bbox, entropy, Zobrist cycles, growth class) graphed by a hand-written charting module.
- Ruleset Studio: B/S form + JSON, test bench, save / export / share-link apply.
- CSV/JSON/PNG/RLE export with downsampled series labelled as such.
- Panel host, composition root, classed bench gates, and `docs/gate-history/`.

Not in this phase: themes beyond Default, command palette, time-travel timeline, laboratory,
WebGL, full mobile layout. Those are Phases 3–6. See the [Phase 2 demo](demo/phase-2.gif).

## Phase 1, honestly

Shipped as `0.2.0` on `main` (tag `v0.2.0`):

- Brush / eraser / shapes / fill / select / stamp; camera with fractional zoom and inertia.
- Floating chrome (toolbar, transport, status, ruleset picker), Default light/dark tokens.
- Every action is a registered command with a binding (or an explicit `noBinding`).
- Edit undo/redo, `localStorage` autosave, shareable session URLs, `/live` read-only hub.
- Playwright on Chromium/Firefox/WebKit, visual baselines, interaction performance budgets.

See the [Phase 1 demo](demo/phase-1.gif).

## Phase 0

Shipped as `0.1.0`: pure multi-state engine, Canvas2D gun, Docker image, coverage and bench
gates. See the [Phase 0 demo](demo/phase-0.gif).

## Where the plan lives

The phase checklists, the dashboard, and the agent contract are in [`.agents/`](../.agents/AGENTS.md).
How to work in this repo: [CONTRIBUTING.md](../CONTRIBUTING.md).
