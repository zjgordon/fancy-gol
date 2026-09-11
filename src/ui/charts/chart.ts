/**
 * Canvas chart host (P2-D-1). Owns the surface, the scales, the legend, the crosshair, and
 * brush-to-zoom. Series geometry (line, area, stacked, band) lives in {@link series.ts};
 * this host calls those renderers so a downsampled window always shows its min/max envelope.
 *
 * Data is a P2-C-6 `statsWindow` reply — never an engine `Series`. Approximations are labelled
 * on the plot. Colours and type come from a resolved {@link ChartTokens} snapshot so a theme
 * switch is `setTokens` + `draw`, not a reload.
 *
 * Charts opt into a shared {@link ChartLoop} throttled at {@link CHART_HZ} (20). The simulation
 * can tick faster than that; a human cannot read faster than that.
 */
import type { StatsWindowPoint } from '@shared/protocol';
import type { TokenSet } from '@themes/types';
import {
  drawAxes,
  formatTick,
  placeXLabels,
  placeYLabels,
  snapForCrispStroke,
  tokenPx,
  type PlotRect,
} from './axis';
import { linearScale, logScale, niceTicks, timeScale, type Scale } from './scale';
import { drawBand, drawLine, withChartAlpha } from './series';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Charts refresh at 20 Hz — faster than a glance, slower than a wasted paint. */
export const CHART_HZ = 20;

export interface Clock {
  now(): number;
}

export const REAL_CLOCK: Clock = { now: () => performance.now() };

export interface FrameScheduler {
  request(fn: () => void): number;
  cancel(handle: number): void;
}

export const RAF_FRAME_SCHEDULER: FrameScheduler = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface ChartTokens {
  readonly bg: string;
  readonly surface: string;
  readonly border: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly danger: string;
  readonly success: string;
  readonly fontFamily: string;
  readonly fontFamilyMono: string;
  readonly fontSizeXs: string;
  readonly fontSizeSm: string;
  readonly fontWeightRegular: number;
  readonly space2: string;
  readonly space3: string;
}

export function chartTokensFromSet(set: TokenSet): ChartTokens {
  return {
    bg: set.color.bg,
    surface: set.color.surface,
    border: set.color.border,
    text: set.color.text,
    muted: set.color.muted,
    accent: set.color.accent,
    accentStrong: set.color.accentStrong,
    danger: set.color.danger,
    success: set.color.success,
    fontFamily: set.type.fontFamily,
    fontFamilyMono: set.type.fontFamilyMono,
    fontSizeXs: set.type.size.xs,
    fontSizeSm: set.type.size.sm,
    fontWeightRegular: set.type.weight.regular,
    space2: set.space['2'],
    space3: set.space['3'],
  };
}

export type SeriesColorRole =
  | 'accent'
  | 'accentStrong'
  | 'danger'
  | 'success'
  | 'muted'
  | 'text';

export interface ChartSeriesDef {
  readonly id: string;
  readonly label: string;
  readonly color: SeriesColorRole;
  readonly value: (point: StatsWindowPoint) => number;
}

/** The three traces a stats chart shows before P2-D-2 adds stacked state areas. */
export const DEFAULT_CHART_SERIES: readonly ChartSeriesDef[] = [
  { id: 'population', label: 'Population', color: 'accent', value: (p) => p.population },
  { id: 'births', label: 'Births', color: 'success', value: (p) => p.births },
  { id: 'deaths', label: 'Deaths', color: 'danger', value: (p) => p.deaths },
];

/** The labelled window a chart consumes — the `statsWindow` reply, minus the correlation id. */
export interface ChartWindow {
  readonly points: readonly StatsWindowPoint[];
  readonly tier: 0 | 1 | 2 | 3;
  readonly aggregated: boolean;
  readonly downsampled: boolean;
  readonly sourceCount: number;
  readonly label: string;
}

export interface ChartOptions {
  readonly canvas: HTMLCanvasElement;
  /** Injected because jsdom's `getContext` is unimplemented. */
  readonly ctx?: Canvas2DContext;
  readonly tokens: ChartTokens;
  readonly dpr?: number;
  readonly width?: number;
  readonly height?: number;
  readonly series?: readonly ChartSeriesDef[];
  readonly yKind?: 'linear' | 'log';
  readonly loop?: ChartLoop | null;
}

interface LegendHit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function colorOf(tokens: ChartTokens, role: SeriesColorRole): string {
  return tokens[role];
}

