# Architecture Decisions

Binding decisions for fancy-gol. Every phase document implements these; no task may contradict one.
Amending an ADR requires: a new `## Amendment` block appended to it, the phases it invalidates listed
by task ID, and a `refactor(arch):` commit.

**Status key:** `ACCEPTED` — in force. `SUPERSEDED-BY-XXX` — historical.

---

## ADR-001 — The engine is multi-state from commit one

**Status:** ACCEPTED · **Affects:** Phase 0, all phases

### Decision
A cell is a `StateId` (an unsigned integer, `0` reserved for "dead"), not a boolean. Conway's Life is
the degenerate 2-state case, not the privileged one. The `RuleSet` declares its own state palette,
neighbourhood, and transition function.

### Contract
```ts
export type StateId = number;                 // 0 = dead/background, 1..N = live states
export const DEAD: StateId = 0;

export interface StateDef {
  readonly id: StateId;
  readonly name: string;                      // "alive", "dying", "electron-head", "highland"
  readonly kind: 'dead' | 'live' | 'decay' | 'inert';  // semantics for stats & rendering
  readonly countsAsAlive: boolean;            // does this state contribute to neighbour counts?
}

export type Neighborhood =
  | { kind: 'moore'; radius: number }                       // 8 @ r=1, 24 @ r=2
  | { kind: 'vonNeumann'; radius: number }                  // 4 @ r=1
  | { kind: 'hex' }                                         // 6, offset rows
  | { kind: 'custom'; offsets: ReadonlyArray<readonly [number, number]> };

export type TransitionSpec =
  | { kind: 'totalistic'; born: number[]; survive: number[]; decayStates?: number }
  | { kind: 'generations'; born: number[]; survive: number[]; states: number }
  | { kind: 'stateTable'; table: Uint8Array; radix: number } // compiled dense LUT
  | { kind: 'weighted'; weights: number[]; thresholds: TransitionRow[] }
  | { kind: 'turmite'; states: TurmiteRow[] };               // Langton-class, agent on grid

export interface RuleSet {
  readonly id: string;                        // "conway", "brians-brain", "user:my-rule"
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  readonly states: readonly StateDef[];
  readonly neighborhood: Neighborhood;
  readonly transition: TransitionSpec;
  readonly boundary: 'bounded' | 'toroidal' | 'infinite';
  readonly symmetry?: 'none' | 'rotational';  // hints for the compiler & pattern library
}
```

### Rationale
- `INCEPTION.md` asks explicitly for "complex, multi-neighbor, and non-binary states … via a JSON-based
  definition" ("Rule-God Status"). Retrofitting that onto a boolean core is a rewrite of the grid,
  the serialization format, the renderer, the stats engine and the history journal simultaneously.
- Multi-state costs ~1 byte/cell instead of 1 bit/cell, which the chunked sparse representation
  (ADR-010) absorbs. The lost bit-density is recovered for 2-state rules by the Phase 5 bitboard
  fast path (ADR-005 §fast paths) without changing the public API.
- It unlocks Brian's Brain, WireWorld, the Generations family, cyclic CA, and Langton-class turmites
  for free — that is the "Pro-grade tool set" the inception document demands, delivered in Phase 0.

### Consequences
- Neighbour counting is per-state, not a single popcount. The compiler mitigates this by emitting a
  dense lookup table for small state counts (see Phase 0, workstream D).
- Renderers must map `StateId → paint`, and themes must supply a palette per state (Phase 3).
- Serialization (RLE) needs the multi-state extension from day one, not later (Phase 2).

---

## ADR-002 — The server is a static host, an asset API, and a broadcast relay. It is not the simulator.

**Status:** ACCEPTED · **Affects:** Phase 0 (skeleton), Phase 1 (API v1), Phase 2 (persistence), Phase 6 (hardening)

### Decision
Simulation runs **entirely in the browser**, in a Web Worker (ADR-006). The Node/Express server:
1. serves the built client and its assets,
2. exposes a small JSON API for rulesets, patterns, and saved sessions,
3. runs one WebSocket endpoint, `/live`, that broadcasts a server-owned "attract mode" grid.

