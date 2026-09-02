# fancy-gol

## Premise (Used for opener of root README.md)

A cellular automata simulator with absolutely too much time spent on what's essentially a toy. But this toy doesn't care, it wants to be fabulous!

> A full agentic coding experiment, all agent files in repo.

## Design Principles
1. **Engine first:** The simulation core is pure, tested, and dependency-free. UI wraps it, not the other way around.
2. **Performance by default:** Sparse hash-set for large grids; dirty-rect rendering; no re-render unless state changes.
3. **Composable rulesets:** Rules are data, not code branches; the engine takes a ruleset object.
4. **Delightful UX:** Smooth animations, keyboard shortcuts, snappy interactions, deep theme set with unique animations.
5. **Docker-first deployment:** Every milestone is container-runnable.


## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js (LTS) | Broad ecosystem, easy Docker packaging |
| Frontend | Vanilla TS + Canvas API | Maximum performance for grid rendering, zero framework overhead |
| Build | Vite | Fast HMR, clean ESM output |
| Server | Express | Minimal HTTP + WebSocket server for state sync |
| Real-time | WebSocket (ws) | Low-latency grid state streaming |
| Containerisation | Docker + Compose | Single-command deploy, reproducible env |
| Testing | Vitest | Co-located with Vite toolchain |


## Features
 - **Simple, intuitive, but powerful, modern user interface:** Controls where a child could pick up the basics, but a serious researcher would also have everything at their fingertips.
 - **Pro-grade tool set:** Play with gliders, make a gosper gun, sure... I remember the '90s. But also contains alternative rulesets, and catalogs of objects for each ruleset as applicable. Tweak parameters and create your own rulesets, go wild!
 - **Graphing and Statistics:** Do you like math? A full suite of graphs and statistical analysis tools across alive/dead/tends/etc! 
 - **Fun as HELL!:** This is a cellular automata simulator - there is no way that it should be this fun.

## Layout
### UX

 - Command Palette: A "Power User" mode to jump between brushes, rulesets, and view toggles.
 - Time-Traveler UI: A scrubbable timeline to inspect past states or "rewind" a dying civilization.
 - The "Laboratory" View: A split-screen mode to compare two different rulesets running on the same initial seed.
 - Hot-Key Mastery: Every major action should be mappable to a keyboard shortcut.

### Themes

 - Default: simple, grey, basic - the same as you'd expect on every linux distribution ever released. But very compatible and good for large grids.
 - Chiba-City: retro cyberpunk. Neon accents, scanline overlays, and high-contrast greens.
 - Flatline: retro console. Monochromatic, "falling" text effects on UI elements.
 - Sids-Place: CivI look. Gritty textures, parchment-style borders, and medieval-inspired palettes.
 - Void-Walker: Deep space. Deep purples, starlight textures, and soft glowing edges for "alive" cells.
 - Synthwave: 1980s aesthetic. Neon pinks, cyans, and a constant feeling of "the future as imagined in 1984."

### Goals

 - The "Infinite" Horizon: Support grid sizes that would crash a standard browser implementation of a 2D array.
 - Rule-God Status: Allow users to define complex, multi-neighbor, and non-binary states (e.g., "Highlands" or "Liquid" states) via a JSON-based definition.
 - Visual Poetry: Animation frames for state changes should feel fluid, not jittery.
 - The "Wow" Factor: When a user first opens the app, they should be struck by the fact that it's a "toy" that feels like a professional tool.

## Development Phases (Suggested)
### Phase 0: Foundational
 - Core Engine: Implementation of the Simulation class with pure math.
 - Data Layer: Development of the RuleSet schema and parser.
 - Canvas Bridge: A "headless" rendering test to ensure the engine can push state to a canvas buffer without overhead.
 - Basic Docker: A "Hello World" container that spins up the local dev server.

### Phase 1: Interaction & Visuals

 - The Interaction Loop: Implement click-to-paint, drag-to-draw, and "stamp" tools.
 - The Basic Theme: Implementation of the "Default" theme and core HUD.
 - State Sync: Initial WebSocket integration for basic state streaming.

### Phase 2: The Expansion

 - The Library: A curated list of "Objects" (Gliders, Pulsars, etc.) for various rulesets.
 - The Stat Engine: Real-time graphing of population density and "birth/death" rates.
 - Theme Engine: Implementation of the 5 advanced themes.

### Phase 3: The "Delight" Pass

 - Juice: Adding polish, smooth transitions between menus, and refined animations.
 - Optimization: Implementing the "Dirty Rect" and "Sparse Grid" logic for massive-scale simulation.
 - The Launch: Final polish of the "Overview" documentation and demo assets.

### Rules

 - No Bloat: If a library can be written in 50 lines of TS, don't import a package for it.
 - Pure Logic: The simulation logic must never know the UI exists.
 - Stay Fancy: If a feature is "boring," find a way to make it visually interesting.
 - Automated Proof: Every step must pass its Vitest suite before being considered "done."
 - Agit-Prop: If an agent produces code that is "just okay," demand it be "excellent."
 - Changelog: A changelog and semantic versioning from the beginning.
 - For this repository, agents are allowed to commit code, using conventional commit messages, and in a logical and parsed manner - conducive to development.


