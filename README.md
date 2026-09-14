# fancy-gol

*A cellular automata simulator with absolutely too much time spent on what's essentially a toy.
But this toy doesn't care, it wants to be fabulous!*

Phase 2 is powerful: a searchable pattern library, live statistics, and a Ruleset Studio on
top of the Phase 1 simulator. The engine still does not know the UI exists.

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
| Paint, erase, shapes, stamp, select, pan, zoom | Six full themes (Default only) |
| Pattern library (search, filter, stamp, drag) | Command palette |
| Statistics: simple numbers + advanced charts | Time-travel timeline |
| Ruleset Studio: author, test, save, share | Laboratory comparison |
| Undo/redo of *edits*, session autosave + share URL | WebGL, mobile layout |
| `/live` read-only broadcast (`ENABLE_LIVE`) | — |

Touch covers pan, zoom, and paint only — a full mobile layout is Phase 6.

Honest status, ADRs, and the rest of the map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

| | |
|---|---|
| How it's put together | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Writing a ruleset by hand | [docs/ruleset-schema.md](docs/ruleset-schema.md) |
| Contributing, branches, the dashboard | [CONTRIBUTING.md](CONTRIBUTING.md) |
| What shipped | [CHANGELOG.md](CHANGELOG.md) |
| Phase 2 demo (library / stats / studio) | [docs/demo/phase-2.gif](docs/demo/phase-2.gif) |
| Phase 1 demo (draw / pan / zoom / run) | [docs/demo/phase-1.gif](docs/demo/phase-1.gif) |
| Phase 0 gun, captured | [docs/demo/phase-0.gif](docs/demo/phase-0.gif) |

This repo is also an **open agentic coding experiment**. The operating manual is
[`.agents/AGENTS.md`](.agents/AGENTS.md). Open [`.agents/dashboard.html`](.agents/dashboard.html)
in a browser to see where we are and what's next.

*Stay fancy.*
