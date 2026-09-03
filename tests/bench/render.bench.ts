import { CHUNK_SIZE, chunkToWorld, unpackChunkX, unpackChunkY } from '../../src/engine/grid/coords.ts';
import { Simulation } from '../../src/engine/simulation.ts';
import type { ChangeSet, PaintOp, Rect } from '../../src/engine/types.ts';
import { Canvas2DRenderer } from '../../src/render/canvas2d.ts';
import { CanvasRecorder } from '../../src/render/recorder.ts';
import type { CompiledTheme, Viewport } from '../../src/render/types.ts';
import { soup, toroidalConway } from './helpers.ts';
import type { BenchCase } from './types.ts';

const WIDTH = 1920;
const HEIGHT = 1080;
/** ~100k cells in a 1080p viewport: 1920/4.55 × 1080/4.55 ≈ 422 × 237. */
const CELL_SIZE = 4.55;

const THEME: CompiledTheme = {
  id: 'bench',
  background: '#05070a',
  palette: (state) => (state === 1 ? '#7cf9d0' : '#1a2a22'),
};

function dirtyRects(cs: ChangeSet): Rect[] {
  const out: Rect[] = [];
  for (const key of cs.dirtyChunks) {
    const [x, y] = chunkToWorld(unpackChunkX(key), unpackChunkY(key));
    out.push({ x, y, width: CHUNK_SIZE, height: CHUNK_SIZE });
  }
  return out;
}

/** Same 36-cell Gosper gun the Phase 0 client paints — the actual per-tick main-thread workload. */
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

function gunOps(): PaintOp[] {
  return GOSPER_GUN.map(([x, y]) => ({ x: x + 20, y: y + 20, state: 1 }));
}

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

let renderer: Canvas2DRenderer | undefined;
let recorder: CanvasRecorder | undefined;
let world: Simulation | undefined;
let gunWorld: Simulation | undefined;
let gunRenderer: Canvas2DRenderer | undefined;
let gunRecorder: CanvasRecorder | undefined;

const VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: CELL_SIZE,
  widthPx: WIDTH,
  heightPx: HEIGHT,
  dpr: 1,
};

export const cases: BenchCase[] = [
  {
    id: 'render-frame-cpu',
    name: '1080p / 100k visible cells frame time (CPU via CanvasRecorder, not GPU raster)',
    unit: 'ms',
    budget: 16.6,
    higherIsBetter: false,
    baselineGate: false,
    warmup: 8,
    async setup() {
      const pair = recorderCanvas(WIDTH, HEIGHT);
      recorder = pair.recorder;
      renderer = new Canvas2DRenderer();
      await renderer.init(pair.canvas);
      renderer.resize(WIDTH, HEIGHT, 1);
      renderer.setTheme(THEME);
      renderer.setViewport(VIEWPORT);
      world = soup(512, 512, 0.5);
      for (let i = 0; i < 16; i++) world.step();
    },
    run() {
      recorder!.resetLog();
      renderer!.draw({ cells: world!.view(), dirty: null, tick: world!.tick });
      return renderer!.readStats().frameMs;
    },
    teardown() {
      renderer?.dispose();
      renderer = undefined;
      recorder = undefined;
      world = undefined;
    },
  },
  {
    id: 'main-thread-block',
    name: 'main-thread block per tick (Gosper gun dirty-rect CPU draw, not GPU raster)',
    unit: 'ms',
    budget: 4,
    higherIsBetter: false,
    baselineGate: false,
    warmup: 4,
    async setup() {
      const pair = recorderCanvas(WIDTH, HEIGHT);
      gunRecorder = pair.recorder;
      gunRenderer = new Canvas2DRenderer();
      await gunRenderer.init(pair.canvas);
      gunRenderer.resize(WIDTH, HEIGHT, 1);
      gunRenderer.setTheme(THEME);
      const cell = HEIGHT / 192;
      gunRenderer.setViewport({
        originX: 0,
        originY: 0,
        cellSize: cell,
        widthPx: WIDTH,
        heightPx: HEIGHT,
        dpr: 1,
      });
      gunWorld = new Simulation({
        ruleset: toroidalConway(),
        width: 256,
        height: 192,
        seed: 1,
      });
      gunWorld.paint(gunOps());
      for (let i = 0; i < 30; i++) gunWorld.step();
    },
    run() {
      const sim = gunWorld!;
      const t0 = performance.now();
      const cs = sim.step();
      gunRecorder!.resetLog();
      gunRenderer!.draw({ cells: sim.view(), dirty: dirtyRects(cs), tick: sim.tick });
      return performance.now() - t0;
    },
    teardown() {
      gunRenderer?.dispose();
      gunRenderer = undefined;
      gunRecorder = undefined;
      gunWorld = undefined;
    },
  },
];
