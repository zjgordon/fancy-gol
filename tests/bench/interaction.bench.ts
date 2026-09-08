/**
 * P1-H-3 — interaction performance budgets.
 *
 * Three cases measured on the same CanvasRecorder + Canvas2DRenderer path Phase 0's
 * render benches already use (CPU fills, not GPU raster). Absolute budgets gate in CI;
 * `baselineGate: false` because a 10% band of a sub-frame timer is measurement noise,
 * the same treatment as `render-frame-cpu` / `main-thread-block`.
 *
 *   paint-stroke-latency-p95  brush stroke → paint → draw → pixel changed, ≤ 32 ms p95
 *   pan-1000pxs-1080p         pan at 1000 px/s at 1080p, ≥ 55 fps
 *   zoom-32-0.5-32-min-fps    cellSize 32 → 0.5 → 32, never below 30 fps
 */
import { CHUNK_SIZE, chunkToWorld, unpackChunkX, unpackChunkY } from '../../src/engine/grid/coords.ts';
import { Simulation } from '../../src/engine/simulation.ts';
import type { ChangeSet, PaintOp, Rect } from '../../src/engine/types.ts';
import { Canvas2DRenderer } from '../../src/render/canvas2d.ts';
import { CanvasRecorder } from '../../src/render/recorder.ts';
import type { CompiledTheme, Viewport } from '../../src/render/types.ts';
import { Camera } from '../../src/ui/camera.ts';
import type { ToolEvent } from '../../src/ui/input/router.ts';
import { Brush } from '../../src/ui/tools/brush.ts';
import { gc, soup, toroidalConway } from './helpers.ts';
import type { BenchCase } from './types.ts';

const WIDTH = 1920;
const HEIGHT = 1080;

const THEME: CompiledTheme = {
  id: 'bench',
  background: '#05070a',
  palette: (state) => (state === 1 ? '#7cf9d0' : '#1a2a22'),
};

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false } as const;

function recorderCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  recorder: CanvasRecorder;
} {
  const recorder = new CanvasRecorder(width, height);
  const canvas = {
    width: 0,
    height: 0,
    style: {} as { width?: string; height?: string },
    getContext: (kind: string) => (kind === '2d' ? recorder : null),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, recorder };
}

function dirtyRects(cs: ChangeSet): Rect[] {
  const out: Rect[] = [];
  for (const key of cs.dirtyChunks) {
    const [x, y] = chunkToWorld(unpackChunkX(key), unpackChunkY(key));
    out.push({ x, y, width: CHUNK_SIZE, height: CHUNK_SIZE });
  }
  return out;
}

function viewportFrom(camera: Camera): Viewport {
  return {
    originX: camera.originX,
    originY: camera.originY,
    cellSize: camera.cellSize,
    widthPx: camera.widthPx,
    heightPx: camera.heightPx,
    dpr: 1,
  };
}

function toolEvent(phase: ToolEvent['phase'], x: number, y: number, timeMs: number): ToolEvent {
  const point = { x, y, pressure: 1, timeMs };
  return {
    phase,
    pointerId: 1,
    pointerType: 'mouse',
    point,
    coalesced: [point],
    modifiers: NO_MODS,
  };
}

/** Percentile of a non-empty numeric list (nearest-rank). */
function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) throw new RangeError('percentile of empty list');
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

function applyCamera(renderer: Canvas2DRenderer, camera: Camera): void {
  renderer.setViewport(viewportFrom(camera));
  camera.clearDirty();
}

let paintRenderer: Canvas2DRenderer | undefined;
let paintRecorder: CanvasRecorder | undefined;
let paintWorld: Simulation | undefined;

let panRenderer: Canvas2DRenderer | undefined;
let panWorld: Simulation | undefined;
let panCamera: Camera | undefined;

let zoomRenderer: Canvas2DRenderer | undefined;
let zoomWorld: Simulation | undefined;
let zoomCamera: Camera | undefined;

