import { describe, expect, it } from 'vitest';
import type { StatsWindowPoint } from '@shared/protocol';
import { DEFAULT_DARK_TOKENS } from '@themes/default/tokens';
import { linearScale, timeScale } from '@ui/charts/scale';
import {
  drawArea,
  drawBand,
  drawLine,
  drawStackedArea,
  drawStepped,
  stackStateAreas,
  withChartAlpha,
} from '@ui/charts/series';

class FakeCtx {
  lineWidth = 1;
  strokeStyle = '';
  fillStyle = '';
  readonly lineTos: { x: number; y: number }[] = [];
  readonly moveTos: { x: number; y: number }[] = [];
  readonly fills: { style: string; path: { x: number; y: number }[] }[] = [];
  strokeCount = 0;
  private path: { x: number; y: number }[] = [];

  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    this.path.push({ x, y });
    this.moveTos.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.path.push({ x, y });
    this.lineTos.push({ x, y });
  }
  closePath(): void {}
  stroke(): void {
    this.strokeCount++;
  }
  fill(): void {
    this.fills.push({ style: this.fillStyle, path: this.path.slice() });
  }
}

function point(tick: number, population: number, perState: number[], extra: Partial<StatsWindowPoint> = {}): StatsWindowPoint {
  return {
    tick,
    population,
    populationMin: extra.populationMin ?? population,
    populationMax: extra.populationMax ?? population,
    perState: Uint32Array.from(perState),
    births: extra.births ?? 0,
    deaths: extra.deaths ?? 0,
    transitions: extra.transitions ?? 0,
    activity: extra.activity ?? 0,
    density: extra.density ?? 0,
    bbox: extra.bbox ?? { x: 0, y: 0, width: 1, height: 1 },
    centroid: extra.centroid ?? { x: 0, y: 0 },
    entropy: extra.entropy ?? 0,
    hash: extra.hash ?? tick,
    tier: extra.tier ?? 0,
  };
}

const plot = { x: 0, y: 0, width: 100, height: 100 };

describe('stackStateAreas', () => {
  it('sums live states to total population at every sample — no gaps', () => {
    const points = [
      point(0, 10, [90, 4, 6]),
      point(1, 15, [85, 7, 8]),
      point(2, 9, [91, 9, 0]),
    ];
    const stacked = stackStateAreas(points);
    expect(stacked.layers.map((l) => l.state)).toEqual([1, 2]);
    for (let i = 0; i < points.length; i++) {
      expect(stacked.totals[i]).toBe(points[i]!.population);
      let run = 0;
      for (const layer of stacked.layers) {
        run += layer.height[i]!;
        expect(layer.top[i]).toBe(run);
      }
      expect(run).toBe(points[i]!.population);
    }
  });

  it('skips the dead state so the background is not a population band', () => {
    const stacked = stackStateAreas([point(0, 3, [100, 3])]);
    expect(stacked.layers).toHaveLength(1);
    expect(stacked.layers[0]!.state).toBe(1);
    expect(stacked.totals[0]).toBe(3);
  });
});

describe('drawStackedArea', () => {
  it('fills each layer once, sharing the boundary so bands neither gap nor overdraw', () => {
    const points = [point(0, 10, [0, 4, 6]), point(1, 10, [0, 4, 6])];
    const stacked = stackStateAreas(points);
    const xScale = timeScale([0, 1], [plot.x, plot.x + plot.width]);
    const yScale = linearScale([0, 10], [plot.y + plot.height, plot.y]);
    const ctx = new FakeCtx();
    const fills = [
      withChartAlpha(DEFAULT_DARK_TOKENS.color.accent, 0.85),
      withChartAlpha(DEFAULT_DARK_TOKENS.color.success, 0.85),
    ];
    drawStackedArea(ctx as unknown as CanvasRenderingContext2D, points, xScale, yScale, stacked, fills);
    expect(ctx.fills).toHaveLength(2);
    expect(ctx.fills[0]!.style).toBe(fills[0]);
    expect(ctx.fills[1]!.style).toBe(fills[1]);
    // Shared boundary: top of layer 0 equals bottom of layer 1 at each sample x.
    const x0 = xScale.convert(0);
    const top0 = ctx.fills[0]!.path.filter((p) => p.x === x0).map((p) => p.y);
    const top1 = ctx.fills[1]!.path.filter((p) => p.x === x0).map((p) => p.y);
    expect(top0).toContain(yScale.convert(4));
    expect(top0).toContain(yScale.convert(0));
    expect(top1).toContain(yScale.convert(10));
    expect(top1).toContain(yScale.convert(4));
  });
});

describe('drawBand', () => {
  it('renders a min/max envelope from aggregated tier 1–3 data that contains the mean', () => {
    const points = [1, 2, 3].map((tier) =>
      point(tier, 20, [0, 20], { tier: tier as 1 | 2 | 3, populationMin: 10, populationMax: 40 }),
    );
    const xScale = timeScale([1, 3], [0, 100]);
    const yScale = linearScale([0, 40], [100, 0]);
    const ctx = new FakeCtx();
    drawBand(ctx as unknown as CanvasRenderingContext2D, points, xScale, yScale, {
      min: (p) => p.populationMin,
      max: (p) => p.populationMax,
      fill: withChartAlpha(DEFAULT_DARK_TOKENS.color.accent, 0.22),
    });
    expect(ctx.fills).toHaveLength(1);
    const path = ctx.fills[0]!.path;
    const meanY = yScale.convert(20);
    const maxY = yScale.convert(40);
    const minY = yScale.convert(10);
    expect(maxY).toBeLessThan(meanY);
    expect(meanY).toBeLessThan(minY);
    expect(path.some((p) => p.y === maxY)).toBe(true);
    expect(path.some((p) => p.y === minY)).toBe(true);
    for (const p of path) {
      expect(p.y).toBeGreaterThanOrEqual(maxY);
      expect(p.y).toBeLessThanOrEqual(minY);
    }
  });
});

describe('drawLine / drawStepped / drawArea', () => {
  it('strokes a polyline, a stepped path, and a closed area', () => {
    const points = [point(0, 1, [0, 1]), point(1, 3, [0, 3]), point(2, 2, [0, 2])];
    const xScale = timeScale([0, 2], [0, 100]);
    const yScale = linearScale([0, 4], [100, 0]);
    const stroke = DEFAULT_DARK_TOKENS.color.accent;

    const line = new FakeCtx();
    drawLine(line as unknown as CanvasRenderingContext2D, points, xScale, yScale, (p) => p.population, { stroke });
    expect(line.strokeCount).toBe(1);
    expect(line.lineTos.length).toBeGreaterThan(0);

    const step = new FakeCtx();
    drawStepped(step as unknown as CanvasRenderingContext2D, points, xScale, yScale, (p) => p.population, { stroke });
    expect(step.lineTos.length).toBeGreaterThan(line.lineTos.length);

    const area = new FakeCtx();
    drawArea(
      area as unknown as CanvasRenderingContext2D,
      points,
      xScale,
      yScale,
      (p) => p.population,
      { fill: withChartAlpha(stroke, 0.3), stroke },
    );
    expect(area.fills).toHaveLength(1);
    expect(area.strokeCount).toBe(1);
  });
});
