# Architecture

Phase 0 ships a **pure engine** in a worker, a Canvas2D renderer on the main thread, and a thin
Express host. UI wraps the engine; the engine does not know the UI exists.

The binding decisions are [ADR-001…010](../.agents/planning/ARCHITECTURE_DECISIONS.md). This page
is the map; those pages are the law.

## Data flow

```
                 main thread                                worker thread
 ┌──────────────────────────────────────────┐   ┌──────────────────────────────────┐
 │ client/main.ts                           │   │ worker/sim.worker.ts             │
 │   rAF loop                               │   │   ┌────────────────────────────┐ │
 │     ├─ WorkerClient.postCommand() ───────┼──▶│   │ Simulation                 │ │
 │     │                                    │   │   │   ChunkedGrid              │ │
 │     └─ Renderer.draw(frame) ◀────────────┼───┼── │   CompiledRule             │ │
 │          Canvas2DRenderer                │   │   │   HistoryJournal           │ │
 │            dirty-rect + tile cache       │   │   │   StatsCollector           │ │
 └──────────────────────────────────────────┘   │   └────────────────────────────┘ │
        transferable ArrayBuffers (zero-copy)   └──────────────────────────────────┘

 tests/ drive the SAME protocol through an in-memory MessagePort pair — no browser required.
```

The server (`src/server/`) is a static host, a health endpoint, and (from Phase 1) a broadcast
relay. **It is not the simulator.** [ADR-002](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-002--the-server-is-a-static-host-an-asset-api-and-a-broadcast-relay-it-is-not-the-simulator).

## Layers

One package, hard internal boundaries, machine-enforced by `npm run boundaries`
([ADR-009](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-009--one-package-hard-internal-boundaries-machine-enforced)):

| Layer | May import from | Role |
|---|---|---|
| `src/engine/` | `engine/`, `shared/` | Simulation. No DOM, Node, or I/O. |
| `src/shared/` | `shared/` | Types and the worker wire protocol. |
| `src/worker/` | `engine/`, `shared/` | Worker entry, handler, main-thread client. |
| `src/render/` | `shared/` | Canvas2D + the headless recorder. |
| `src/client/` | not `server/` | The Phase 0 shell. |
| `src/server/` | `shared/` (and engine for validation later) | Express. |

`src/engine/**` is additionally banned from `window`, `document`, `navigator`, `localStorage`,
`fetch`, `console`, `process`, `performance`, and `Date`.

## ADRs

| | Decision |
|---|---|
| [ADR-001](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-001--the-engine-is-multi-state-from-commit-one) | Multi-state from commit one. Conway is the 2-state degenerate case. |
| [ADR-002](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-002--the-server-is-a-static-host-an-asset-api-and-a-broadcast-relay-it-is-not-the-simulator) | Server hosts and relays. It does not step the grid. |
| [ADR-003](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-003--seven-phases-each-independently-demoable) | Seven independently demoable phases. |
| [ADR-004](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-004--three-quality-gates-coverage-performance-and-visual-regression) | Coverage, performance, and (from Phase 1) visual regression. |
| [ADR-005](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-005--canvas2d-now-webgl2-in-phase-5-both-behind-one-renderer-interface) | Canvas2D now, WebGL2 in Phase 5, one `Renderer` interface. |
| [ADR-006](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-006--the-simulation-runs-in-a-web-worker-state-crosses-as-transferable-buffers) | Sim in a worker; state crosses as transferable buffers. |
| [ADR-007](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-007--history-is-a-hybrid-keyframe--delta-journal) | History is a hybrid keyframe + delta journal. |
| [ADR-008](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-008--themes-are-full-sensory-experiences-tokens--render-hooks--motion--sound) | Themes are tokens + render hooks + motion + sound (Phase 3). |
| [ADR-009](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-009--one-package-hard-internal-boundaries-machine-enforced) | One package, enforced layering. |
| [ADR-010](../.agents/planning/ARCHITECTURE_DECISIONS.md#adr-010--the-grid-is-a-sparse-map-of-dense-chunks) | Sparse map of dense 32×32 chunks. |

## Phase 0, honestly

Shipped as `0.1.0` on `phase/0-foundation`:

- 14-entry built-in catalogue, hand-written validator, B/S / Generations parsers, a compiler that
  turns Conway into an 18-byte LUT.
- ≥ 60 steps/sec on a 512² soup, ≥ 5 steps/sec on 4096² @ 1%, 1M live cells over 4096² in 32 MB.
  Gated by `npm run bench` against `bench-baseline.json`.
- Canvas2D with dirty rects; CPU/recorder frame time ≤ 16.6 ms at 1080p / 100k cells. The
  dpr 1-vs-2 *visual* identity test lives in Phase 1 (`P1-H-2`).
- Docker production image < 250 MB, non-root, healthy. Dev compose bind-mounts sources for HMR.

Not in this phase: paint, pan, zoom, themes, stats UI, WebSockets, a pattern library, keyboard
shortcuts. The page is a proof, not a product.

## Where the plan lives

The phase checklists, the dashboard, and the agent contract are in [`.agents/`](../.agents/AGENTS.md).
How to work in this repo: [CONTRIBUTING.md](../CONTRIBUTING.md).