function finiteMinMax(lo: number, hi: number, fallback: readonly [number, number]): [number, number] {
  if (!(lo <= hi)) return [fallback[0], fallback[1]];
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

function scanDomains(
  points: readonly StatsWindowPoint[],
  series: readonly ChartSeriesDef[],
  hidden: ReadonlySet<string>,
): { x: [number, number]; y: [number, number] } {
  let xLo = Infinity;
  let xHi = -Infinity;
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const p of points) {
    if (p.tick < xLo) xLo = p.tick;
    if (p.tick > xHi) xHi = p.tick;
    if (p.populationMin < yLo) yLo = p.populationMin;
    if (p.populationMax > yHi) yHi = p.populationMax;
    for (const s of series) {
      if (hidden.has(s.id)) continue;
      const v = s.value(p);
      if (!Number.isFinite(v)) continue;
      if (v < yLo) yLo = v;
      if (v > yHi) yHi = v;
    }
  }
  return { x: finiteMinMax(xLo, xHi, [0, 1]), y: finiteMinMax(yLo, yHi, [0, 1]) };
}

/**
 * Shared 20 Hz redraw. Every live chart joins one loop so six panels do not schedule six rAFs.
 */
export class ChartLoop {
  private readonly charts = new Set<Chart>();
  private readonly scheduler: FrameScheduler;
  private readonly clock: Clock;
  private readonly intervalMs: number;
  private handle = 0;
  private lastDraw = Number.NEGATIVE_INFINITY;

  constructor(
    opts: { scheduler?: FrameScheduler; clock?: Clock; hz?: number } = {},
  ) {
    this.scheduler = opts.scheduler ?? RAF_FRAME_SCHEDULER;
    this.clock = opts.clock ?? REAL_CLOCK;
    this.intervalMs = 1000 / (opts.hz ?? CHART_HZ);
  }

  add(chart: Chart): void {
    this.charts.add(chart);
    this.arm();
  }

  remove(chart: Chart): void {
    this.charts.delete(chart);
    if (this.charts.size === 0) this.stop();
  }

  stop(): void {
    if (this.handle !== 0) {
      this.scheduler.cancel(this.handle);
      this.handle = 0;
    }
  }

  /** Test helper: run one throttle decision at `nowMs` without the scheduler. */
  step(nowMs: number): number {
    if (nowMs - this.lastDraw + 1e-6 < this.intervalMs) return 0;
    this.lastDraw = nowMs;
    let n = 0;
    for (const c of this.charts) {
      if (c.isDirty()) {
        c.draw();
        n++;
      }
    }
    return n;
  }

  private arm(): void {
    if (this.handle !== 0 || this.charts.size === 0) return;
    // `sync` stays true only for the duration of `request()`. A scheduler that
    // fires inline (tests) must not re-arm here — that would recurse forever.
    let sync = true;
    this.handle = this.scheduler.request(() => {
      this.handle = 0;
      this.step(this.clock.now());
      if (!sync && this.charts.size > 0) this.arm();
    });
    sync = false;
  }
}

export class Chart {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: Canvas2DContext;
  private tokens: ChartTokens;
  private dpr: number;
  private cssWidth = 0;
  private cssHeight = 0;
  private series: readonly ChartSeriesDef[];
  private hidden = new Set<string>();
  private data: ChartWindow | null = null;
  private yKind: 'linear' | 'log';
  private xZoom: readonly [number, number] | null = null;
  private dirty = true;
  private plot: PlotRect = { x: 0, y: 0, width: 0, height: 0 };
  private legendHits: LegendHit[] = [];
  private pointerX: number | null = null;
  private pointerY: number | null = null;
  private brush: { x0: number; x1: number } | null = null;
  private readonly loop: ChartLoop | null;
  private xScale: Scale | null = null;
  private yScale: Scale | null = null;
  private unbind: (() => void) | null = null;

  constructor(opts: ChartOptions) {
    this.canvas = opts.canvas;
    const ctx = opts.ctx ?? opts.canvas.getContext('2d');
    if (!ctx) throw new Error('Chart needs a 2D canvas context (inject ctx under jsdom)');
    this.ctx = ctx;
    this.tokens = opts.tokens;
    this.dpr = opts.dpr ?? 1;
    this.series = opts.series ?? DEFAULT_CHART_SERIES;
    this.yKind = opts.yKind ?? 'linear';
    this.loop = opts.loop ?? null;
    this.resize(opts.width ?? 320, opts.height ?? 200, this.dpr);
    this.bindPointer();
    this.loop?.add(this);
  }

