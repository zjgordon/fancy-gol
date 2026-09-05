/**
 * P1-D-1 — the real composition root, replacing P0-I-1's minimal client shell. Several earlier
 * Phase 1 tasks left a seam explicitly pointed at "whichever task first assembles the full
 * client" or "P1-D-1's layout shell"; this file is that task closing them out:
 *  - a real `Camera` (P1-A-1) drives the viewport instead of the ad hoc math P0-I-1 wrote before
 *    it existed;
 *  - `attachGestures` (pan/zoom/inertia, P1-A-2) and `attachInputRouter` (tool strokes, P1-B-1)
 *    are composed onto the same canvas, resolving P1-B-1's own documented Space-drag seam (see
 *    `gatedToolHandlers` below);
 *  - `createAppContext`'s `onPaint` (P1-C-1) reaches a real `WorkerClient.paint()` for the first
 *    time;
 *  - the Phase 1 tool-select keybindings (P1-C-2) are attached to a real `CommandBus`;
 *  - `ui/components/shell.ts`'s floating chrome and cold-start choreography (P1-D-1) frame all
 *    of it.
 *
 * P1-D-2 adds the real transport bar and speed control: `AppContext.sim` (a `SimControl`, the
 * seam `ui/commands/registry.ts`'s own doc comment left for "a live worker client") is a plain
 * mutable-state object this file owns and mutates directly — `running`/`targetTps` as closure
 * variables, `actualTps` read live off a `TpsMeter` fed one `(tick, now)` sample per delivered
 * frame. `syncSimUI()` pushes that state into `transport.ts`/`speed.ts`'s `update()` both on
 * every frame (so `actualTps` stays live while running) and immediately after every transport
 * action (so the Play/Pause label flips the instant it's pressed, even though a paused sim then
 * delivers no further frames to hang an update off of).
 *
 * P1-D-3 adds the status bar, driven by its own `setInterval(STATUS_THROTTLE_MS)` — deliberately
 * *not* tied to `renderFrame`'s frame-delivery cadence, both because that would blow well past
 * the documented "10 Hz, not 60 Hz" budget while running, and because the cursor/zoom readouts
 * must keep updating even while paused, when no frames arrive at all. A lightweight
 * `pointermove`/`pointerleave` pair on the canvas (independent of `attachInputRouter`, which only
 * forwards moves *during* an active stroke — P1-B-1's own documented limitation) tracks the
 * latest cursor position cheaply; the throttled tick is what turns that into a render.
 *
 * P1-D-4 adds the ruleset picker. `ui/components/ruleset-picker.ts` cannot reach `engine/` or
 * `render/canvas2d` (ADR-009: `ui/` may only reach `render/types`), so it only creates each
 * entry's thumbnail `<canvas>` and reports open/close — this file is the one that actually owns
 * a `{Simulation, Canvas2DRenderer}` pair per catalogue entry, created fresh on open (a new
 * random soup each time the picker is opened) and disposed on close, so "thumbnails run only
 * while the picker is open" is a real resource lifecycle, not just a paused timer. Switching
 * ruleset sends `{cmd: 'setRuleset', ruleset, migration?}` — `migration` (an array, not a
 * function: functions aren't structured-clone-safe) only when the picker's own palette check
 * required the migration dialog. `activeRuleset` replaces the `CONWAY` constant everywhere it
 * used to be assumed fixed (the status bar's chips, `gunOps`' painted state, …).
 *
 * Deliberately NOT done here, recorded rather than silently skipped:
 *  - `EditStack`/`CommandBus.onUndoableRun` stay unwired. No `AppCommand` is `undoable: true`
 *    yet, and `edit.undo`/`edit.redo` aren't registered commands (their `bindings.ts` table
 *    entries stay silently skipped, exactly as `attachDefaultBindings` was designed to do).
 *    Wiring a real undo stack to live paint commits is genuine, separate scope.
 *  - `ToolContext.grid` (the fill tool's live-grid read) stays unwired — `ToolRegistry` has no
 *    constructor seam for it without widening `ToolRegistryOptions`, out of this task's file
 *    list. Both gaps are already recorded in `tool.ts`/`registry.ts`'s own doc comments.
 */
