/**
 * P0-H-2 — the Canvas2D renderer (ADR-005). Clips to each dirty rect (or the whole visible
 * viewport, on a `null` "full repaint"), walks only the chunks it touches
 * (`GridView.forEachChunkInRect`), and batches same-state cells into per-row runs so a frame
 * issues a handful of `fillRect` calls, not one per cell.
 *
 * Below `cellSize` 4 device px, individual `fillRect`s stop paying for themselves — that regime
 * writes a `Uint8ClampedArray` pixel buffer directly and blits it with one `putImageData`
 * instead of thousands of sub-pixel-ish shapes.
 *
 * Cell colours always come from the active `CompiledTheme`; nothing here hardcodes a colour.
 */
import {
  CHUNK_SIZE,
  DEAD,
  chunkToWorld,
  localIndex,
  type ChunkView,
  type GridView,
  type Rect,
  type StateId,
} from '@shared/types';
import type { CompiledTheme, RenderFrame, Renderer, RenderStats, Viewport } from './types';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

/** Below this device-px cell size, vector `fillRect`s give way to a pre-rasterised `ImageData` tile. */
const IMAGE_DATA_CELL_SIZE_THRESHOLD = 4;

/** `OffscreenCanvas` has no `style`; a real `HTMLCanvasElement` does. Duck-typed, not `instanceof`, so a structurally-shaped test double can opt in without needing a real DOM. */
function isStyleable(canvas: CanvasLike): canvas is HTMLCanvasElement {
  return 'style' in canvas;
}

/**
 * Hand-written (no bloat): `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)` — the formats
 * a theme palette is expected to use. No CSS named-colour table; a theme wanting "red" writes
 * `#ff0000`. Only needed by the `ImageData` tile path, which writes raw RGBA bytes and can't
 * hand a CSS string to the canvas the way `fillStyle` can.
 */
export function parseColor(css: string): readonly [r: number, g: number, b: number, a: number] {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(css);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3) {
      const r = parseInt(h[0]! + h[0]!, 16);
      const g = parseInt(h[1]! + h[1]!, 16);
      const b = parseInt(h[2]! + h[2]!, 16);
      return [r, g, b, 255];
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return [r, g, b, a];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css);
  if (rgb) {
    const r = Math.round(Number(rgb[1]));
    const g = Math.round(Number(rgb[2]));
    const b = Math.round(Number(rgb[3]));
    const a = rgb[4] === undefined ? 255 : Math.round(Number(rgb[4]) * 255);
    return [r, g, b, a];
  }
  throw new RangeError(
    `unsupported theme colour "${css}" — use #rgb, #rrggbb, #rrggbbaa, rgb(...), or rgba(...)`,
  );
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

interface Run {
  readonly state: StateId;
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
}

/** Row-run detection within one chunk, clipped to `clip` (world/cell coordinates). `DEAD` runs are skipped — the background fill already covers them. */
function collectRuns(chunk: ChunkView, clip: Rect, out: Run[]): void {
  const [originX, originY] = chunkToWorld(chunk.cx, chunk.cy);
  const lx0 = Math.max(0, Math.floor(clip.x - originX));
  const lx1 = Math.min(CHUNK_SIZE, Math.ceil(clip.x + clip.width - originX));
  const ly0 = Math.max(0, Math.floor(clip.y - originY));
  const ly1 = Math.min(CHUNK_SIZE, Math.ceil(clip.y + clip.height - originY));
  if (lx1 <= lx0 || ly1 <= ly0) return;

  for (let ly = ly0; ly < ly1; ly++) {
    let runStart = lx0;
    let runState: StateId = chunk.at(localIndex(lx0, ly));
    for (let lx = lx0 + 1; lx <= lx1; lx++) {
      const state = lx < lx1 ? chunk.at(localIndex(lx, ly)) : -1; // -1: sentinel, flush at row end
      if (state !== runState) {
        if (runState !== DEAD) {
          out.push({ state: runState, x0: originX + runStart, x1: originX + lx, y: originY + ly });
        }
        runStart = lx;
        runState = state;
      }
    }
  }
}

