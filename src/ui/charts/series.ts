/**
 * Series geometry (P2-D-2). Line, stepped, area, stacked-area, and the min/max
 * envelope band that keeps a downsampled chart honest. Pure layout lives next to
 * the stroke so a test can check totals without a canvas, and a canvas test can
 * check that those totals are what actually got filled.
 *
 * Stacked layers skip the reserved dead state. Their heights at each sample sum
 * to `population` — that is the multi-state chart's contract, not a visual guess.
 */
import { parseCssColor } from '@shared/color';
import type { StatsWindowPoint } from '@shared/protocol';
import { DEAD } from '@shared/types';
import type { Scale } from './scale';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function withChartAlpha(css: string, a: number): string {
  const p = parseCssColor(css);
  if (!p) return css;
  return `rgba(${p.r}, ${p.g}, ${p.b}, ${a})`;
}

export interface SeriesStroke {
  readonly stroke: string;
  readonly lineWidth?: number;
}

export interface SeriesFill {
  readonly fill: string;
  readonly stroke?: string;
  readonly lineWidth?: number;
}

export type SeriesValue = (point: StatsWindowPoint) => number;

function mapPoint(
  point: StatsWindowPoint,
  xScale: Scale,
  yScale: Scale,
  value: SeriesValue,
): { x: number; y: number } | null {
  const x = xScale.convert(point.tick);
  const y = yScale.convert(value(point));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** Open polyline through `value(point)`. */
export function drawLine(
  ctx: Canvas2DContext,
  points: readonly StatsWindowPoint[],
  xScale: Scale,
  yScale: Scale,
  value: SeriesValue,
  style: SeriesStroke,
): void {
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth ?? 1.5;
  ctx.beginPath();
  let started = false;
  for (const p of points) {
    const pt = mapPoint(p, xScale, yScale, value);
    if (!pt) continue;
    if (!started) {
      ctx.moveTo(pt.x, pt.y);
      started = true;
    } else {
      ctx.lineTo(pt.x, pt.y);
    }
  }
  if (started) ctx.stroke();
}

/** Horizontal-then-vertical steps — discrete generations, not a fake slope. */
export function drawStepped(
  ctx: Canvas2DContext,
  points: readonly StatsWindowPoint[],
  xScale: Scale,
  yScale: Scale,
  value: SeriesValue,
  style: SeriesStroke,
): void {
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth ?? 1.5;
  ctx.beginPath();
  let prev: { x: number; y: number } | null = null;
  for (const p of points) {
    const pt = mapPoint(p, xScale, yScale, value);
    if (!pt) continue;
    if (!prev) {
      ctx.moveTo(pt.x, pt.y);
    } else {
      ctx.lineTo(pt.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
    }
    prev = pt;
  }
  if (prev) ctx.stroke();
}

/** Area from `value` down to the scale's conversion of `baseline` (default 0). */
export function drawArea(
  ctx: Canvas2DContext,
  points: readonly StatsWindowPoint[],
  xScale: Scale,
  yScale: Scale,
  value: SeriesValue,
  style: SeriesFill,
  baseline = 0,
): void {
  const coords: { x: number; y: number }[] = [];
  for (const p of points) {
    const pt = mapPoint(p, xScale, yScale, value);
    if (pt) coords.push(pt);
  }
  if (coords.length === 0) return;
  const y0 = yScale.convert(baseline);
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  ctx.beginPath();
  ctx.moveTo(first.x, y0);
  for (const c of coords) ctx.lineTo(c.x, c.y);
  ctx.lineTo(last.x, y0);
  ctx.closePath();
  ctx.fillStyle = style.fill;
  ctx.fill();
  if (style.stroke) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth ?? 1.5;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i]!.x, coords[i]!.y);
    ctx.stroke();
  }
}

export interface StackedLayer {
  readonly state: number;
  /** This state's count at each sample. */
  readonly height: Float64Array;
  /** Cumulative top (sum of this layer and those below). */
  readonly top: Float64Array;
}

export interface StackedAreas {
  readonly layers: readonly StackedLayer[];
  /** Sum of live-state heights at each sample — must equal `population`. */
  readonly totals: Float64Array;
}

/**
 * Stack non-dead `perState` counts. Dead (state 0) is the background, not a
 * population band. Layers are bottom-up, so `layers[k].top[i]` is the running
 * sum through state `layers[k].state` at sample `i`.
 */
export function stackStateAreas(points: readonly StatsWindowPoint[]): StackedAreas {
  const n = points.length;
  let maxState = 0;
  for (const p of points) {
    const len = p.perState.length;
    if (len - 1 > maxState) maxState = len - 1;
  }
  const used: number[] = [];
  for (let s = DEAD + 1; s <= maxState; s++) {
    let any = false;
    for (const p of points) {
      if ((p.perState[s] ?? 0) > 0) {
        any = true;
        break;
      }
    }
    if (any) used.push(s);
  }
  const layers: StackedLayer[] = used.map((state) => ({
    state,
    height: new Float64Array(n),
    top: new Float64Array(n),
  }));
  const totals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const per = points[i]!.perState;
    let run = 0;
    for (let L = 0; L < layers.length; L++) {
      const layer = layers[L]!;
      const h = per[layer.state] ?? 0;
      layer.height[i] = h;
      run += h;
      layer.top[i] = run;
    }
    totals[i] = run;
  }
  return { layers, totals };
}

export function drawStackedArea(
  ctx: Canvas2DContext,
  points: readonly StatsWindowPoint[],
  xScale: Scale,
  yScale: Scale,
  stacked: StackedAreas,
  fills: readonly string[],
): void {
  const n = points.length;
  if (n === 0 || stacked.layers.length === 0) return;
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = xScale.convert(points[i]!.tick);

  for (let L = 0; L < stacked.layers.length; L++) {
    const layer = stacked.layers[L]!;
    const fill = fills[L % fills.length];
    if (!fill) continue;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const y = yScale.convert(layer.top[i]!);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      const below = L === 0 ? 0 : stacked.layers[L - 1]!.top[i]!;
      const x = xs[i]!;
      const y = yScale.convert(below);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      ctx.lineTo(x, y);
    }
    if (!started) continue;
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/**
 * Min/max envelope for aggregated tiers. A chart that draws only the mean of a
 * folded oscillation is lying; this band is the proof it is not.
 */
export function drawBand(
  ctx: Canvas2DContext,
  points: readonly StatsWindowPoint[],
  xScale: Scale,
  yScale: Scale,
  opts: {
    readonly min: SeriesValue;
    readonly max: SeriesValue;
    readonly fill: string;
    readonly stroke?: string;
  },
): void {
  const upper: { x: number; y: number }[] = [];
  const lower: { x: number; y: number }[] = [];
  for (const p of points) {
    const x = xScale.convert(p.tick);
    const yMax = yScale.convert(opts.max(p));
    const yMin = yScale.convert(opts.min(p));
    if (!Number.isFinite(x) || !Number.isFinite(yMax) || !Number.isFinite(yMin)) continue;
    upper.push({ x, y: yMax });
    lower.push({ x, y: yMin });
  }
  if (upper.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(upper[0]!.x, upper[0]!.y);
  for (let i = 1; i < upper.length; i++) ctx.lineTo(upper[i]!.x, upper[i]!.y);
  for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i]!.x, lower[i]!.y);
  ctx.closePath();
  ctx.fillStyle = opts.fill;
  ctx.fill();
  if (opts.stroke) {
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