The server is never authoritative over a user's simulation. There is no multiplayer room model,
and no headless compute offload, in the 0.x–1.0 scope.

### Contract
```
GET    /api/health                 → { ok, version, uptime }
GET    /api/rulesets               → RuleSetSummary[]      (builtin + user)
GET    /api/rulesets/:id           → RuleSet
POST   /api/rulesets               ← RuleSet               → { id }        (validated server-side)
DELETE /api/rulesets/:id                                                   (user rulesets only)
GET    /api/patterns?ruleset=&q=&category=  → PatternSummary[]
GET    /api/patterns/:id           → { meta, rle }
POST   /api/sessions               ← SessionDoc            → { id, shareUrl }
GET    /api/sessions/:id           → SessionDoc
WS     /live                       → { type:'frame', tick, ruleset, delta } broadcast, read-only
```

### Rationale
Keeps the engine pure and offline-capable, keeps the critical path free of network latency, and still
uses the full declared stack (Express + `ws`) for something genuinely useful. Authoritative multiplayer
would make every Phase 1 interaction task a distributed-systems task and put reconciliation on the
critical path of a toy.

### Consequences
- The app must be fully functional with the server unreachable (built-in rulesets and a bundled
  starter pattern set ship in the client bundle). Network features degrade, they do not break.
- `/live` is one-way. Nothing a viewer does can affect it.
- Persistence is file-backed JSON on a mounted volume — no database. Phase 6 adds payload caps,
  rate limiting, and path-traversal defence.

---

## ADR-003 — Seven phases, each independently demoable

**Status:** ACCEPTED

### Decision
The inception document's four suggested phases are expanded to seven (0–6). The four remain the
spine; the overloaded ones are split so that each phase is a coherent, shippable slice with its own
demo and version bump.

| Inception phase | Becomes |
|---|---|
| Phase 0: Foundational | **Phase 0** — Foundation |
| Phase 1: Interaction & Visuals | **Phase 1** — Interaction & Visuals |
| Phase 2: The Expansion | **Phase 2** — Library & Stats · **Phase 3** — Theme Engine |
| Phase 3: The Delight Pass | **Phase 4** — Power UX · **Phase 5** — Scale & Perf · **Phase 6** — Launch |

### Rationale
Phase 2 as written would carry the pattern library, the full statistics suite, *and* five advanced
themes — three unrelated disciplines in one document. Phase 3 as written would carry the command
palette, the time machine, the laboratory, the sparse-grid rewrite, the WebGL renderer, and the launch.
Neither could be handed to an independent engineer as a single unit of work.

### Consequences
Every phase ends with something a person can be shown. That is the gate: if the phase has no demo,
it was scoped wrong.

---

## ADR-004 — Three quality gates: coverage, performance, and visual regression

**Status:** ACCEPTED · **Affects:** all phases

### Decision
CI enforces, on every push and PR:
1. **Vitest with coverage thresholds** (95% statements on `src/engine/**`), including
   *oracle tests* against known cellular-automata results.
2. **Performance benchmarks with committed budgets** — a >10% regression fails the build.
3. **Playwright E2E and screenshot visual regression** from Phase 1, with per-theme baselines
   from Phase 3.

Full release automation, container publishing and formal a11y auditing are **deferred to Phase 6**
rather than built in Phase 0. A minimal CI pipeline (typecheck, lint, boundaries, test, build,
docker build) exists from Phase 0 because the three gates above have to run somewhere.

### Oracle tests (what "correct" means)
The engine is verified against externally-known truths, not just against itself:
- A glider returns to its own shape, translated by (1,1), after exactly 4 generations.
- The R-pentomino stabilises at generation **1103** with **116** live cells.
- The acorn stabilises at generation **5206** with **633** live cells.
- A Gosper glider gun has period 30 and emits one glider per period; population is
  periodic-plus-linear.
- Blinker period 2; toad period 2; pulsar period 3; block/beehive/loaf/boat still.
- Brian's Brain, Seeds, Day&Night and WireWorld each have at least one published-behaviour fixture.
- Toroidal wrap: a glider crossing a 32×32 torus returns to its start after 128 generations.

