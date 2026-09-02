/**
 * P0-I-1 — the minimal client shell: the first real, in-browser consumer of the worker/client/
 * renderer pipeline P0-G-3/P0-H-2/P0-H-3 built and proved headlessly. Boots a toroidal Conway
 * world, paints a Gosper glider gun, and starts the simulation running immediately — the first
 * thing anyone sees is the thing moving, per this task's own implementation note.
 *
 * The redraw loop is not written here: `WorkerClient.onFrame` already coalesces onto
 * `requestAnimationFrame` internally (P0-G-3), so subscribing to it *is* "a rAF loop that draws
 * only when a new frame has arrived" — while paused, the worker emits no `frame` events, so no
 * rAF is ever requested and idle CPU is exactly zero, not merely small.
 */
import { CONWAY } from '@engine/rules/builtin';
import { Canvas2DRenderer } from '@render/canvas2d';
import type { CompiledTheme, Viewport as RenderViewport } from '@render/types';
import type { PaintOp } from '@shared/types';
import { WorkerClient, type FrameEvent, type WorkerLike } from '@worker/client';
import { FrameGridMirror } from '@worker/frame-view';

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
// Exposed for tooling (this task's cold-load acceptance criterion has no automated harness
// yet — Playwright arrives in Phase 1 — so it's read back with a browser driven by hand/CI).
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

function main(): void {
  const canvas = requireElement<HTMLCanvasElement>('#scene');
  const tickEl = requireElement<HTMLSpanElement>('#stat-tick');
  const populationEl = requireElement<HTMLSpanElement>('#stat-population');
  const fpsEl = requireElement<HTMLSpanElement>('#stat-fps');
  const stepMsEl = requireElement<HTMLSpanElement>('#stat-step-ms');
  const renderMsEl = requireElement<HTMLSpanElement>('#stat-render-ms');
  const playPauseBtn = requireElement<HTMLButtonElement>('#btn-play-pause');
  const resetBtn = requireElement<HTMLButtonElement>('#btn-reset');

  const renderer = new Canvas2DRenderer();
  const mirror = new FrameGridMirror();
  const client = new WorkerClient({
    spawn: () => toWorkerLike(new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' })),
  });

  let running = true;
  let hasFrame = false;
  let lastTick = 0;
  let fps = 0;
  let lastFrameAt: number | null = null;

  function currentViewport(): RenderViewport {
    const dpr = window.devicePixelRatio || 1;
    const widthPx = Math.max(1, Math.round(window.innerWidth * dpr));
    const heightPx = Math.max(1, Math.round(window.innerHeight * dpr));
    const cellSize = Math.max(1, Math.min(widthPx / WORLD_WIDTH, heightPx / WORLD_HEIGHT));
    const visibleWorldWidth = widthPx / cellSize;
    const visibleWorldHeight = heightPx / cellSize;
    return {
      originX: (WORLD_WIDTH - visibleWorldWidth) / 2,
      originY: (WORLD_HEIGHT - visibleWorldHeight) / 2,
      cellSize,
      widthPx,
      heightPx,
      dpr,
    };
  }

  function applyViewport(): void {
    const vp = currentViewport();
    renderer.resize(vp.widthPx, vp.heightPx, vp.dpr);
    renderer.setViewport(vp);
    if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
  }

  function renderFrame(frame: FrameEvent): void {
    mirror.applyChunks(frame.chunks);
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

  async function boot(): Promise<void> {
    await renderer.init(canvas);
    renderer.setTheme(THEME);
    applyViewport();

    client.onFrame(renderFrame);

    await client.send({ cmd: 'init', ruleset: CONWAY, width: WORLD_WIDTH, height: WORLD_HEIGHT, seed: SEED });
    await client.send({ cmd: 'paint', ops: gunOps(20, 20) });
    await client.send({ cmd: 'run', tps: RUN_TPS });
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

  window.addEventListener('resize', applyViewport);

  boot().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const root = document.querySelector<HTMLDivElement>('#app');
    if (root) root.insertAdjacentHTML('beforeend', `<pre style="color:#ff8080;padding:12px">${message}</pre>`);
  });
}

main();
