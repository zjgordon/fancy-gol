import { describe, expect, it } from 'vitest';
import type { StatsWindowPoint } from '@shared/protocol';
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from '@themes/default/tokens';
import {
  Chart,
  ChartLoop,
  CHART_HZ,
  chartTokensFromSet,
  type ChartWindow,
} from '@ui/charts/chart';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

class FakeCtx {
  lineWidth = 1;
  strokeStyle = '';
  fillStyle = '';
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  transform = [1, 0, 0, 1, 0, 0];

  readonly fillRects: { style: string; x: number; y: number; w: number; h: number }[] = [];
  readonly fillTexts: { text: string; x: number; y: number; style: string }[] = [];
  readonly lineTos: { x: number; y: number }[] = [];
  readonly moveTos: { x: number; y: number }[] = [];
  strokeCount = 0;

  private path: { x: number; y: number }[] = [];

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = [a, b, c, d, e, f];
  }
  save(): void {}
  restore(): void {}
  clearRect(): void {}
  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    this.path = [{ x, y }];
    this.moveTos.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.path.push({ x, y });
    this.lineTos.push({ x, y });
  }
  arc(x: number, y: number): void {
    this.path.push({ x, y });
  }
  stroke(): void {
    this.strokeCount++;
  }
  fill(): void {}
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects.push({ style: this.fillStyle, x, y, w, h });
  }
  strokeRect(): void {}
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
  fillText(text: string, x: number, y: number): void {
    this.fillTexts.push({ text, x, y, style: this.fillStyle });
  }
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: () => null,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} }),
  } as unknown as HTMLCanvasElement;
}

function point(tick: number, population: number, births = 0, deaths = 0): StatsWindowPoint {
  return {
    tick,
    population,
    populationMin: population,
    populationMax: population,
    perState: new Uint32Array([0, population]),
    births,
    deaths,
    transitions: births + deaths,
    activity: births + deaths,
    density: 0.1,
    bbox: { x: 0, y: 0, width: 8, height: 8 },
    centroid: { x: 4, y: 4 },
    entropy: 0.5,
    hash: tick,
    tier: 0,
  };
}

function windowOf(n: number, opts?: { pop?: (t: number) => number; label?: string; downsampled?: boolean }): ChartWindow {
  const pop = opts?.pop ?? ((t) => 10 + (t % 7));
  const points = Array.from({ length: n }, (_, t) => point(t, pop(t), t % 3, t % 2));
  return {
    points,
    tier: opts?.downsampled ? 1 : 0,
    aggregated: Boolean(opts?.downsampled),
    downsampled: Boolean(opts?.downsampled),
    sourceCount: n,
    label: opts?.label ?? (opts?.downsampled ? 'tier 1 · LTTB' : 'tier 0 · exact'),
  };
}

function makeChart(
  overrides: { width?: number; height?: number; dpr?: number; yKind?: 'linear' | 'log'; loop?: ChartLoop | null } = {},
): { chart: Chart; ctx: FakeCtx; canvas: HTMLCanvasElement } {
  const ctx = new FakeCtx();
  const canvas = fakeCanvas();
  const chart = new Chart({
    canvas,
    ctx: ctx as unknown as CanvasRenderingContext2D,
    tokens: chartTokensFromSet(DEFAULT_DARK_TOKENS),
    width: overrides.width ?? 400,
    height: overrides.height ?? 200,
    dpr: overrides.dpr ?? 1,
    loop: overrides.loop ?? null,
    ...(overrides.yKind ? { yKind: overrides.yKind } : {}),
  });
  return { chart, ctx, canvas };
}

describe('chartTokensFromSet', () => {
  it('pulls roles from the token set so the chart never hardcodes a colour', () => {
    const t = chartTokensFromSet(DEFAULT_DARK_TOKENS);
    expect(t.accent).toBe(DEFAULT_DARK_TOKENS.color.accent);
    expect(t.fontSizeXs).toBe(DEFAULT_DARK_TOKENS.type.size.xs);
  });
});

