/**
 * Axis layout and drawing (P2-D-1). Nice ticks come from {@link scale.ts}; this file decides
 * which of them actually fit, then paints labels and gridlines. Collision is solved by dropping
 * overlapping X labels rather than shrinking type — a 200 px chart stays legible, it does not
 * sprout 4 px numerals.
 *
 * Every colour and size is a resolved token handed in by the chart host. No literals here.
 */
import { snapForCrispStroke } from '@ui/overlay/grid-lines';
import type { Scale } from './scale';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PlotRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedLabel {
  readonly text: string;
  readonly value: number;
  /** Draw-anchor X (centre for X-axis, right-edge for Y-axis). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface AxisPalette {
  readonly text: string;
  readonly muted: string;
  readonly grid: string;
  readonly axis: string;
  readonly font: string;
}

/** Parse a token like `8px` / `11px` into a CSS-pixel number. Non-numeric tokens become 0. */
export function tokenPx(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compact tick text: integers stay integers, thousands become `k`, millions `M`,
 * tiny magnitudes go scientific. Short on purpose — overflow is a failed chart.
 */
export function formatTick(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (Number.isInteger(n) && a < 10000) return String(n);
  if (a >= 1e6) return `${sign}${trimFloat(a / 1e6)}M`;
  if (a >= 1000) return `${sign}${trimFloat(a / 1000)}k`;
  if (a < 0.01) return n.toExponential(0);
  return trimFloat(n);
}

function trimFloat(n: number): string {
  const s = n.toPrecision(3);
  if (!s.includes('e') && s.includes('.')) {
    return String(Number(s));
  }
  return String(Number(n.toPrecision(3)));
}

const LABEL_GAP = 4;

/**
 * Place X-axis labels so none collide and none overflow the canvas. Drops interior ticks
 * first; keeps the domain ends when they still fit after clamping.
 */
export function placeXLabels(
  ticks: readonly number[],
  scale: Scale,
  plot: PlotRect,
  canvasWidth: number,
  measure: (text: string) => number,
  fontSize: number,
): PlacedLabel[] {
  const y = plot.y + plot.height + fontSize + 2;
  const candidates: PlacedLabel[] = [];
  for (const value of ticks) {
    const text = formatTick(value);
    if (!text) continue;
    const width = measure(text);
    const rawX = scale.convert(value);
    const minX = width / 2;
    const maxX = canvasWidth - width / 2;
    const x = clamp(rawX, minX, maxX);
    if (x < plot.x - width / 2 - 1 || x > plot.x + plot.width + width / 2 + 1) continue;
    candidates.push({ text, value, x, y, width });
  }
  return greedilyKeep(candidates, (a, b) => {
    const a0 = a.x - a.width / 2;
    const a1 = a.x + a.width / 2;
    const b0 = b.x - b.width / 2;
    const b1 = b.x + b.width / 2;
    return a1 + LABEL_GAP <= b0 || b1 + LABEL_GAP <= a0;
  });
}

/**
 * Place Y-axis labels so none collide and none overflow the canvas vertically.
 * Anchor is the right edge, sitting in the left gutter.
 */
export function placeYLabels(
  ticks: readonly number[],
  scale: Scale,
  plot: PlotRect,
  canvasHeight: number,
  measure: (text: string) => number,
  fontSize: number,
  gutterRight: number,
): PlacedLabel[] {
  const lo = Math.max(fontSize * 0.6, plot.y);
  const hi = Math.min(canvasHeight - fontSize * 0.4, plot.y + plot.height);
  const candidates: PlacedLabel[] = [];
  for (const value of ticks) {
    const text = formatTick(value);
    if (!text) continue;
    const width = measure(text);
    const rawY = scale.convert(value);
    const y = clamp(rawY, lo, hi);
    const x = gutterRight;
    candidates.push({ text, value, x, y, width });
  }
  return greedilyKeep(candidates, (a, b) => Math.abs(a.y - b.y) >= fontSize + 2);
}

function greedilyKeep(
  candidates: readonly PlacedLabel[],
  fits: (a: PlacedLabel, b: PlacedLabel) => boolean,
): PlacedLabel[] {
  if (candidates.length === 0) return [];
  const kept: PlacedLabel[] = [];
  const first = candidates[0]!;
  const last = candidates[candidates.length - 1]!;
  kept.push(first);
  for (let i = 1; i < candidates.length - 1; i++) {
    const c = candidates[i]!;
    if (kept.every((k) => fits(k, c))) kept.push(c);
  }
  if (first !== last && kept.every((k) => fits(k, last))) kept.push(last);
  else if (first !== last) {
    // Prefer the domain end over the last interior tick that collides with it.
    while (kept.length > 1 && !fits(kept[kept.length - 1]!, last)) kept.pop();
    if (kept.every((k) => fits(k, last))) kept.push(last);
  }
  return kept;
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export interface DrawAxesOptions {
  readonly ctx: Canvas2DContext;
  readonly plot: PlotRect;
  readonly xScale: Scale;
  readonly yScale: Scale;
  readonly xLabels: readonly PlacedLabel[];
  readonly yLabels: readonly PlacedLabel[];
  readonly palette: AxisPalette;
  readonly xTicks: readonly number[];
  readonly yTicks: readonly number[];
}

/** Gridlines + axes + tick labels. Drawn in CSS pixels; the host has already applied dpr. */
export function drawAxes(opts: DrawAxesOptions): void {
  const { ctx, plot, xScale, yScale, xLabels, yLabels, palette, xTicks, yTicks } = opts;
  ctx.save();
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of xTicks) {
    const x = snapForCrispStroke(xScale.convert(t));
    if (x < plot.x || x > plot.x + plot.width) continue;
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
  }
  for (const t of yTicks) {
    const y = snapForCrispStroke(yScale.convert(t));
    if (y < plot.y || y > plot.y + plot.height) continue;
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
  }
  ctx.stroke();

  ctx.strokeStyle = palette.axis;
  ctx.beginPath();
  const ax = snapForCrispStroke(plot.x);
  const ay = snapForCrispStroke(plot.y + plot.height);
  ctx.moveTo(ax, plot.y);
  ctx.lineTo(ax, plot.y + plot.height);
  ctx.moveTo(plot.x, ay);
  ctx.lineTo(plot.x + plot.width, ay);
  ctx.stroke();

  ctx.font = palette.font;
  ctx.fillStyle = palette.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (const lab of yLabels) ctx.fillText(lab.text, lab.x, lab.y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const lab of xLabels) ctx.fillText(lab.text, lab.x, lab.y);
  ctx.restore();
}

export { snapForCrispStroke };
