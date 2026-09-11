/**
 * Histogram binning and bars (P2-D-2). Equal-width bins over a nice domain so a
 * per-state snapshot or a population distribution reads as counts, not a sparkline
 * turned on its side.
 */
import type { PlotRect } from './axis';
import { linearScale, niceDomain } from './scale';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface HistogramBin {
  readonly x0: number;
  readonly x1: number;
  readonly count: number;
}

/** Equal-width bins. Degenerate input collapses to a single bin covering the value. */
export function binValues(values: readonly number[], binCount: number): HistogramBin[] {
  const k = Math.max(1, binCount | 0);
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    n++;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (n === 0) return [];
  const [d0, d1] = niceDomain(lo, hi, k);
  const span = d1 - d0;
  const width = span > 0 ? span / k : 1;
  const counts = new Uint32Array(k);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    let i = Math.floor((v - d0) / width);
    if (i < 0) i = 0;
    if (i >= k) i = k - 1;
    counts[i]!++;
  }
  const bins: HistogramBin[] = [];
  for (let i = 0; i < k; i++) {
    bins.push({ x0: d0 + i * width, x1: d0 + (i + 1) * width, count: counts[i]! });
  }
  return bins;
}

export interface HistogramStyle {
  readonly fill: string;
  readonly gap?: number;
}

export function drawHistogram(
  ctx: Canvas2DContext,
  bins: readonly HistogramBin[],
  rect: PlotRect,
  style: HistogramStyle,
): void {
  if (bins.length === 0 || rect.width <= 0) return;
  const x0 = bins[0]!.x0;
  const x1 = bins[bins.length - 1]!.x1;
  let max = 1;
  for (const b of bins) if (b.count > max) max = b.count;
  const xScale = linearScale([x0, x1], [rect.x, rect.x + rect.width]);
  const yScale = linearScale([0, max], [rect.y + rect.height, rect.y]);
  const gap = style.gap ?? 1;
  const base = yScale.convert(0);
  ctx.fillStyle = style.fill;
  for (const b of bins) {
    const left = xScale.convert(b.x0) + gap / 2;
    const right = xScale.convert(b.x1) - gap / 2;
    const top = yScale.convert(b.count);
    const w = Math.max(1, right - left);
    const h = Math.max(0, base - top);
    ctx.fillRect(left, top, w, h);
  }
}
