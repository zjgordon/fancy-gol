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
 *  - `ui/components/shell.ts`'s floating chrome and cold-start choreography (this task) frame
 *    all of it.
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
import { CONWAY } from '@engine/rules/builtin';
import { Canvas2DRenderer } from '@render/canvas2d';
import type { CompiledTheme, Viewport as RenderViewport } from '@render/types';
import type { PaintOp } from '@shared/types';
import { WorkerClient, type FrameEvent, type WorkerLike } from '@worker/client';
import { FrameGridMirror } from '@worker/frame-view';
import { Camera, EASE_OUT_CUBIC } from '@ui/camera';
import { attachGestures } from '@ui/input/gestures';
import { attachInputRouter, type ToolEvent, type ToolEventHandlers } from '@ui/input/router';
import { attachDefaultBindings } from '@ui/input/bindings';
import { attachKeymap, Keymap } from '@ui/input/keymap';
import { CommandBus } from '@ui/commands/bus';
import { attachShell } from '@ui/components/shell';
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

function gunOps(originX: number, originY: number): PaintOp[] {
  return GOSPER_GUN.map(([x, y]) => ({ x: x + originX, y: y + originY, state: 1 }));
}

const THEME: CompiledTheme = {
  id: 'shell-default',
  background: '#05070a',
  palette: (state) => (state === 1 ? '#7cf9d0' : '#05070a'),
};

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
  const tickEl = requireElement<HTMLSpanElement>('#stat-tick');
  const populationEl = requireElement<HTMLSpanElement>('#stat-population');
  const fpsEl = requireElement<HTMLSpanElement>('#stat-fps');
  const stepMsEl = requireElement<HTMLSpanElement>('#stat-step-ms');
  const renderMsEl = requireElement<HTMLSpanElement>('#stat-render-ms');
  const playPauseBtn = requireElement<HTMLButtonElement>('#btn-play-pause');
  const resetBtn = requireElement<HTMLButtonElement>('#btn-reset');

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

  let running = true;
  let hasFrame = false;
  let lastTick = 0;
  let fps = 0;
  let lastFrameAt: number | null = null;

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

    const now = performance.now();
    if (lastFrameAt !== null) {
      const instant = 1000 / Math.max(1, now - lastFrameAt);
      fps = fps === 0 ? instant : fps * 0.9 + instant * 0.1;
    }
    lastFrameAt = now;
    if (window.__fancyGolFirstFrameMs === undefined) {
      window.__fancyGolFirstFrameMs = now - bootStart;
    }

    tickEl.textContent = String(frame.tick);
    populationEl.textContent = String(frame.stats.population);
    fpsEl.textContent = fps.toFixed(0);
    stepMsEl.textContent = `${(frame.stats.stepMicros / 1000).toFixed(2)} ms`;
    renderMsEl.textContent = `${renderer.readStats().frameMs.toFixed(2)} ms`;
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

  const { context, registry } = createAppContext({
    onPaint: (ops) => {
      void client.send({ cmd: 'paint', ops });
    },
  });

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

  async function boot(): Promise<void> {
    await renderer.init(canvas);
    renderer.setTheme(THEME);
    applyViewport();
    requestAnimationFrame(cameraRedrawLoop);

    client.onFrame(renderFrame);

    await client.send({ cmd: 'init', ruleset: CONWAY, width: WORLD_WIDTH, height: WORLD_HEIGHT, seed: SEED });
    await client.send({ cmd: 'paint', ops: gunOps(20, 20) });
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

  playPauseBtn.addEventListener('click', () => {
    running = !running;
    playPauseBtn.textContent = running ? 'Pause' : 'Play';
    void client.send(running ? { cmd: 'run', tps: RUN_TPS } : { cmd: 'pause' });
  });

  resetBtn.addEventListener('click', () => {
    void (async () => {
      await client.send({ cmd: 'clear' });
      mirror.reset();
      // `clear`'s frame reports an *empty* dirty list (nothing changed, from the worker's point
      // of view an empty world has nothing to describe) — not `null` ("repaint everything"), so
      // nothing here would otherwise erase the previous frame's now-stale pixels (FrameGridMirror's
      // documented known limitation, manifesting concretely here). Force one now.
      if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
      await client.send({ cmd: 'paint', ops: gunOps(20, 20) });
    })();
  });

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
