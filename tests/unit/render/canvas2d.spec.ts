import { describe, expect, it } from 'vitest';
import { BRIANS_BRAIN, CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { Canvas2DRenderer, parseColor } from '@render/canvas2d';
import type { CompiledTheme, Viewport } from '@render/types';
import type { Rect } from '@shared/types';

/**
 * A minimal but *functionally real* 2D-context double: `fillRect`/`putImageData` actually write
 * into a backing RGBA buffer (not just recorded as calls), so tests can assert on the resulting
 * pixels, not merely on call counts. `createImageData` returns a plain `{width,height,data}` —
 * the exact shape `putImageData` needs, without requiring a real `ImageData` global.
 */
class FakeContext {
  fillStyle = '#000000';
  readonly calls: string[] = [];
  readonly pixels: Uint8ClampedArray;

  constructor(
    readonly canvasWidth: number,
    readonly canvasHeight: number,
  ) {
    this.pixels = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push('fillRect');
    const [r, g, b, a] = parseColor(this.fillStyle);
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(this.canvasWidth, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.canvasHeight, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const idx = (yy * this.canvasWidth + xx) * 4;
        this.pixels[idx] = r;
        this.pixels[idx + 1] = g;
        this.pixels[idx + 2] = b;
        this.pixels[idx + 3] = a;
      }
    }
  }

  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  putImageData(image: { width: number; height: number; data: Uint8ClampedArray }, dx: number, dy: number): void {
    this.calls.push('putImageData');
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const px = dx + x;
        const py = dy + y;
        if (px < 0 || py < 0 || px >= this.canvasWidth || py >= this.canvasHeight) continue;
        const srcIdx = (y * image.width + x) * 4;
        const dstIdx = (py * this.canvasWidth + px) * 4;
        this.pixels[dstIdx] = image.data[srcIdx]!;
        this.pixels[dstIdx + 1] = image.data[srcIdx + 1]!;
        this.pixels[dstIdx + 2] = image.data[srcIdx + 2]!;
        this.pixels[dstIdx + 3] = image.data[srcIdx + 3]!;
      }
    }
  }

  pixelAt(x: number, y: number): readonly [number, number, number, number] {
    const idx = (y * this.canvasWidth + x) * 4;
    return [this.pixels[idx]!, this.pixels[idx + 1]!, this.pixels[idx + 2]!, this.pixels[idx + 3]!];
  }
}

function createFakeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: FakeContext } {
  const ctx = new FakeContext(width, height);
  const canvas = {
    width: 0,
    height: 0,
    style: {} as { width?: string; height?: string },
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
}

const RED = '#ff0000';
const GREEN = '#00ff00';
const BLUE = '#0000ff';
const BACKGROUND = '#101010';

const THEME: CompiledTheme = {
  id: 'test',
  background: BACKGROUND,
  palette: (state) => (state === 1 ? RED : state === 2 ? GREEN : BLUE),
};

async function setUp(
  width: number,
  height: number,
  viewport: Viewport,
): Promise<{ renderer: Canvas2DRenderer; ctx: FakeContext }> {
  const { canvas, ctx } = createFakeCanvas(width, height);
  const renderer = new Canvas2DRenderer();
  await renderer.init(canvas);
  renderer.resize(width, height, viewport.dpr);
  renderer.setTheme(THEME);
  renderer.setViewport(viewport);
  return { renderer, ctx };
}

describe('parseColor', () => {
  it('parses #rgb, #rrggbb, #rrggbbaa, rgb(), and rgba()', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0, 255]);
    expect(parseColor('#ff0000')).toEqual([255, 0, 0, 255]);
    expect(parseColor('#ff000080')).toEqual([255, 0, 0, 128]);
    expect(parseColor('rgb(255, 0, 0)')).toEqual([255, 0, 0, 255]);
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([255, 0, 0, 128]);
  });

  it('rejects an unsupported colour format', () => {
    expect(() => parseColor('red')).toThrow(/unsupported theme colour/);
  });
});

describe('Canvas2DRenderer: lifecycle', () => {
  it('init rejects a canvas whose getContext("2d") returns null', async () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer();
    await expect(renderer.init(canvas)).rejects.toThrow(/getContext/);
  });

  it('resize sets the backing-store size and, for a styleable canvas, the CSS size', () => {
    const { canvas } = createFakeCanvas(800, 600);
    const renderer = new Canvas2DRenderer();
    void renderer.init(canvas);
    renderer.resize(800, 600, 2);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('300px');
  });

  it('draw throws if setTheme was never called', async () => {
    const { canvas } = createFakeCanvas(100, 100);
    const renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    renderer.setViewport({ originX: 0, originY: 0, cellSize: 10, widthPx: 100, heightPx: 100, dpr: 1 });
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32, seed: 1 });
    expect(() => renderer.draw({ cells: sim.view(), dirty: null, tick: 0 })).toThrow(/setTheme/);
  });

  it('draw throws if setViewport was never called', async () => {
    const { canvas } = createFakeCanvas(100, 100);
    const renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    renderer.setTheme(THEME);
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32, seed: 1 });
    expect(() => renderer.draw({ cells: sim.view(), dirty: null, tick: 0 })).toThrow(/setViewport/);
  });

  it('dispose() means draw() needs init() again', async () => {
    const { canvas } = createFakeCanvas(100, 100);
    const renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    renderer.setTheme(THEME);
    renderer.setViewport({ originX: 0, originY: 0, cellSize: 10, widthPx: 100, heightPx: 100, dpr: 1 });
    renderer.dispose();
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32, seed: 1 });
    expect(() => renderer.draw({ cells: sim.view(), dirty: null, tick: 0 })).toThrow(/init/);
  });
});

