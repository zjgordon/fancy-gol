/**
 * Pixel-crisp PNG snapshots (P2-D-4). Charts redraw at 2× rather than
 * stretching a 1× bitmap. Grid-view export copies the live scene canvas.
 */

export const CHART_EXPORT_SCALE = 2;

export interface SnapshotCanvas {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  toBlob?(callback: (blob: Blob | null) => void, type?: string): void;
}

export async function canvasToPngBlob(canvas: SnapshotCanvas): Promise<Blob> {
  if (!canvas.toBlob) throw new Error('canvas.toBlob is not available');
  return new Promise((resolve, reject) => {
    canvas.toBlob?.((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

/** Draw `paint` onto a fresh canvas whose backing store is `css × scale`. */
export function paintAtScale(
  cssWidth: number,
  cssHeight: number,
  scale: number,
  paint: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number) => void,
  createCanvas: () => SnapshotCanvas = () => document.createElement('canvas'),
): SnapshotCanvas {
  const canvas = createCanvas();
  const w = Math.max(1, Math.round(cssWidth * scale));
  const h = Math.max(1, Math.round(cssHeight * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context required for PNG export');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  paint(ctx, cssWidth, cssHeight);
  return canvas;
}
