/**
 * P3-E-2 — small offscreen surfaces for composited passes (ADR-012).
 *
 * Composited passes bake their resources (a noise tile, a scanline pattern, a downsample chain)
 * into offscreen canvases at activation or resize, then only *draw* them per frame. Canvases come
 * from an injectable factory so headless tests can count and inspect them without a browser.
 */
import { defaultCanvasFactory, type Canvas2DContext, type CanvasFactory, type CanvasLike } from '../layers';

export interface Surface {
  readonly canvas: CanvasLike;
  readonly ctx: Canvas2DContext;
}

export type { CanvasFactory };

export function createSurface(
  factory: CanvasFactory | undefined,
  width: number,
  height: number,
): Surface {
  const canvas = (factory ?? defaultCanvasFactory)(Math.max(1, width | 0), Math.max(1, height | 0));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('effects: getContext("2d") returned null for an offscreen surface');
  return { canvas, ctx };
}

/** Drop a surface's backing store now rather than waiting for GC (leak-tested over theme switches). */
export function releaseSurface(surface: Surface | null): void {
  if (!surface) return;
  surface.canvas.width = 0;
  surface.canvas.height = 0;
}
