/**
 * Phase-space trail (P2-D-2). Population vs births (or activity vs entropy) is
 * the chart that makes a chaotic rule look like a different animal from Conway.
 * The trail fade is a {@link FadeCurve} from the theme's motion signature, not a
 * literal, and it is a pure function of sample index — redrawing at 20 Hz with
 * the same window never shimmers.
 */
import type { Easing } from '@themes/types';
import type { StatsWindowPoint } from '@shared/protocol';
import type { PlotRect } from './axis';
import { CHART_HZ } from './chart';
import { linearScale } from './scale';
import { withChartAlpha } from './series';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type PhaseAccessor = (point: StatsWindowPoint) => number;

export interface PhaseStyle {
  readonly color: string;
  readonly lineWidth?: number;
}

export interface PhaseFade {
  /** Theme `MotionSignature.easings.*` — maps trail progress `0..1` to opacity. */
  readonly curve: Easing;
  /** Theme `MotionSignature.durationMs.*` — how long the tail stays visible. */
  readonly durationMs: number;
}

/** Samples kept in the fade window at `hz` (defaults to the shared chart cadence). */
export function trailLength(durationMs: number, hz = CHART_HZ): number {
  const ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return Math.max(2, Math.round((ms * hz) / 1000) || 2);
}

/**
 * Opacity of sample `index` in a trail of `count` points. Oldest samples outside
 * the motion-token window are 0; the newest is `curve(1)`.
 */
export function trailAlpha(index: number, count: number, trailLen: number, curve: Easing): number {
  if (count <= 1) return index === 0 ? curve(1) : 0;
  const start = Math.max(0, count - trailLen);
  if (index < start) return 0;
  const span = Math.max(1, count - 1 - start);
  const t = (index - start) / span;
  const a = curve(t);
  if (!Number.isFinite(a)) return 0;
  if (a < 0) return 0;
  if (a > 1) return 1;
  return a;
}

function minMax(values: readonly number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(lo <= hi)) return [0, 1];
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.15 : 1;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

export interface DrawPhaseOptions {
  readonly ctx: Canvas2DContext;
  readonly plot: PlotRect;
  readonly points: readonly StatsWindowPoint[];
  readonly x: PhaseAccessor;
  readonly y: PhaseAccessor;
  readonly fade: PhaseFade;
  readonly style: PhaseStyle;
  readonly hz?: number;
}

/**
 * Scatter/trail in phase space. Segments are stroked individually so each can
 * carry the motion-token alpha; the head is a brighter dot on the newest sample.
 */
export function drawPhase(opts: DrawPhaseOptions): void {
  const { ctx, plot, points, fade, style } = opts;
  const n = points.length;
  if (n === 0 || plot.width <= 0) return;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    xs.push(opts.x(p));
    ys.push(opts.y(p));
  }
  const xScale = linearScale(minMax(xs), [plot.x, plot.x + plot.width]);
  const yScale = linearScale(minMax(ys), [plot.y + plot.height, plot.y]);
  const len = trailLength(fade.durationMs, opts.hz ?? CHART_HZ);

  let prevX = NaN;
  let prevY = NaN;
  let prevA = 0;
  ctx.lineWidth = style.lineWidth ?? 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const px = xScale.convert(xs[i]!);
    const py = yScale.convert(ys[i]!);
    const a = trailAlpha(i, n, len, fade.curve);
    if (Number.isFinite(prevX) && Number.isFinite(prevY) && Number.isFinite(px) && Number.isFinite(py) && a > 0 && prevA > 0) {
      ctx.strokeStyle = withChartAlpha(style.color, Math.min(a, prevA));
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
    prevX = px;
    prevY = py;
    prevA = a;
  }

  const last = n - 1;
  if (last >= 0 && trailAlpha(last, n, len, fade.curve) > 0) {
    const hx = xScale.convert(xs[last]!);
    const hy = yScale.convert(ys[last]!);
    if (Number.isFinite(hx) && Number.isFinite(hy)) {
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