describe('Chart', () => {
  it('sizes the backing store by dpr and draws in CSS pixels', () => {
    const { chart, ctx, canvas } = makeChart({ width: 200, height: 100, dpr: 2 });
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    chart.setData(windowOf(8));
    chart.draw();
    expect(ctx.transform[0]).toBe(2);
    expect(ctx.transform[3]).toBe(2);
  });

  it('shows a muted empty state when there are no samples', () => {
    const { chart, ctx } = makeChart();
    chart.draw();
    expect(ctx.fillTexts.some((t) => t.text === 'No samples')).toBe(true);
  });

  it('paints the downsampled label so an approximation is never shown as exact', () => {
    const { chart, ctx } = makeChart();
    chart.setData(windowOf(12, { downsampled: true, label: 'tier 2 · LTTB of 4096' }));
    chart.draw();
    expect(ctx.fillTexts.some((t) => t.text.includes('LTTB'))).toBe(true);
  });

  it('toggles a series from the legend and stops stroking it', () => {
    const { chart, ctx } = makeChart();
    chart.setData(windowOf(16));
    chart.draw();
    const before = ctx.strokeCount;
    chart.toggleSeries('births');
    ctx.strokeCount = 0;
    ctx.lineTos.length = 0;
    chart.draw();
    expect(chart.seriesHidden('births')).toBe(true);
    expect(ctx.strokeCount).toBeGreaterThan(0);
    expect(ctx.strokeCount).toBeLessThan(before);
  });

  it('brushes the X axis to zoom and resetZoom restores the full domain', () => {
    const { chart } = makeChart({ width: 400, height: 200 });
    chart.setData(windowOf(40));
    chart.draw();
    chart.pointerDown(80, 80);
    chart.pointerMove(220, 80);
    chart.pointerUp(220, 80);
    const zoomed = chart.xDomain();
    expect(zoomed).not.toBeNull();
    expect(zoomed![1]).toBeGreaterThan(zoomed![0]);
    chart.resetZoom();
    expect(chart.xDomain()).toBeNull();
  });

  it('draws a crosshair tooltip on hover', () => {
    const { chart, ctx } = makeChart();
    chart.setData(windowOf(20));
    chart.draw();
    chart.pointerMove(180, 90);
    expect(ctx.fillTexts.some((t) => t.text.startsWith('gen '))).toBe(true);
    expect(ctx.fillTexts.some((t) => t.text.startsWith('Population '))).toBe(true);
  });

  it('repaints with the new theme tokens and no reload', () => {
    const { chart, ctx } = makeChart();
    chart.setData(windowOf(10));
    chart.draw();
    const darkText = DEFAULT_DARK_TOKENS.color.text;
    expect(ctx.fillTexts.some((t) => t.style === darkText)).toBe(true);

    ctx.fillTexts.length = 0;
    chart.setTokens(chartTokensFromSet(DEFAULT_LIGHT_TOKENS));
    chart.draw();
    const lightText = DEFAULT_LIGHT_TOKENS.color.text;
    expect(lightText).not.toBe(darkText);
    expect(ctx.fillTexts.some((t) => t.style === lightText)).toBe(true);
    expect(ctx.fillRects.some((r) => r.style === DEFAULT_LIGHT_TOKENS.color.bg)).toBe(true);
  });

  it('log Y produces finite geometry for zeros and negatives', () => {
    const { chart, ctx } = makeChart({ yKind: 'log' });
    const points = [
      point(0, 0, 0, 0),
      point(1, -4, 0, 0),
      point(2, 8, 0, 0),
      point(3, 40, 0, 0),
    ];
    chart.setData({
      points,
      tier: 0,
      aggregated: false,
      downsampled: false,
      sourceCount: 4,
      label: 'tier 0 · exact',
    });
    chart.draw();
    expect(ctx.lineTos.length + ctx.moveTos.length).toBeGreaterThan(0);
    for (const p of [...ctx.moveTos, ...ctx.lineTos]) {
      expect(Number.isFinite(p.x), `x=${p.x}`).toBe(true);
      expect(Number.isFinite(p.y), `y=${p.y}`).toBe(true);
    }
  });
});

describe('ChartLoop', () => {
  it(`throttles redraws to ${CHART_HZ} Hz`, () => {
    const loop = new ChartLoop({
      hz: CHART_HZ,
      scheduler: { request: () => 1, cancel() {} },
      clock: { now: () => 0 },
    });
    const { chart, ctx } = makeChart({ loop });
    chart.setData(windowOf(8));
    expect(loop.step(0)).toBe(1);
    const afterFirst = ctx.strokeCount;
    chart.setData(windowOf(8));
    expect(loop.step(10)).toBe(0);
    expect(ctx.strokeCount).toBe(afterFirst);
    expect(loop.step(50)).toBe(1);
    expect(ctx.strokeCount).toBeGreaterThan(afterFirst);
    chart.dispose();
  });
});

describe('six live charts budget', () => {
  it.skipIf(UNDER_COVERAGE)('six charts together cost < 2 ms/frame', () => {
    class SilentCtx {
      lineWidth = 1;
      strokeStyle = '';
      fillStyle = '';
      font = '';
      textAlign = 'left';
      textBaseline = 'alphabetic';
      setTransform(): void {}
      save(): void {}
      restore(): void {}
      clearRect(): void {}
      beginPath(): void {}
      moveTo(): void {}
      lineTo(): void {}
      arc(): void {}
      stroke(): void {}
      fill(): void {}
      fillRect(): void {}
      strokeRect(): void {}
      measureText(text: string): { width: number } {
        return { width: text.length * 6 };
      }
      fillText(): void {}
    }

    const charts: Chart[] = [];
    for (let i = 0; i < 6; i++) {
      const chart = new Chart({
        canvas: fakeCanvas(),
        ctx: new SilentCtx() as unknown as CanvasRenderingContext2D,
        tokens: chartTokensFromSet(DEFAULT_DARK_TOKENS),
        width: 400,
        height: 180,
        loop: null,
      });
      chart.setData(windowOf(200));
      charts.push(chart);
    }
    for (let i = 0; i < 5; i++) {
      for (const c of charts) c.draw();
    }
    const samples: number[] = [];
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now();
      for (const c of charts) c.draw();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median, `${median.toFixed(3)} ms median for six charts`).toBeLessThan(2);
    for (const c of charts) c.dispose();
  });
});