  dispose(): void {
    this.loop?.remove(this);
    this.unbind?.();
    this.unbind = null;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markDirty(): void {
    this.dirty = true;
  }

  setTokens(tokens: ChartTokens): void {
    this.tokens = tokens;
    this.dirty = true;
  }

  setYKind(kind: 'linear' | 'log'): void {
    this.yKind = kind;
    this.dirty = true;
  }

  setData(data: ChartWindow): void {
    this.data = data;
    this.dirty = true;
  }

  toggleSeries(id: string): void {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
    this.dirty = true;
  }

  seriesHidden(id: string): boolean {
    return this.hidden.has(id);
  }

  resetZoom(): void {
    this.xZoom = null;
    this.dirty = true;
  }

  xDomain(): readonly [number, number] | null {
    return this.xZoom;
  }

  /**
   * Redraw at `scale` device pixels per CSS pixel, copy off, then restore.
   * Used by P2-D-4 so a chart PNG is pixel-crisp at 2× instead of a stretched 1× bitmap.
   */
  snapshotAtScale(
    scale: number,
    copy: (source: HTMLCanvasElement) => HTMLCanvasElement,
  ): HTMLCanvasElement {
    const prevW = this.cssWidth;
    const prevH = this.cssHeight;
    const prevDpr = this.dpr;
    this.resize(prevW, prevH, scale);
    this.draw();
    const dest = copy(this.canvas);
    this.resize(prevW, prevH, prevDpr);
    this.draw();
    return dest;
  }

  cssSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  resize(cssWidth: number, cssHeight: number, dpr = this.dpr): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = dpr > 0 ? dpr : 1;
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    const style = 'style' in this.canvas ? this.canvas.style : undefined;
    if (style) {
      style.width = `${this.cssWidth}px`;
      style.height = `${this.cssHeight}px`;
    }
    this.dirty = true;
  }

  pointerDown(cssX: number, cssY: number): void {
    const hit = this.hitLegend(cssX, cssY);
    if (hit) {
      this.toggleSeries(hit.id);
      this.draw();
      return;
    }
    if (this.inPlot(cssX, cssY)) {
      this.brush = { x0: cssX, x1: cssX };
      this.pointerX = cssX;
      this.pointerY = cssY;
      this.dirty = true;
      this.draw();
    }
  }

  pointerMove(cssX: number, cssY: number): void {
    this.pointerX = cssX;
    this.pointerY = cssY;
    if (this.brush) this.brush = { x0: this.brush.x0, x1: cssX };
    this.dirty = true;
    this.draw();
  }

  pointerUp(cssX: number, cssY: number): void {
    if (this.brush && this.xScale) {
      const dx = Math.abs(cssX - this.brush.x0);
      const minBrush = tokenPx(this.tokens.space2);
      if (dx >= minBrush) {
        const a = this.xScale.invert(this.brush.x0);
        const b = this.xScale.invert(cssX);
        this.xZoom = a < b ? [a, b] : [b, a];
      }
    }
    this.brush = null;
    this.pointerX = cssX;
    this.pointerY = cssY;
    this.dirty = true;
    this.draw();
  }

  pointerLeave(): void {
    this.pointerX = null;
    this.pointerY = null;
    this.brush = null;
    this.dirty = true;
    this.draw();
  }