/** Every cell within `clip` in one chunk, for the `ImageData` tile path — no run-batching needed since each cell is a raw pixel-buffer write, not a canvas call. */
function forEachCellInClip(chunk: ChunkView, clip: Rect, fn: (x: number, y: number, state: StateId) => void): void {
  const [originX, originY] = chunkToWorld(chunk.cx, chunk.cy);
  const lx0 = Math.max(0, Math.floor(clip.x - originX));
  const lx1 = Math.min(CHUNK_SIZE, Math.ceil(clip.x + clip.width - originX));
  const ly0 = Math.max(0, Math.floor(clip.y - originY));
  const ly1 = Math.min(CHUNK_SIZE, Math.ceil(clip.y + clip.height - originY));
  for (let ly = ly0; ly < ly1; ly++) {
    for (let lx = lx0; lx < lx1; lx++) {
      const state = chunk.at(localIndex(lx, ly));
      if (state !== DEAD) fn(originX + lx, originY + ly, state);
    }
  }
}

export class Canvas2DRenderer implements Renderer {
  readonly kind = 'canvas2d' as const;

  private canvas: CanvasLike | null = null;
  private ctx: Canvas2DContext | null = null;
  private viewport: Viewport | null = null;
  private theme: CompiledTheme | null = null;
  private stats: RenderStats = { frameMs: 0, drawCalls: 0, tilesRepainted: 0 };
  private readonly colorCache = new Map<string, readonly [number, number, number, number]>();