### Consequences
Benchmarks must be deterministic and machine-tolerant: budgets are stated with headroom, the runner
takes the median of N runs, and CI compares against a committed baseline file rather than an absolute
wall-clock number where possible.

---

## ADR-005 — Canvas2D now, WebGL2 in Phase 5, both behind one `Renderer` interface

**Status:** ACCEPTED · **Affects:** Phase 0 (interface + Canvas2D), Phase 3 (effects), Phase 5 (WebGL2)

### Decision
Phases 0–4 ship a hand-optimised Canvas2D renderer. Phase 5 adds a WebGL2 renderer implementing the
identical interface, selected by capability probe with automatic fallback. No UI, theme, or engine
code may depend on which renderer is active.

### Contract
```ts
export interface Viewport {
  readonly originX: number; readonly originY: number;  // world coords of top-left, fractional
  readonly cellSize: number;                            // device px per cell, fractional
  readonly widthPx: number; readonly heightPx: number;
  readonly dpr: number;
}

export interface RenderFrame {
  readonly cells: GridView;          // read-only chunked view, no copy
  readonly dirty: ReadonlyArray<Rect> | null;  // null = full repaint
  readonly tick: number;
  readonly ageBuffer?: Uint16Array;  // ticks-since-change, for decay/glow effects
}

export interface Renderer {
  readonly kind: 'canvas2d' | 'webgl2';
  init(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  resize(widthPx: number, heightPx: number, dpr: number): void;
  setTheme(theme: CompiledTheme): void;
  setViewport(vp: Viewport): void;
  draw(frame: RenderFrame): void;
  readStats(): RenderStats;          // last frame ms, draw calls, tiles repainted
  dispose(): void;
}
```

### Fast paths and levels of detail
- `cellSize >= 4`: draw cells (rects/sprites/instances).
- `1 <= cellSize < 4`: draw from a pre-rasterised tile atlas.
- `cellSize < 1`: **density LOD** — draw a heat field from per-chunk population counts.
  This is what makes a 10⁸-cell grid displayable at all (Phase 5).

### Rationale
Canvas2D gets a real product into people's hands four phases earlier and is universally available.
But scanlines, bloom, chromatic aberration, starfields and phosphor decay across a million cells
(Phase 3 themes at Phase 5 scale) are shader work. Defining the interface in Phase 0 makes the
Phase 5 addition a new file, not a rewrite.

---

## ADR-006 — The simulation runs in a Web Worker, state crosses as transferable buffers

**Status:** ACCEPTED · **Affects:** Phase 0, Phase 5

### Decision
The engine lives in a dedicated Web Worker from Phase 0. The main thread does input, layout, and
rendering only. State crosses the boundary as transferable `ArrayBuffer`s (zero-copy), upgrading to
`SharedArrayBuffer` in Phase 5 where COOP/COEP headers permit.

### Contract
```ts
// main → worker
type Command =
  | { id: number; cmd: 'init'; ruleset: RuleSet; width: number; height: number; seed: number }
  | { id: number; cmd: 'setRuleset'; ruleset: RuleSet }
  | { id: number; cmd: 'step'; n: number }
  | { id: number; cmd: 'run'; tps: number }          // free-run at target ticks/sec
  | { id: number; cmd: 'pause' }
  | { id: number; cmd: 'paint'; ops: PaintOp[] }
  | { id: number; cmd: 'clear' }
  | { id: number; cmd: 'seedRandom'; density: number; seed: number }
  | { id: number; cmd: 'loadPattern'; rle: string; x: number; y: number }
  | { id: number; cmd: 'seek'; tick: number }        // time travel (Phase 4)
  | { id: number; cmd: 'snapshot' }
  | { id: number; cmd: 'setViewport'; vp: Viewport } // worker sends only visible chunks
  | { id: number; cmd: 'dispose' };

// worker → main
type Event =
  | { id: number; type: 'ready'; capabilities: WorkerCaps }
  | { type: 'frame'; tick: number; chunks: TransferredChunks; dirty: Rect[]; stats: TickStats }
  | { type: 'stats'; series: StatSample }
  | { id: number; type: 'ok'; result?: unknown }
  | { id: number; type: 'error'; message: string; code: string };
```