  draw(): void {
    const ctx = this.ctx;
    const t = this.tokens;
    const w = this.cssWidth;
    const h = this.cssHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    const space2 = tokenPx(t.space2);
    const space3 = tokenPx(t.space3);
    const fontXs = tokenPx(t.fontSizeXs);
    const fontSm = tokenPx(t.fontSizeSm);
    const legendH = fontSm + space2;
    const font = `${t.fontWeightRegular} ${t.fontSizeXs} ${t.fontFamily}`;
    ctx.font = font;

    const yTicksHint = 5;
    const points = this.data?.points;
    const domains = points && points.length > 0 ? scanDomains(points, this.series, this.hidden) : null;
    const yTickValues = domains ? niceTicks(domains.y[0], domains.y[1], yTicksHint) : [0, 1];
    let maxYw = 0;
    for (const v of yTickValues) {
      const tw = ctx.measureText(formatTick(v)).width;
      if (tw > maxYw) maxYw = tw;
    }
    const left = Math.max(space3 + maxYw, space3 * 2);
    const right = space3;
    const top = space2 + legendH;
    const bottom = space2 + fontXs + space2;
    this.plot = {
      x: left,
      y: top,
      width: Math.max(1, w - left - right),
      height: Math.max(1, h - top - bottom),
    };

    this.drawLegend(ctx, fontSm, space2);
    this.layoutScales(domains);

    if (!this.xScale || !this.yScale || !points || points.length === 0) {
      this.drawEmpty(ctx, font);
      this.dirty = false;
      return;
    }

    const xTicks = this.xScale.ticks(Math.max(2, Math.floor(this.plot.width / 80)));
    const yTicks = this.yScale.ticks(yTicksHint);
    const xLabels = placeXLabels(
      xTicks,
      this.xScale,
      this.plot,
      w,
      (s) => ctx.measureText(s).width,
      fontXs,
    );
    const yLabels = placeYLabels(
      yTicks,
      this.yScale,
      this.plot,
      h,
      (s) => ctx.measureText(s).width,
      fontXs,
      left - space2,
    );

    drawAxes({
      ctx,
      plot: this.plot,
      xScale: this.xScale,
      yScale: this.yScale,
      xLabels,
      yLabels,
      xTicks,
      yTicks,
      palette: {
        text: t.text,
        muted: t.muted,
        grid: withChartAlpha(t.border, 0.45),
        axis: t.border,
        font,
      },
    });

    this.drawSeries(ctx, points);
    this.drawBrush(ctx);
    this.drawCrosshair(ctx, points, font);
    this.drawSourceLabel(ctx, fontXs, space2);
    this.dirty = false;
  }

