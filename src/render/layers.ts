/**
 * P3-A-1 — the offscreen layer stack for the Phase 3 compositor.
 *
 * Owns L0–L3 canvases (background → cells → effects → post). L4 overlay and L5 chrome are
 * deliberately *not* here: overlay must stay above post-process (PHASE_3 §2.1), and chrome is
 * DOM. Canvases are created once and resized in place — never reallocated per frame.
 */
export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
export type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The four compositor-owned layers, bottom to top. */
export const COMPOSITOR_LAYER_IDS = ['background', 'cells', 'effects', 'post'] as const;
export type CompositorLayerId = (typeof COMPOSITOR_LAYER_IDS)[number];

export interface LayerSurface {
  readonly id: CompositorLayerId;
  readonly canvas: CanvasLike;
  readonly ctx: Canvas2DContext;
}

/**
 * Creates a backing surface for one layer. Injected so Node / vitest doubles can stand in for
 * `OffscreenCanvas` (unavailable outside a browser) without pulling jsdom into the render path.
 */
export type CanvasFactory = (width: number, height: number) => CanvasLike;

/** Prefer `OffscreenCanvas`; fall back to a DOM canvas. Throws when neither exists — inject a factory. */
export function defaultCanvasFactory(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    return canvas;
  }
  throw new Error('layers: no OffscreenCanvas or document — pass a canvasFactory');
}

function require2d(canvas: CanvasLike, id: CompositorLayerId): Canvas2DContext {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`layers: getContext("2d") returned null for layer "${id}"`);
  return ctx;
}

/**
 * Four offscreen canvases, created once and resized in place. `allocationCount` counts canvas
 * *objects* created — setting `.width`/`.height` on an existing canvas reallocates its backing
 * store but must not bump this counter (P3-A-1 allocation assertion).
 */
export class LayerStack {
  private readonly factory: CanvasFactory;
  private readonly surfaces = new Map<CompositorLayerId, LayerSurface>();
  private widthPx = 0;
  private heightPx = 0;
  private _allocationCount = 0;
  private disposed = false;

  constructor(factory: CanvasFactory = defaultCanvasFactory) {
    this.factory = factory;
  }

  /** Allocate the four layer canvases at a 1×1 placeholder size. Idempotent. */
  init(): void {
    this.ensureAlive();
    if (this.surfaces.size === COMPOSITOR_LAYER_IDS.length) return;
    for (const id of COMPOSITOR_LAYER_IDS) {
      if (this.surfaces.has(id)) continue;
      const canvas = this.factory(1, 1);
      this._allocationCount += 1;
      this.surfaces.set(id, { id, canvas, ctx: require2d(canvas, id) });
    }
    this.widthPx = 1;
    this.heightPx = 1;
  }

  /**
   * Resize every layer's backing store to device-pixel dimensions. Returns `true` when the size
   * actually changed (callers use that to mark L0 dirty). Same canvas objects — no new allocation.
   */
  resize(widthPx: number, heightPx: number): boolean {
    this.ensureAlive();
    this.init();
    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));
    if (w === this.widthPx && h === this.heightPx) return false;
    for (const surface of this.surfaces.values()) {
      surface.canvas.width = w;
      surface.canvas.height = h;
    }
    this.widthPx = w;
    this.heightPx = h;
    return true;
  }

  get(id: CompositorLayerId): LayerSurface {
    this.ensureAlive();
    this.init();
    const surface = this.surfaces.get(id);
    if (!surface) throw new Error(`layers: missing layer "${id}" — init() first`);
    return surface;
  }

  get width(): number {
    return this.widthPx;
  }

  get height(): number {
    return this.heightPx;
  }

  /** Canvas objects created since construction. Never increases on a same-size or size-only resize. */
  get allocationCount(): number {
    return this._allocationCount;
  }

  dispose(): void {
    this.surfaces.clear();
    this.widthPx = 0;
    this.heightPx = 0;
    this.disposed = true;
  }

  private ensureAlive(): void {
    if (this.disposed) throw new Error('layers: LayerStack has been disposed');
  }
}
