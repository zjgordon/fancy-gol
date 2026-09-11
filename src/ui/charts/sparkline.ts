/**
 * Inline sparkline (P2-D-2). No axes, no legend — a child's status-bar pulse
 * and a library-card heartbeat. Same dpr-correct CSS-pixel space as {@link Chart}.
 */
import type { PlotRect } from './axis';
import { linearScale } from './scale';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SparklineStyle {
  readonly stroke: string;
  readonly fill?: string;
  readonly lineWidth?: number;
  readonly dot?: string;
}

function domainOf(values: readonly number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(lo <= hi)) return [0, 1];
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

/** Draw `values` left-to-right inside `rect`. Empty input is a no-op. */
export function drawSparkline(
  ctx: Canvas2DContext,
  values: readonly number[],
  rect: PlotRect,
  style: SparklineStyle,
): void {
  if (values.length === 0 || rect.width <= 0 || rect.height <= 0) return;
  const xScale = linearScale([0, Math.max(1, values.length - 1)], [rect.x, rect.x + rect.width]);
  const yScale = linearScale(domainOf(values), [rect.y + rect.height, rect.y]);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    const x = xScale.convert(i);
    const y = yScale.convert(v);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  if (pts.length === 0) return;

  if (style.fill) {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, rect.y + rect.height);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1]!.x, rect.y + rect.height);
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
  }

  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth ?? 1.25;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();

  if (style.dot) {
    const last = pts[pts.length - 1]!;
    ctx.fillStyle = style.dot;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.25, 0, Math.PI * 2);
    ctx.fill();
  }
}