### Rationale
A 4096×4096 Conway step is tens of milliseconds. On the main thread that is dropped frames and a
frozen cursor while painting — the exact opposite of "Smooth animations, snappy interactions".
Defining the protocol in Phase 0 also gives the engine a *headless* driver for free: tests exercise
the same protocol through an in-memory port with no browser at all.

### Consequences
- All engine APIs are async from the UI's perspective; the UI keeps a local echo of painted cells so
  drawing feels instant before the worker confirms.
- The protocol is versioned (`PROTOCOL_VERSION`) and validated at the boundary.
- Rendering may move *into* the worker via `OffscreenCanvas` in Phase 5 with no protocol change.

---

## ADR-007 — History is a hybrid keyframe + delta journal

**Status:** ACCEPTED · **Affects:** Phase 0 (journal), Phase 2 (stats source), Phase 4 (Time-Traveler UI)

### Decision
The engine records a full compressed snapshot every `K` ticks (default 64, configurable) and a compact
changed-cell delta for every tick in between, in a ring buffer with a hard memory ceiling
(default 256 MB, configurable, with a visible budget meter in Phase 4).

```ts
interface Delta { tick: number; coords: Int32Array; /* packed x,y pairs */ from: Uint8Array; to: Uint8Array; }
interface Keyframe { tick: number; chunks: CompressedChunkSet; population: number; }

seek(t) = clone(nearestKeyframeAtOrBefore(t)) then applyDeltas(k.tick+1 … t)
```

### Rationale
- **Deterministic replay from seed alone** is near-free in memory but breaks the instant a ruleset uses
  the PRNG, breaks under user edits mid-run, and makes scrubbing to tick 900,000 take as long as it
  originally took to compute.
- **Full snapshots only** costs `gridBytes × depth`, which at Phase 5 scale is gigabytes.
- The hybrid gives O(K) reconstruction with bounded memory, survives stochastic rules and mid-run
  edits, and — critically — **the delta stream is already exactly the data the stat engine needs**
  (births, deaths, activity, per-state flux). One structure feeds three features.

### Consequences
- `Simulation.step()` must produce a `ChangeSet` as a first-class output, not a side effect. This is
  a Phase 0 requirement even though the Time-Traveler UI is Phase 4.
- Editing while scrubbed back **forks the timeline**: the journal truncates forward of the edit point
  and the UI surfaces this explicitly (Phase 4).
- Eviction policy is oldest-keyframe-first, and it is *reported*, never silent.

---

## ADR-008 — Themes are full sensory experiences: tokens + render hooks + motion + sound

**Status:** ACCEPTED · **Affects:** Phase 1 (token system), Phase 3 (the six themes)

### Decision
A theme is a module, not a stylesheet. It supplies:
1. **Design tokens** — CSS custom properties for all UI chrome (colour, type, spacing, radius, shadow).
2. **A cell palette** — `StateId → paint`, including age-based ramps.
3. **Render hooks** — optional background layer, per-cell draw override, and post-process overlay.
4. **A motion signature** — easing curves, durations, and enter/exit choreography for UI elements.
5. **A sound pack** — synthesised (not sampled) event cues and an optional ambient bed.

```ts
export interface ThemeModule {
  readonly id: ThemeId;
  readonly name: string;
  readonly tokens: TokenSet;                    // → CSS custom properties
  readonly palette: CellPalette;                // StateId → colour ramp by age
  readonly motion: MotionSignature;
  readonly sound?: SoundPack;
  drawBackground?(ctx: RenderCtx, vp: Viewport, tick: number): void;
  drawCellOverride?(ctx: RenderCtx, cell: CellDrawInfo): void;
  postProcess?(ctx: RenderCtx, vp: Viewport, tick: number): void;
  readonly shaders?: { vertex: string; fragment: string };   // Phase 5 WebGL2 path
  readonly cost: 'low' | 'medium' | 'high';     // drives auto-degrade
}
```