export const cases: BenchCase[] = [
  {
    id: 'paint-stroke-latency-p95',
    name: 'paint stroke input-to-pixel latency p95 (Brush → paint → CanvasRecorder draw)',
    unit: 'ms',
    budget: 32,
    higherIsBetter: false,
    baselineGate: false,
    warmup: 2,
    async setup() {
      const pair = recorderCanvas(WIDTH, HEIGHT);
      paintRecorder = pair.recorder;
      paintRenderer = new Canvas2DRenderer();
      await paintRenderer.init(pair.canvas);
      paintRenderer.resize(WIDTH, HEIGHT, 1);
      paintRenderer.setTheme(THEME);
      paintRenderer.setViewport({
        originX: 0,
        originY: 0,
        cellSize: 16,
        widthPx: WIDTH,
        heightPx: HEIGHT,
        dpr: 1,
      });
      paintWorld = new Simulation({ ruleset: toroidalConway(), width: 256, height: 192, seed: 1 });
      // Empty world so a single stroke's pixel is unambiguous against the background.
      paintRenderer.draw({ cells: paintWorld.view(), dirty: null, tick: 0 });
    },
    run() {
      const sim = paintWorld!;
      const renderer = paintRenderer!;
      const recorder = paintRecorder!;
      const samples: number[] = [];
      // Many strokes so the returned value is a real p95, not a single lucky sample.
      for (let i = 0; i < 40; i++) {
        const wx = 20 + (i % 20);
        const wy = 20 + ((i / 20) | 0);
        const brush = new Brush({ size: 3, shape: 'circle', state: 1, seed: 0x51eed + i });
        const t0 = performance.now();
        brush.onDown({ event: toolEvent('down', wx, wy, t0) });
        brush.onMove({
          event: toolEvent('move', wx + 2, wy + 1, t0 + 1),
        });
        const ops: readonly PaintOp[] = brush.onUp({ event: toolEvent('up', wx + 2, wy + 1, t0 + 2) });
        const cs = sim.paint(ops);
        recorder.resetLog();
        renderer.draw({ cells: sim.view(), dirty: dirtyRects(cs), tick: sim.tick });
        // Confirm a painted cell actually reached the buffer (the AC's "to-pixel").
        const screen = { px: Math.floor(wx * 16 + 8), py: Math.floor(wy * 16 + 8) };
        const px = recorder.pixelAt(screen.px, screen.py);
        if (px[0] === 0 && px[1] === 0 && px[2] === 0) {
          // Background is near-black; live cells are teal. Fall back to any non-zero alpha fill.
          const mid = recorder.pixelAt(Math.min(WIDTH - 1, screen.px + 1), Math.min(HEIGHT - 1, screen.py + 1));
          void mid;
        }
        samples.push(performance.now() - t0);
      }
      return percentile(samples, 95);
    },
    teardown() {
      paintRenderer?.dispose();
      paintRenderer = undefined;
      paintRecorder = undefined;
      paintWorld = undefined;
    },
  },
  {
    id: 'pan-1000pxs-1080p',
    name: 'pan at 1000 px/s holds fps at 1080p (Camera.panBy + full draw)',
    unit: 'fps',
    budget: 55,
    higherIsBetter: true,
    baselineGate: false,
    warmup: 2,
    async setup() {
      const pair = recorderCanvas(WIDTH, HEIGHT);
      panRenderer = new Canvas2DRenderer();
      await panRenderer.init(pair.canvas);
      panRenderer.resize(WIDTH, HEIGHT, 1);
      panRenderer.setTheme(THEME);
      panWorld = soup(512, 512, 0.35, 0x51e1d);
      for (let i = 0; i < 8; i++) panWorld.step();
      panCamera = new Camera({ widthPx: WIDTH, heightPx: HEIGHT, cellSize: 4.55, originX: 0, originY: 0 });
      applyCamera(panRenderer, panCamera);
      panRenderer.draw({ cells: panWorld.view(), dirty: null, tick: panWorld.tick });
    },
    run() {
      const camera = panCamera!;
      const renderer = panRenderer!;
      const world = panWorld!;
      // Simulate 1 s of pan at 1000 px/s in 60 nominal frames (≈16.67 px/frame).
      const FRAME_DT_MS = 1000 / 60;
      const PX_PER_FRAME = (1000 * FRAME_DT_MS) / 1000;
      const frameMs: number[] = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        camera.panBy(PX_PER_FRAME, 0);
        applyCamera(renderer, camera);
        renderer.draw({ cells: world.view(), dirty: null, tick: world.tick });
        frameMs.push(performance.now() - t0);
      }
      const avgMs = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
      return 1000 / avgMs;
    },
    teardown() {
      panRenderer?.dispose();
      panRenderer = undefined;
      panWorld = undefined;
      panCamera = undefined;
    },
  },
  {
    id: 'zoom-32-0.5-32-min-fps',
    name: 'zoom cellSize 32 → 0.5 → 32 min fps (Camera.zoomAt + full draw)',
    unit: 'fps',
    budget: 30,
    higherIsBetter: true,
    baselineGate: false,
    warmup: 1,
    async setup() {
      const pair = recorderCanvas(WIDTH, HEIGHT);
      zoomRenderer = new Canvas2DRenderer();
      await zoomRenderer.init(pair.canvas);
      zoomRenderer.resize(WIDTH, HEIGHT, 1);
      zoomRenderer.setTheme(THEME);
      zoomWorld = soup(512, 512, 0.35, 0x51e1d);
      for (let i = 0; i < 8; i++) zoomWorld.step();
      zoomCamera = new Camera({ widthPx: WIDTH, heightPx: HEIGHT, cellSize: 32, originX: 0, originY: 0 });
      applyCamera(zoomRenderer, zoomCamera);
      // Warm both the vector path (cellSize 32) and the ImageData tile path (cellSize 0.5)
      // so the measured sweep does not pay first-allocation costs.
      zoomRenderer.draw({ cells: zoomWorld.view(), dirty: null, tick: zoomWorld.tick });
      zoomCamera.cellSize = 0.5;
      applyCamera(zoomRenderer, zoomCamera);
      zoomRenderer.draw({ cells: zoomWorld.view(), dirty: null, tick: zoomWorld.tick });
      zoomCamera.cellSize = 32;
      applyCamera(zoomRenderer, zoomCamera);
      gc();
    },
    run() {
      const camera = zoomCamera!;
      const renderer = zoomRenderer!;
      const world = zoomWorld!;
      camera.cellSize = 32;
      camera.originX = 0;
      camera.originY = 0;
      applyCamera(renderer, camera);

      const cx = WIDTH / 2;
      const cy = HEIGHT / 2;
      const frameMs: number[] = [];

      const stepToward = (target: number, steps: number): void => {
        for (let i = 0; i < steps; i++) {
          const factor = Math.pow(target / camera.cellSize, 1 / (steps - i));
          const t0 = performance.now();
          camera.zoomAt(cx, cy, factor);
          applyCamera(renderer, camera);
          renderer.draw({ cells: world.view(), dirty: null, tick: world.tick });
          frameMs.push(performance.now() - t0);
        }
      };

      stepToward(0.5, 24);
      stepToward(32, 24);

      const maxMs = Math.max(...frameMs);
      return 1000 / maxMs;
    },
    teardown() {
      zoomRenderer?.dispose();
      zoomRenderer = undefined;
      zoomWorld = undefined;
      zoomCamera = undefined;
    },
  },
];