  /** `Promise<void>` per ADR-005's `Renderer` contract (WebGL2's `init` needs shader compilation; Canvas2D's doesn't — nothing here is genuinely asynchronous). Failure is a rejection, not a synchronous throw, matching that contract. */
  init(canvas: CanvasLike): Promise<void> {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas2d renderer: canvas.getContext("2d") returned null');
      this.canvas = canvas;
      this.ctx = ctx;
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  resize(widthPx: number, heightPx: number, dpr: number): void {
    const canvas = this.requireCanvas();
    canvas.width = widthPx;
    canvas.height = heightPx;
    if (isStyleable(canvas)) {
      canvas.style.width = `${widthPx / dpr}px`;
      canvas.style.height = `${heightPx / dpr}px`;
    }
    this.viewport = { ...(this.viewport ?? { originX: 0, originY: 0, cellSize: 16 }), widthPx, heightPx, dpr };
  }

  setTheme(theme: CompiledTheme): void {
    this.theme = theme;
    this.colorCache.clear();
  }

  setViewport(vp: Viewport): void {
    this.viewport = vp;
  }

  draw(frame: RenderFrame): void {
    const ctx = this.requireCtx();
    const theme = this.requireTheme();
    const viewport = this.requireViewport();
    const t0 = performance.now();
    let drawCalls = 0;
    const touchedChunks = new Set<string>();

    const visible = this.visibleWorldRect(viewport);
    const dirtyWorldRects = frame.dirty ?? [visible];

    for (const rawRect of dirtyWorldRects) {
      const worldRect = intersectRect(rawRect, visible);
      if (!worldRect) continue;
      const pixelRect = this.worldToPixelRect(worldRect, viewport);
      if (pixelRect.width <= 0 || pixelRect.height <= 0) continue;

      if (viewport.cellSize < IMAGE_DATA_CELL_SIZE_THRESHOLD) {
        drawCalls += this.drawTile(ctx, theme, frame.cells, worldRect, pixelRect, viewport, touchedChunks);
      } else {
        drawCalls += this.drawVector(ctx, theme, frame.cells, worldRect, pixelRect, viewport, touchedChunks);
      }
    }

    this.stats = { frameMs: performance.now() - t0, drawCalls, tilesRepainted: touchedChunks.size };
  }

  readStats(): RenderStats {
    return this.stats;
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.colorCache.clear();
  }

  private visibleWorldRect(viewport: Viewport): Rect {
    return {
      x: viewport.originX,
      y: viewport.originY,
      width: viewport.widthPx / viewport.cellSize,
      height: viewport.heightPx / viewport.cellSize,
    };
  }

  private worldToPixelRect(r: Rect, viewport: Viewport): Rect {
    return {
      x: (r.x - viewport.originX) * viewport.cellSize,
      y: (r.y - viewport.originY) * viewport.cellSize,
      width: r.width * viewport.cellSize,
      height: r.height * viewport.cellSize,
    };
  }

  private resolveColor(css: string): readonly [number, number, number, number] {
    let c = this.colorCache.get(css);
    if (!c) {
      c = parseColor(css);
      this.colorCache.set(css, c);
    }
    return c;
  }

  private integerWorldBounds(worldRect: Rect): Rect {
    const x0 = Math.floor(worldRect.x);
    const y0 = Math.floor(worldRect.y);
    const x1 = Math.ceil(worldRect.x + worldRect.width);
    const y1 = Math.ceil(worldRect.y + worldRect.height);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  private drawVector(
    ctx: Canvas2DContext,
    theme: CompiledTheme,
    cells: GridView,
    worldRect: Rect,
    pixelRect: Rect,
    viewport: Viewport,
    touchedChunks: Set<string>,
  ): number {
    let calls = 0;
    ctx.fillStyle = theme.background;
    ctx.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height);
    calls++;

    const iterRect = this.integerWorldBounds(worldRect);
    const runs: Run[] = [];
    cells.forEachChunkInRect(iterRect, (chunk) => {
      touchedChunks.add(`${chunk.cx},${chunk.cy}`);
      collectRuns(chunk, iterRect, runs);
    });

    const byState = new Map<StateId, Run[]>();
    for (const run of runs) {
      const list = byState.get(run.state);
      if (list) list.push(run);
      else byState.set(run.state, [run]);
    }

    for (const [state, list] of byState) {
      ctx.fillStyle = theme.palette(state, 0);
      for (const run of list) {
        const px = (run.x0 - viewport.originX) * viewport.cellSize;
        const py = (run.y - viewport.originY) * viewport.cellSize;
        const pw = (run.x1 - run.x0) * viewport.cellSize;
        ctx.fillRect(px, py, pw, viewport.cellSize);
        calls++;
      }
    }
    return calls;
  }

  private drawTile(
    ctx: Canvas2DContext,
    theme: CompiledTheme,
    cells: GridView,
    worldRect: Rect,
    pixelRect: Rect,
    viewport: Viewport,
    touchedChunks: Set<string>,
  ): number {
    const px0 = Math.round(pixelRect.x);
    const py0 = Math.round(pixelRect.y);
    const w = Math.max(1, Math.round(pixelRect.x + pixelRect.width) - px0);
    const h = Math.max(1, Math.round(pixelRect.y + pixelRect.height) - py0);
    const image = ctx.createImageData(w, h);
    const data = image.data;

    const bg = this.resolveColor(theme.background);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = bg[0];
      data[i + 1] = bg[1];
      data[i + 2] = bg[2];
      data[i + 3] = bg[3];
    }

    const iterRect = this.integerWorldBounds(worldRect);
    const cellPx = viewport.cellSize;
    cells.forEachChunkInRect(iterRect, (chunk) => {
      touchedChunks.add(`${chunk.cx},${chunk.cy}`);
      forEachCellInClip(chunk, iterRect, (wx, wy, state) => {
        const color = this.resolveColor(theme.palette(state, 0));
        const cellPx0 = (wx - viewport.originX) * viewport.cellSize - px0;
        const cellPy0 = (wy - viewport.originY) * viewport.cellSize - py0;
        const x0 = Math.max(0, Math.floor(cellPx0));
        const x1 = Math.min(w, Math.ceil(cellPx0 + cellPx));
        const y0 = Math.max(0, Math.floor(cellPy0));
        const y1 = Math.min(h, Math.ceil(cellPy0 + cellPx));
        for (let y = y0; y < y1; y++) {
          const rowOffset = y * w;
          for (let x = x0; x < x1; x++) {
            const idx = (rowOffset + x) * 4;
            data[idx] = color[0];
            data[idx + 1] = color[1];
            data[idx + 2] = color[2];
            data[idx + 3] = color[3];
          }
        }
      });
    });

    ctx.putImageData(image, px0, py0);
    return 1;
  }

  private requireCanvas(): CanvasLike {
    if (!this.canvas) throw new Error('canvas2d renderer: init() must be called first');
    return this.canvas;
  }

  private requireCtx(): Canvas2DContext {
    if (!this.ctx) throw new Error('canvas2d renderer: init() must be called first');
    return this.ctx;
  }

  private requireTheme(): CompiledTheme {
    if (!this.theme) throw new Error('canvas2d renderer: setTheme() must be called before draw()');
    return this.theme;
  }

  private requireViewport(): Viewport {
    if (!this.viewport) throw new Error('canvas2d renderer: setViewport() must be called before draw()');
    return this.viewport;
  }
}