### Rationale
"Stay Fancy" and the six named themes in the inception document describe *atmospheres*
("falling text effects", "soft glowing edges", "gritty textures"), not colour swaps. A token-only
system cannot produce Flatline's phosphor decay or Void-Walker's bloom. Sound is what turns
Chiba-City from a palette into a place.

### Guard rails (mandatory, or this decision destroys the frame budget)
- Every theme declares a `cost`; the runtime measures actual frame time and **auto-degrades**
  (drops post-process, then background, then falls back to Default) with a visible, dismissible notice.
- Audio: **synthesised via WebAudio oscillators and noise buffers — zero audio assets in the bundle.**
  Starts muted, requires a user gesture, has a hard voice cap with stealing, and is fully silenced by
  `prefers-reduced-motion` or the mute control.
- Every theme must pass the same a11y contrast bar (README §3.7). "Fabulous" is not an excuse for
  unreadable.

---

## ADR-009 — One package, hard internal boundaries, machine-enforced

**Status:** ACCEPTED

### Decision
A single npm package with a single `node_modules`, not a monorepo. Layering is enforced by
`scripts/check-boundaries.mjs` (hand-written, ~80 lines, runs in CI) against this dependency matrix:

| Layer | May import from |
|---|---|
| `engine/` | `engine/`, `shared/types/` |
| `shared/` | `shared/` |
| `worker/` | `engine/`, `shared/` |
| `render/` | `shared/`, `themes/types` |
| `themes/` | `shared/`, `render/types`, `audio/types` |
| `audio/` | `shared/` |
| `ui/` | `shared/`, `render/types`, `themes/`, `audio/` |
| `client/` | everything except `server/` |
| `server/` | `engine/` (validation only), `shared/` |

Additionally, `engine/` is checked for forbidden global identifiers
(`window` `document` `navigator` `localStorage` `fetch` `console` `process` `require` `performance`).

### Rationale
Workspaces add build orchestration, version juggling and publish ceremony to a project that ships one
artifact. The value we actually want from a monorepo is *enforced layering*, and that is 80 lines of
TypeScript — exactly what the no-bloat rule tells us to write ourselves.

---

## ADR-010 — The grid is a sparse map of dense chunks

**Status:** ACCEPTED · **Affects:** Phase 0, Phase 5

### Decision
The world is divided into fixed **32×32 chunks**. A chunk is a `Uint8Array(1024)` of `StateId`s.
Chunks are stored in a `Map<number, Chunk>` keyed by a packed signed chunk coordinate. Empty chunks
are not allocated. An `activeChunks` set tracks chunks that changed last tick or border one that did.

```ts
const CHUNK_BITS = 5, CHUNK_SIZE = 32, CHUNK_AREA = 1024;
// key packs cx,cy as two signed 16-bit halves → one int32; world range ±1,048,576 cells
const key = (cx: number, cy: number): number => ((cx & 0xffff) << 16) | (cy & 0xffff);
```

Each chunk carries a cheap summary: `population`, `perStateCounts`, `dirty`, `lastTick`, and a
16-bit border-occupancy mask used to skip neighbour work at chunk edges.

### Rationale
- A flat 2D array of a 4096×4096 world is 16M cells even when 40,000 are alive — this is precisely the
  "would crash a standard browser implementation" case the inception document calls out.
- A pure hash-set of live coordinates has excellent memory but terrible cache behaviour and cannot
  represent multi-state or age data compactly.
- Chunking gives sparse memory *and* dense, cache-friendly, branch-predictable inner loops, *and*
  free per-chunk statistics, *and* the density LOD data the renderer needs when zoomed out,
  *and* a natural unit for dirty-rect invalidation and worker-pool partitioning later.

### Consequences
- Neighbour reads at chunk borders need a halo; the step function processes the 30×30 interior with a
  fast path and the border ring with a bounds-checked slow path.
- `bounded` and `toroidal` boundary modes are enforced at coordinate normalisation, not in the inner loop.
- "Infinite" is really ±1,048,576 cells per axis (2²¹ addressable ≈ 4.4 × 10¹² cells). This is
  documented as such — we do not claim what we do not do.