describe('Canvas2DRenderer: theme colours, never a hardcoded grey', () => {
  it('a full repaint fills the background with the theme colour, not a default grey', async () => {
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 10, widthPx: 320, heightPx: 320, dpr: 1 };
    const { renderer, ctx } = await setUp(320, 320, viewport);
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 32, height: 32, seed: 1 });

    renderer.draw({ cells: sim.view(), dirty: null, tick: 0 });

    expect(ctx.pixelAt(10, 10)).toEqual(parseColor(BACKGROUND));
    expect(ctx.pixelAt(160, 160)).toEqual(parseColor(BACKGROUND));
  });

  it('a live cell is painted in its palette colour, not a hardcoded one', async () => {
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 10, widthPx: 320, heightPx: 320, dpr: 1 };
    const { renderer, ctx } = await setUp(320, 320, viewport);
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 32, height: 32, seed: 1 });
    sim.set(5, 5, 1);

    const dirty: Rect[] = [{ x: 0, y: 0, width: 32, height: 32 }];
    renderer.draw({ cells: sim.view(), dirty, tick: 0 });

    expect(ctx.pixelAt(55, 55)).toEqual(parseColor(RED));
    expect(ctx.pixelAt(0, 0)).toEqual(parseColor(BACKGROUND));
  });
});

describe('Canvas2DRenderer: bounded draw calls (P0-H-2 acceptance)', () => {
  it('repainting a single changed cell issues a bounded, small number of draw calls', async () => {
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 10, widthPx: 320, heightPx: 320, dpr: 1 };
    const { renderer } = await setUp(320, 320, viewport);
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 32, height: 32, seed: 1 });
    sim.set(5, 5, 1);

    const dirty: Rect[] = [{ x: 0, y: 0, width: 32, height: 32 }];
    renderer.draw({ cells: sim.view(), dirty, tick: 0 });

    // One background fill for the dirty rect, one fillRect for the single-cell run: exactly 2,
    // never something proportional to the chunk's 1,024 cells (which would mean an accidental
    // per-cell fallback, not the batched-run path).
    expect(renderer.readStats().drawCalls).toBe(2);
  });

  it('batches a run of same-state cells into one fillRect, not one per cell', async () => {
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 10, widthPx: 320, heightPx: 320, dpr: 1 };
    const { renderer, ctx } = await setUp(320, 320, viewport);
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 32, height: 32, seed: 1 });
    for (let x = 2; x < 7; x++) sim.set(x, 3, 1); // a 5-cell horizontal run, one state

    const dirty: Rect[] = [{ x: 0, y: 0, width: 32, height: 32 }];
    renderer.draw({ cells: sim.view(), dirty, tick: 0 });

    expect(renderer.readStats().drawCalls).toBe(2); // background + one run, not five
    expect(ctx.pixelAt(25, 35)).toEqual(parseColor(RED)); // x=2 → px 20..30
    expect(ctx.pixelAt(65, 35)).toEqual(parseColor(RED)); // x=6 → px 60..70
  });

  it('groups distinct states into separate fillStyle batches, one draw call per state group', async () => {
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 10, widthPx: 320, heightPx: 320, dpr: 1 };
    const { renderer, ctx } = await setUp(320, 320, viewport);
    const sim = new Simulation({ ruleset: { ...BRIANS_BRAIN, boundary: 'bounded' }, width: 32, height: 32, seed: 1 });
    sim.set(1, 1, 1); // firing
    sim.set(10, 10, 2); // refractory

    const dirty: Rect[] = [{ x: 0, y: 0, width: 32, height: 32 }];
    renderer.draw({ cells: sim.view(), dirty, tick: 0 });

    expect(renderer.readStats().drawCalls).toBe(3); // background + one run per state
    expect(ctx.pixelAt(15, 15)).toEqual(parseColor(RED));
    expect(ctx.pixelAt(105, 105)).toEqual(parseColor(GREEN));
  });

  it('scopes work to the dirty rect: cells outside it are not touched even if alive', async () => {
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 10, widthPx: 640, heightPx: 320, dpr: 1 };
    const { renderer, ctx } = await setUp(640, 320, viewport);
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 64, height: 32, seed: 1 });
    sim.set(1, 1, 1); // chunk (0,0)
    sim.set(40, 1, 1); // chunk (1,0), outside the dirty rect below

    const dirty: Rect[] = [{ x: 0, y: 0, width: 32, height: 32 }]; // only chunk (0,0)
    renderer.draw({ cells: sim.view(), dirty, tick: 0 });

    expect(ctx.pixelAt(15, 15)).toEqual(parseColor(RED));
    expect(ctx.pixelAt(405, 15)).toEqual([0, 0, 0, 0]); // untouched: no fill posted there at all
    expect(renderer.readStats().tilesRepainted).toBe(1);
  });
});

describe('Canvas2DRenderer: sub-4px cellSize uses the ImageData tile path', () => {
  it('issues exactly one putImageData call, not many fillRects', async () => {
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 2, widthPx: 64, heightPx: 64, dpr: 1 };
    const { renderer, ctx } = await setUp(64, 64, viewport);
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 32, height: 32, seed: 1 });
    sim.set(5, 5, 1);
    sim.set(6, 5, 1);

    const dirty: Rect[] = [{ x: 0, y: 0, width: 32, height: 32 }];
    renderer.draw({ cells: sim.view(), dirty, tick: 0 });

    expect(ctx.calls).toEqual(['putImageData']);
    expect(renderer.readStats().drawCalls).toBe(1);
    // cellSize 2: cell (5,5) → px (10,10)-(12,12); background elsewhere.
    expect(ctx.pixelAt(10, 10)).toEqual(parseColor(RED));
    expect(ctx.pixelAt(0, 0)).toEqual(parseColor(BACKGROUND));
  });
});