  private makeYScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
    if (this.yKind === 'log') return logScale(domain, range);
    return linearScale(domain, range);
  }

  private layoutScales(domains: { x: [number, number]; y: [number, number] } | null): void {
    const plot = this.plot;
    const yRange: [number, number] = [plot.y + plot.height, plot.y];
    const xRange: [number, number] = [plot.x, plot.x + plot.width];
    if (!domains) {
      this.xScale = timeScale([0, 1], xRange);
      this.yScale = this.makeYScale([0, 1], yRange);
      return;
    }
    this.xScale = timeScale(this.xZoom ?? domains.x, xRange);
    this.yScale = this.makeYScale(domains.y, yRange);
  }

  private drawSeries(ctx: Canvas2DContext, points: readonly StatsWindowPoint[]): void {
    const xScale = this.xScale!;
    const yScale = this.yScale!;
    const data = this.data;
    const showBand =
      Boolean(data) &&
      (data!.tier >= 1 || data!.aggregated || data!.downsampled);
    if (showBand) {
      drawBand(ctx, points, xScale, yScale, {
        min: (p) => p.populationMin,
        max: (p) => p.populationMax,
        fill: withChartAlpha(this.tokens.accent, 0.22),
      });
    }
    for (const s of this.series) {
      if (this.hidden.has(s.id)) continue;
      drawLine(ctx, points, xScale, yScale, s.value, {
        stroke: colorOf(this.tokens, s.color),
        lineWidth: 1.5,
      });
    }
  }

  private drawLegend(ctx: Canvas2DContext, fontSm: number, space2: number): void {
    const t = this.tokens;
    ctx.font = `${t.fontWeightRegular} ${t.fontSizeSm} ${t.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let x = tokenPx(t.space3);
    const y = space2 + fontSm / 2;
    const swatch = Math.max(6, fontSm * 0.55);
    this.legendHits = [];
    for (const s of this.series) {
      const hidden = this.hidden.has(s.id);
      const labelW = ctx.measureText(s.label).width;
      const w = swatch + 4 + labelW + space2;
      ctx.fillStyle = hidden ? t.muted : colorOf(t, s.color);
      ctx.fillRect(x, y - swatch / 2, swatch, swatch);
      ctx.fillStyle = hidden ? t.muted : t.text;
      ctx.fillText(s.label, x + swatch + 4, y);
      this.legendHits.push({ id: s.id, x, y: y - fontSm / 2, w, h: fontSm + 2 });
      x += w;
    }
  }

  private drawEmpty(ctx: Canvas2DContext, font: string): void {
    const t = this.tokens;
    const plot = this.plot;
    ctx.strokeStyle = t.border;
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.width, plot.height);
    ctx.fillStyle = t.muted;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No samples', plot.x + plot.width / 2, plot.y + plot.height / 2);
  }

  private drawBrush(ctx: Canvas2DContext): void {
    if (!this.brush) return;
    const plot = this.plot;
    const x0 = clamp(Math.min(this.brush.x0, this.brush.x1), plot.x, plot.x + plot.width);
    const x1 = clamp(Math.max(this.brush.x0, this.brush.x1), plot.x, plot.x + plot.width);
    ctx.fillStyle = withChartAlpha(this.tokens.accent, 0.18);
    ctx.fillRect(x0, plot.y, Math.max(1, x1 - x0), plot.height);
  }

  private drawCrosshair(ctx: Canvas2DContext, points: readonly StatsWindowPoint[], font: string): void {
    if (this.pointerX === null || this.pointerY === null || this.brush) return;
    if (!this.inPlot(this.pointerX, this.pointerY) || !this.xScale || !this.yScale) return;
    const plot = this.plot;
    const x = snapForCrispStroke(clamp(this.pointerX, plot.x, plot.x + plot.width));
    ctx.strokeStyle = this.tokens.accentStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
    ctx.stroke();

    const tick = this.xScale.invert(this.pointerX);
    const nearest = nearestPoint(points, tick);
    if (!nearest) return;

    const nx = this.xScale.convert(nearest.tick);
    ctx.fillStyle = this.tokens.accent;
    for (const s of this.series) {
      if (this.hidden.has(s.id)) continue;
      const ny = this.yScale.convert(s.value(nearest));
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      ctx.beginPath();
      ctx.arc(nx, ny, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const lines: string[] = [`gen ${nearest.tick}`];
    for (const s of this.series) {
      if (this.hidden.has(s.id)) continue;
      lines.push(`${s.label} ${formatTick(s.value(nearest))}`);
    }
    this.drawTooltip(ctx, lines, this.pointerX, this.pointerY, font);
  }

  private drawTooltip(
    ctx: Canvas2DContext,
    lines: readonly string[],
    px: number,
    py: number,
    font: string,
  ): void {
    const t = this.tokens;
    const space2 = tokenPx(t.space2);
    ctx.font = font;
    let boxW = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > boxW) boxW = w;
    }
    const lineH = tokenPx(t.fontSizeXs) + 2;
    const boxH = lines.length * lineH + space2;
    boxW += space2 * 2;
    let x = px + space2;
    let y = py - boxH - space2;
    if (x + boxW > this.cssWidth) x = px - boxW - space2;
    if (y < 0) y = py + space2;
    ctx.fillStyle = t.bg;
    ctx.strokeStyle = t.border;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeRect(x + 0.5, y + 0.5, boxW, boxH);
    ctx.fillStyle = t.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let ty = y + space2 / 2;
    for (const line of lines) {
      ctx.fillText(line, x + space2, ty);
      ty += lineH;
    }
  }

  private drawSourceLabel(ctx: Canvas2DContext, fontXs: number, space2: number): void {
    const label = this.data?.label;
    if (!label) return;
    const t = this.tokens;
    ctx.font = `${t.fontWeightRegular} ${t.fontSizeXs} ${t.fontFamilyMono}`;
    const w = ctx.measureText(label).width + space2;
    const x = this.plot.x + this.plot.width - w;
    const y = this.plot.y + space2;
    ctx.fillStyle = withChartAlpha(t.surface, 0.9);
    ctx.fillRect(x, y, w, fontXs + 4);
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(label, this.plot.x + this.plot.width - space2 / 2, y + 2);
  }

  private inPlot(x: number, y: number): boolean {
    const p = this.plot;
    return x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height;
  }

  private hitLegend(x: number, y: number): LegendHit | null {
    for (const hit of this.legendHits) {
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) return hit;
    }
    return null;
  }

  private bindPointer(): void {
    const el = this.canvas;
    if (typeof el.addEventListener !== 'function') return;
    const toCss = (e: PointerEvent): { x: number; y: number } => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      const p = toCss(e);
      this.pointerDown(p.x, p.y);
    };
    const move = (e: PointerEvent) => {
      const p = toCss(e);
      this.pointerMove(p.x, p.y);
    };
    const up = (e: PointerEvent) => {
      const p = toCss(e);
      this.pointerUp(p.x, p.y);
    };
    const leave = () => this.pointerLeave();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', leave);
    this.unbind = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointerleave', leave);
    };
  }
}

function nearestPoint(points: readonly StatsWindowPoint[], tick: number): StatsWindowPoint | null {
  if (points.length === 0) return null;
  let best = points[0]!;
  let bestD = Math.abs(best.tick - tick);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const d = Math.abs(p.tick - tick);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
