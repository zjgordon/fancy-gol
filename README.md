# fancy-gol

*A cellular automata simulator with absolutely too much time spent on what's essentially a toy.
But this toy doesn't care, it wants to be fabulous!*

Phase 0 is in the can: a pure multi-state engine, a Canvas2D gun that actually fires, and a
container that serves it. Painting, pan, zoom, and the fun HUD arrive in Phase 1. Until then,
two buttons and a Gosper glider gun. That's the point.

## Quick start

Needs **Node 22** (see `.nvmrc`; 20 is the floor).

```bash
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The gun should already be running. Pause and
Reset are the whole UI.

Production-shaped, one command:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Then [http://localhost:8080](http://localhost:8080).

## Right now

| You get | You don't (yet) |
|---|---|
| Conway on a toroidal grid, in a worker | Click-to-paint, pan, zoom |
| Live tick / population / fps readout | Themes, stats graphs, a pattern library |
| `npm run verify` as the green bar | Playwright E2E (Phase 1) |

Honest status, ADRs, and the rest of the map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

| | |
|---|---|
| How it's put together | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Writing a ruleset by hand | [docs/ruleset-schema.md](docs/ruleset-schema.md) |
| Contributing, branches, the dashboard | [CONTRIBUTING.md](CONTRIBUTING.md) |
| What shipped | [CHANGELOG.md](CHANGELOG.md) |
| The gun, captured | [docs/demo/phase-0.gif](docs/demo/phase-0.gif) |

This repo is also an **open agentic coding experiment**. The operating manual is
[`.agents/AGENTS.md`](.agents/AGENTS.md). Open [`.agents/dashboard.html`](.agents/dashboard.html)
in a browser to see where we are and what's next.

*Stay fancy.*