import { BUILTIN_RULESETS, CONWAY, getBuiltin } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { Canvas2DRenderer } from '@render/canvas2d';
import type { CompiledTheme, Viewport as RenderViewport } from '@render/types';
import { CHUNK_AREA, type PaintOp, type RuleSet, type StateId } from '@shared/types';
import { WorkerClient, type FrameEvent, type WorkerLike } from '@worker/client';
import { FrameGridMirror } from '@worker/frame-view';
import { Camera, EASE_OUT_CUBIC } from '@ui/camera';
import { attachGestures } from '@ui/input/gestures';
import { attachInputRouter, type ToolEvent, type ToolEventHandlers } from '@ui/input/router';
import { attachDefaultBindings } from '@ui/input/bindings';
import { attachKeymap, Keymap } from '@ui/input/keymap';
import { CommandBus } from '@ui/commands/bus';
import type { AppContext, SimControl } from '@ui/commands/registry';
import { SIM_COMMANDS } from '@ui/commands/builtin/sim';
import { attachShell } from '@ui/components/shell';
import { createTransportControls } from '@ui/components/transport';
import { createSpeedControl, TpsMeter } from '@ui/components/speed';
import { createStatusBar, STATUS_THROTTLE_MS, zoomPercent } from '@ui/components/statusbar';
import { attachRulesetPicker, type RulesetSummary } from '@ui/components/ruleset-picker';
import { createAppContext } from './app-context';

/**
 * `WorkerClient` targets the structural {@link WorkerLike} surface, not `Worker` itself, so it
 * stays testable without a browser (see `worker/client.ts`'s own doc). A real `Worker`'s
 * `onmessage`/`onerror` setters are typed against the DOM's richer `MessageEvent`/`ErrorEvent`,
 * which isn't structurally assignable to `WorkerLike`'s narrower `{ data: unknown }` shape — so
 * this adapts by forwarding through independent properties instead of handing the `Worker`
 * itself to `WorkerClient`.
 */
function toWorkerLike(worker: Worker): WorkerLike {
  const like: WorkerLike = {
    postMessage: (message, transfer) =>
      transfer ? worker.postMessage(message, [...transfer]) : worker.postMessage(message),
    onmessage: null,
    onerror: null,
    terminate: () => worker.terminate(),
  };
  worker.addEventListener('message', (event) => like.onmessage?.({ data: event.data }));
  worker.addEventListener('error', (event) => like.onerror?.(event));
  return like;
}

const WORLD_WIDTH = 256;
const WORLD_HEIGHT = 192;
const SEED = 0xc0ffee;
const RUN_TPS = 30;
/** The cold-start camera move's duration — the phase doc's own "~1.2 s" figure. */
const INTRO_CAMERA_MS = 1200;
/** Wide shot: the whole curated world, generously padded. */
const WIDE_SHOT_RECT = { x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT };
/** Framed: a tighter crop around the gun and the space its early gliders cross. */
const FRAMED_RECT = { x: -10, y: -10, width: 150, height: 115 };

/** LifeWiki's canonical Gosper glider gun RLE, decoded by hand: 36 live cells, x=0..35, y=0..8. */
const GOSPER_GUN: ReadonlyArray<readonly [number, number]> = [
  [24, 0],
  [22, 1],
  [24, 1],
  [12, 2],
  [13, 2],
  [20, 2],
  [21, 2],
  [34, 2],
  [35, 2],
  [11, 3],
  [15, 3],
  [20, 3],
  [21, 3],
  [34, 3],
  [35, 3],
  [0, 4],
  [1, 4],
  [10, 4],
  [16, 4],
  [20, 4],
  [21, 4],
  [0, 5],
  [1, 5],
  [10, 5],
  [14, 5],
  [16, 5],
  [17, 5],
  [22, 5],
  [24, 5],
  [10, 6],
  [16, 6],
  [24, 6],
  [11, 7],
  [15, 7],
  [12, 8],
  [13, 8],
];

/** Paints the curated gun in `state` (the *active ruleset's* primary live state, not always
 * literally `1`) — P1-D-4 can switch the active ruleset, and "Reset to seed" must still paint
 * something meaningful afterwards, not silently rely on Conway's own state numbering. */
