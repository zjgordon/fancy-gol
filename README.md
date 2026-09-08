# fancy-gol

*A cellular automata simulator with absolutely too much time spent on what's essentially a toy.
But this toy doesn't care, it wants to be fabulous!*

Phase 1 is usable: paint, pan, zoom, a real HUD, keyboard shortcuts, session restore, and an
optional `/live` broadcast. The engine still does not know the UI exists.

## Quick start

Needs **Node 22** (see `.nvmrc`; 20 is the floor).

```bash
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Draw a glider, scroll to zoom, drag to pan,
press `Space` to run. `?` opens the cheatsheet.

Production-shaped, one command:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Then [http://localhost:8080](http://localhost:8080).

## Right now

| You get | You don't (yet) |
|---|---|
| Paint, erase, shapes, stamp, select | Pattern catalogue UI |
| Pan, zoom, inertial coast | Six full themes (Default only) |
| Transport, speed, status, ruleset picker | Stats graphs, command palette |
| Undo/redo of *edits*, session autosave + share URL | Time-travel timeline |
| `/live` read-only broadcast (`ENABLE_LIVE`) | WebGL, mobile layout |
| Playwright e2e + visual baselines + interaction benches | — |

Touch covers pan, zoom, and paint only — a full mobile layout is Phase 6.

Honest status, ADRs, and the rest of the map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

| | |
|---|---|
| How it's put together | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Writing a ruleset by hand | [docs/ruleset-schema.md](docs/ruleset-schema.md) |
| Contributing, branches, the dashboard | [CONTRIBUTING.md](CONTRIBUTING.md) |
| What shipped | [CHANGELOG.md](CHANGELOG.md) |
| Phase 1 demo (draw / pan / zoom / run) | [docs/demo/phase-1.gif](docs/demo/phase-1.gif) |
| Phase 0 gun, captured | [docs/demo/phase-0.gif](docs/demo/phase-0.gif) |

This repo is also an **open agentic coding experiment**. The operating manual is
[`.agents/AGENTS.md`](.agents/AGENTS.md). Open [`.agents/dashboard.html`](.agents/dashboard.html)
in a browser to see where we are and what's next.

*Stay fancy.*