function gunOps(originX: number, originY: number, state: StateId): PaintOp[] {
  return GOSPER_GUN.map(([x, y]) => ({ x: x + originX, y: y + originY, state }));
}

/** The state `gunOps`/`seedRandom` should paint as "alive" for a given ruleset — its first state
 * flagged `countsAsAlive`, falling back to `1` for the (contractually impossible, per `RuleSet`'s
 * own "at least one live state" expectation) case none is found. */
function primaryLiveState(rs: RuleSet): StateId {
  return rs.states.find((s) => s.countsAsAlive)?.id ?? 1;
}

/** A small fixed colour ramp, indexed by `StateId`, provisional pending P1-E-1's real per-theme
 * cell palette — state 0 is always background/dead; states 1+ cycle through the ramp so any
 * builtin ruleset's states (WireWorld's 4, Brian's Brain's 3, …) render visually distinct,
 * necessary since P1-D-4 lets the active ruleset change at runtime. */
const STATE_COLOR_RAMP: readonly string[] = ['#7cf9d0', '#ffb454', '#ff6b81', '#9d7cf9', '#5ed6ae', '#f9e27c'];

function paletteFor(state: StateId): string {
  if (state === 0) return '#05070a';
  return STATE_COLOR_RAMP[(state - 1) % STATE_COLOR_RAMP.length]!;
}

const THEME: CompiledTheme = {
  id: 'shell-default',
  background: '#05070a',
  palette: (state) => paletteFor(state),
};

/** The catalogue, as the plain data `ui/` is allowed to see (`RulesetSummary` — `ui/` cannot
 * import `engine/rules/builtin`'s own `BuiltinRuleSet` type either, ADR-009; `shared/types`'
 * `RuleSet`/`StateDef` are as close as it can get). */
const RULESET_SUMMARIES: readonly RulesetSummary[] = BUILTIN_RULESETS.map((rs) => ({
  id: rs.id,
  name: rs.name,
  ...(rs.description !== undefined ? { description: rs.description } : {}),
  ...(rs.notation !== undefined ? { notation: rs.notation } : {}),
  states: rs.states,
  tags: rs.tags,
}));

/**
 * Thumbnail world size and cadence. Measured, not assumed: stepping all 14 catalogue entries'
 * 32×32 `Simulation`s in the same frame costs ~2.9 ms combined (`ruleset-picker.spec.ts`'s own
 * perf test caught this) — a tiny grid's *fixed* per-step overhead (chunk bookkeeping, active-set
 * maintenance) dominates over its actual cell count, so "32×32 is tiny, therefore cheap" doesn't
 * hold once you multiply by 14. `THUMBNAIL_BATCH_SIZE` is the fix: each throttled tick steps only
 * a rotating subset, round-robin, so no single frame ever pays for more than
 * `THUMBNAIL_BATCH_SIZE` steps (~0.2 ms each, measured) — comfortably under the 2 ms/frame
 * combined budget (P1-D-4's own acceptance criterion) with real margin, not a near-miss. Every
 * thumbnail still gets a turn roughly every `ceil(14 / THUMBNAIL_BATCH_SIZE)` throttled ticks.
 */
const THUMBNAIL_WORLD_SIZE = 32;
const THUMBNAIL_CANVAS_PX = 48;
const THUMBNAIL_SEED_DENSITY = 0.3;
/** A throttled tick happens roughly twice a second — a calm preview, not a strobe. */
const THUMBNAIL_STEP_EVERY_N_FRAMES = 30;
/** How many thumbnails step on any single throttled tick. See the block comment above. */
const THUMBNAIL_BATCH_SIZE = 4;

const bootStart = performance.now();
// Exposed for tooling (P1-H-1's Playwright harness, once it exists, is the eventual real
// consumer — same interim substitution P0-I-1's own note already recorded for this exact field).
declare global {
  interface Window {
    __fancyGolFirstFrameMs?: number;
  }
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`client shell: missing required element "${selector}"`);
  return el;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function main(): void {
  const canvas = requireElement<HTMLCanvasElement>('#scene');

  const shell = attachShell({ root: document });

  const renderer = new Canvas2DRenderer();
  const mirror = new FrameGridMirror();
  const client = new WorkerClient({
    spawn: () => toWorkerLike(new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' })),
  });

  const camera = new Camera({ widthPx: window.innerWidth, heightPx: window.innerHeight });
  camera.fitTo(WIDE_SHOT_RECT, 40);
  // The target the cold-start choreography animates towards, computed once up front against a
  // scratch camera sharing the same viewport size — cheaper and clearer than mutating the live
  // camera to `fitTo` the framed rect and reading the result back before immediately un-fitting it.
  const framedTarget = (() => {
    const scratch = new Camera({ widthPx: camera.widthPx, heightPx: camera.heightPx });
    scratch.fitTo(FRAMED_RECT, 24);
    return { originX: scratch.originX, originY: scratch.originY, cellSize: scratch.cellSize };
  })();

  let hasFrame = false;
  let lastTick = 0;
  let lastPopulation = 0;
  let lastStepMicros = 0;
  let lastPerState: Uint32Array = new Uint32Array(CONWAY.states.length);
  let fps = 0;
  let lastFrameAt: number | null = null;
  let cursorWorld: { x: number; y: number } | null = null;
  /** The live ruleset (P1-D-4 can change this). Everywhere this file used to assume `CONWAY`
   * (the status bar's chips/cell lookup, the curated demo's painted state) reads this instead. */
  let activeRuleset: RuleSet = CONWAY;

  function toRenderViewport(): RenderViewport {
    const dpr = window.devicePixelRatio || 1;
    return {
      originX: camera.originX,
      originY: camera.originY,
      cellSize: camera.cellSize * dpr,
      widthPx: Math.max(1, Math.round(camera.widthPx * dpr)),
      heightPx: Math.max(1, Math.round(camera.heightPx * dpr)),
      dpr,
    };
  }

  function applyViewport(): void {
    const vp = toRenderViewport();
    renderer.resize(vp.widthPx, vp.heightPx, vp.dpr);
    renderer.setViewport(vp);
    if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
  }

  function renderFrame(frame: FrameEvent): void {
    mirror.applyChunks(frame.chunks);
    if (camera.dirty) {
      renderer.setViewport(toRenderViewport());
      camera.clearDirty();
    }
    renderer.draw({ cells: mirror.view(), dirty: frame.dirty, tick: frame.tick });
    hasFrame = true;
    lastTick = frame.tick;
    lastPopulation = frame.stats.population;
    lastStepMicros = frame.stats.stepMicros;
    lastPerState = frame.stats.perState;

    const now = performance.now();
    if (lastFrameAt !== null) {
      const instant = 1000 / Math.max(1, now - lastFrameAt);
      fps = fps === 0 ? instant : fps * 0.9 + instant * 0.1;
    }
    lastFrameAt = now;
    if (window.__fancyGolFirstFrameMs === undefined) {
      window.__fancyGolFirstFrameMs = now - bootStart;
    }
    tpsMeter.sample(frame.tick, now);
    syncSimUI();
  }

  // A continuous rAF loop redraws whenever the camera moves (pan/zoom/the intro tween) even
  // between worker frames — `WorkerClient.onFrame` only fires on a new simulation tick, which
  // would otherwise make panning while paused look frozen.
  function cameraRedrawLoop(): void {
    if (camera.dirty && hasFrame) {
      renderer.setViewport(toRenderViewport());
      renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
      camera.clearDirty();
    }
    requestAnimationFrame(cameraRedrawLoop);
  }

  const { context: toolContext, registry } = createAppContext({
    onPaint: (ops) => {
      void client.send({ cmd: 'paint', ops });
    },
  });
  for (const cmd of SIM_COMMANDS) registry.register(cmd);

  const tpsMeter = new TpsMeter();
  let simRunning = true;
  let targetTps = RUN_TPS;
  const simControl: SimControl = {
    get running() {
      return simRunning;
    },
    get targetTps() {
      return targetTps;
    },
    get actualTps() {
      return tpsMeter.actualTps;
    },
    toggleRun() {
      simRunning = !simRunning;
      tpsMeter.reset();
      void client.send(simRunning ? { cmd: 'run', tps: targetTps } : { cmd: 'pause' });
      syncSimUI();
    },
    step() {
      void client.send({ cmd: 'step', n: 1 });
    },
    reset() {
      void (async () => {
        await client.send({ cmd: 'clear' });
        mirror.reset();
        // `clear`'s frame reports an *empty* dirty list (nothing changed, from the worker's point
        // of view an empty world has nothing to describe) — not `null` ("repaint everything"), so
        // nothing here would otherwise erase the previous frame's now-stale pixels
        // (`FrameGridMirror`'s documented known limitation, manifesting concretely here). Force
        // one now.
        if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
        await client.send({ cmd: 'paint', ops: gunOps(20, 20, primaryLiveState(activeRuleset)) });
      })();
    },
    clear() {
      void (async () => {
        await client.send({ cmd: 'clear' });
        mirror.reset();
        if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
      })();
    },
    randomSoup() {
      void client.send({ cmd: 'seedRandom', density: 0.3, seed: Math.floor(Math.random() * 0xffffffff) >>> 0 });
    },
    setSpeed(tps: number) {
      targetTps = tps;
      tpsMeter.reset();
      if (simRunning) void client.send({ cmd: 'run', tps: targetTps });
      syncSimUI();
    },
  };
  const context: AppContext = { ...toolContext, sim: simControl };

  const gestures = attachGestures(camera, canvas, { reducedMotion: () => reducedMotion() });

  // Closes P1-B-1's own documented seam: router.ts starts a tool stroke on any primary-button
  // pointerdown and has no visibility into gestures.ts's Space-held state, so a Space+left-drag
  // would otherwise both pan the camera *and* start a paint stroke from the same gesture. Latched
  // once at `onDown` (not re-checked per event) so a mid-stroke state flip from either module can
  // never leave the tool half-suppressed — router itself guarantees a clean onDown → […] →
  // (onUp|onCancel) sequence per pointer, so a flag set at onDown and read for the rest of that
  // sequence is exactly the right lifetime.
  let toolStrokeSuppressed = false;
  const gatedToolHandlers: ToolEventHandlers = {
    onDown: (e: ToolEvent) => {
      toolStrokeSuppressed = gestures.panning || gestures.spaceHeld;
      if (toolStrokeSuppressed) return;
      context.toolRegistry.handlers.onDown?.(e);
    },
    onMove: (e: ToolEvent) => {
      if (toolStrokeSuppressed) return;
      context.toolRegistry.handlers.onMove?.(e);
    },
    onUp: (e: ToolEvent) => {
      if (toolStrokeSuppressed) return;
      context.toolRegistry.handlers.onUp?.(e);
    },
    onCancel: (e: ToolEvent) => {
      if (toolStrokeSuppressed) {
        toolStrokeSuppressed = false;
        return;
      }
      context.toolRegistry.handlers.onCancel?.(e);
    },
  };
  attachInputRouter(camera, canvas, gatedToolHandlers);
  context.toolRegistry.attachEscapeHandling(window);

  const bus = new CommandBus(registry, context, {
    onRun: (id) => {
      if (!id.startsWith('tool.select.')) return;
      canvas.style.cursor = context.toolRegistry.active?.cursor ?? 'default';
    },
  });
  const keymap = new Keymap();
  attachDefaultBindings(keymap, registry);
  attachKeymap(keymap, window, bus);
  canvas.style.cursor = context.toolRegistry.active?.cursor ?? 'default';

  const transport = createTransportControls(bus);
  const speed = createSpeedControl((tps) => simControl.setSpeed(tps));
  shell.transport.append(transport.root, speed.root);

  /** Pushes `simControl`'s current state into the transport/speed components — called on every
   * delivered frame (so `actualTps` stays live while running) and immediately after every
   * transport action (so e.g. the Play/Pause label flips the instant it's pressed, since a
   * paused sim then delivers no further frames to hang an update off of). */
  function syncSimUI(): void {
    transport.update({ running: simControl.running });
    speed.update({ targetTps: simControl.targetTps, actualTps: simControl.actualTps });
  }
  syncSimUI();

  const statusBar = createStatusBar();
  shell.status.appendChild(statusBar.root);

  // A lightweight, independent pointer listener for cursor world coords — `attachInputRouter`
  // only forwards moves *during* an active stroke, no bare-hover stream (P1-B-1's own documented
  // limitation), which the status bar genuinely needs. Snapped to the cell a paint would target,
  // matching every tool's own `Math.round` convention (`brush.ts`/`fill.ts`).
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const world = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    cursorWorld = { x: Math.round(world.x), y: Math.round(world.y) };
  });
  canvas.addEventListener('pointerleave', () => {
    cursorWorld = null;
  });

  /** Renders the status bar from whatever's currently known — called on its own throttled timer
   * (`STATUS_THROTTLE_MS`, the phase doc's own "10 Hz, not 60 Hz" figure), never from the frame
   * or render loop directly, so it keeps updating (cursor, zoom) even while paused and never
   * exceeds its own budget while running fast. */
  function syncStatusBar(): void {
    const cellUnderCursor = cursorWorld
      ? (() => {
          const id = mirror.view().get(cursorWorld.x, cursorWorld.y);
          const def = activeRuleset.states.find((s) => s.id === id);
          return { id, name: def?.name ?? String(id) };
        })()
      : null;
    statusBar.update({
      generation: lastTick,
      population: lastPopulation,
      chips: activeRuleset.states.map((s) => ({
        id: s.id,
        name: s.name,
        count: lastPerState[s.id] ?? 0,
        color: THEME.palette(s.id, 0),
      })),
      cursor: cursorWorld,
      cellUnderCursor,
      zoomPercent: zoomPercent(camera.cellSize),
      fps,
      stepMs: lastStepMicros / 1000,
      renderMs: renderer.readStats().frameMs,
      memoryBytes: mirror.pageCount * CHUNK_AREA,
    });
  }

  // --- Ruleset picker (P1-D-4) ---------------------------------------------------------------

  interface Thumbnail {
    readonly sim: Simulation;
    readonly renderer: Canvas2DRenderer;
    readonly canvas: HTMLCanvasElement;
  }
  const thumbnailCanvases = new Map<string, HTMLCanvasElement>();
  let thumbnails: Map<string, Thumbnail> | null = null;
  let thumbnailFrame = 0;
  let thumbnailBatchOffset = 0;
  let thumbnailRafHandle: number | null = null;

  function thumbnailViewport(): RenderViewport {
    const cellSize = THUMBNAIL_CANVAS_PX / THUMBNAIL_WORLD_SIZE;
    return { originX: 0, originY: 0, cellSize, widthPx: THUMBNAIL_CANVAS_PX, heightPx: THUMBNAIL_CANVAS_PX, dpr: 1 };
  }

  function thumbnailLoop(): void {
    if (!thumbnails) return;
    thumbnailFrame += 1;
    if (thumbnailFrame % THUMBNAIL_STEP_EVERY_N_FRAMES === 0) {
      // Round-robin a fixed-size batch, not every thumbnail at once — see THUMBNAIL_BATCH_SIZE's
      // own doc comment for why "step everything" blew the frame budget.
      const bundles = [...thumbnails.values()];
      for (let i = 0; i < Math.min(THUMBNAIL_BATCH_SIZE, bundles.length); i++) {
        const { sim, renderer: r } = bundles[(thumbnailBatchOffset + i) % bundles.length]!;
        sim.step();
        r.draw({ cells: sim.view(), dirty: null, tick: sim.tick });
      }
      thumbnailBatchOffset = (thumbnailBatchOffset + THUMBNAIL_BATCH_SIZE) % bundles.length;
    }
    thumbnailRafHandle = requestAnimationFrame(thumbnailLoop);
  }

  function startThumbnails(): void {
    const bundles = new Map<string, Thumbnail>();
    thumbnails = bundles;
    let seed = Date.now() >>> 0;
    for (const [id, canvas] of thumbnailCanvases) {
      const ruleset = getBuiltin(id);
      if (!ruleset) continue; // unreachable for a real catalogue entry; skip rather than throw
      const sim = new Simulation({ ruleset, width: THUMBNAIL_WORLD_SIZE, height: THUMBNAIL_WORLD_SIZE, seed });
      sim.seedRandom(THUMBNAIL_SEED_DENSITY, seed);
      seed = (seed + 0x9e3779b9) >>> 0;
      const r = new Canvas2DRenderer();
      void r.init(canvas).then(() => {
        // The picker (or the whole app) may have closed again before `init` resolves — never
        // draw into a thumbnail this loop no longer owns.
        if (thumbnails !== bundles) return;
        r.setTheme({ id: `thumb-${id}`, background: '#05070a', palette: (state) => paletteFor(state) });
        r.resize(THUMBNAIL_CANVAS_PX, THUMBNAIL_CANVAS_PX, 1);
        r.setViewport(thumbnailViewport());
        r.draw({ cells: sim.view(), dirty: null, tick: sim.tick });
      });
      bundles.set(id, { sim, renderer: r, canvas });
    }
    thumbnailFrame = 0;
    thumbnailBatchOffset = 0;
    thumbnailRafHandle = requestAnimationFrame(thumbnailLoop);
  }

  function stopThumbnails(): void {
    if (thumbnailRafHandle !== null) cancelAnimationFrame(thumbnailRafHandle);
    thumbnailRafHandle = null;
    if (thumbnails) for (const { renderer: r } of thumbnails.values()) r.dispose();
    thumbnails = null;
  }

  const rulesetPicker = attachRulesetPicker({
    entries: RULESET_SUMMARIES,
    activeId: activeRuleset.id,
    onThumbnailCreated: (id, canvas) => thumbnailCanvases.set(id, canvas),
    onOpenChange: (isOpen) => (isOpen ? startThumbnails() : stopThumbnails()),
    onConfirm: (id, migration) => {
      const target = getBuiltin(id);
      if (!target) return;
      void (async () => {
        await client.send({
          cmd: 'setRuleset',
          ruleset: target,
          ...(migration ? { migration: activeRuleset.states.map((s) => migration.get(s.id) ?? 0) } : {}),
        });
        activeRuleset = target;
        lastPerState = new Uint32Array(target.states.length);
        rulesetPicker.setActive(id);
      })();
    },
  });
  shell.toolbar.appendChild(rulesetPicker.root);

  async function boot(): Promise<void> {
    await renderer.init(canvas);
    renderer.setTheme(THEME);
    applyViewport();
    requestAnimationFrame(cameraRedrawLoop);
    setInterval(syncStatusBar, STATUS_THROTTLE_MS);

    client.onFrame(renderFrame);

    await client.send({ cmd: 'init', ruleset: CONWAY, width: WORLD_WIDTH, height: WORLD_HEIGHT, seed: SEED });
    await client.send({ cmd: 'paint', ops: gunOps(20, 20, primaryLiveState(activeRuleset)) });
    await client.send({ cmd: 'run', tps: RUN_TPS });

    playIntro();
  }

  /** The cold-start choreography: chrome fades in (`shell.playIntro`) while the camera animates
   * wide-shot-to-framed, together taking ~1.2 s — skipped under reduced motion, cancelled
   * instantly by any real input either way. */
  function playIntro(): void {
    if (reducedMotion()) {
      camera.originX = framedTarget.originX;
      camera.originY = framedTarget.originY;
      camera.cellSize = framedTarget.cellSize;
      void shell.playIntro();
      return;
    }

    let cameraSettled = false;
    const settleCameraNow = (): void => {
      if (cameraSettled) return;
      cameraSettled = true;
      camera.cancelAnimation();
      camera.originX = framedTarget.originX;
      camera.originY = framedTarget.originY;
      camera.cellSize = framedTarget.cellSize;
    };
    const cancelTypes: readonly string[] = ['pointerdown', 'keydown', 'wheel'];
    for (const type of cancelTypes) window.addEventListener(type, settleCameraNow, { once: true });

    camera.animateTo(framedTarget, INTRO_CAMERA_MS, EASE_OUT_CUBIC);
    void shell.playIntro();
  }

  window.addEventListener('resize', () => {
    camera.resize(window.innerWidth, window.innerHeight);
    applyViewport();
  });

  boot().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const root = document.querySelector<HTMLDivElement>('#app');
    if (root) root.insertAdjacentHTML('beforeend', `<pre style="color:#ff8080;padding:12px">${message}</pre>`);
  });
}

main();
