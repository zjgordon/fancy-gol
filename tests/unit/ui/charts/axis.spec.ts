import { describe, expect, it } from 'vitest';
import {
  drawAxes,
  formatTick,
  placeXLabels,
  placeYLabels,
  tokenPx,
  type PlotRect,
} from '@ui/charts/axis';
import { linearScale, timeScale } from '@ui/charts/scale';

function measure(text: string): number {
  return text.length * 6;
}

function plotFor(width: number, height = 200): PlotRect {
  return { x: 40, y: 24, width: width - 48, height: height - 48 };
}

function assertNoOverflow(labels: readonly { x: number; y: number; width: number }[], canvasW: number, canvasH: number): void {
  for (const lab of labels) {
    const left = lab.x - lab.width / 2;
    const right = lab.x + lab.width / 2;
    expect(left).toBeGreaterThanOrEqual(-0.5);
    expect(right).toBeLessThanOrEqual(canvasW + 0.5);
    expect(lab.y).toBeGreaterThanOrEqual(0);
    expect(lab.y).toBeLessThanOrEqual(canvasH);
  }
}

function assertNoXCollision(labels: readonly { x: number; width: number }[]): void {
  const sorted = [...labels].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    expect(prev.x + prev.width / 2 + 4).toBeLessThanOrEqual(next.x - next.width / 2 + 1e-6);
  }
}

describe('formatTick', () => {
  it('keeps small integers, shortens thousands, and blanks non-finite', () => {
    expect(formatTick(0)).toBe('0');
    expect(formatTick(42)).toBe('42');
    expect(formatTick(15000)).toBe('15k');
    expect(formatTick(2_000_000)).toBe('2M');
    expect(formatTick(Number.NaN)).toBe('');
  });
});

describe('tokenPx', () => {
  it('reads a resolved space token without the caller typing px', () => {
    expect(tokenPx('8px')).toBe(8);
    expect(tokenPx('not-a-size')).toBe(0);
  });
});

describe('placeXLabels', () => {
  it('never collides or overflows from 200 px to 1200 px wide', () => {
    for (const width of [200, 400, 800, 1200]) {
      const plot = plotFor(width);
      const scale = timeScale([0, 10_000], [plot.x, plot.x + plot.width]);
      const ticks = scale.ticks(12);
      const labels = placeXLabels(ticks, scale, plot, width, measure, 11);
      expect(labels.length).toBeGreaterThan(0);
      assertNoOverflow(labels, width, 200);
      assertNoXCollision(labels);
    }
  });

  it('keeps at least the domain ends on a crowded 200 px axis', () => {
    const width = 200;
    const plot = plotFor(width);
    const scale = timeScale([0, 100], [plot.x, plot.x + plot.width]);
    const labels = placeXLabels(scale.ticks(20), scale, plot, width, measure, 11);
    const texts = labels.map((l) => l.text);
    expect(texts[0]).toBe('0');
    expect(texts[texts.length - 1]).toBe('100');
  });
});

describe('placeYLabels', () => {
  it('drops overlapping ticks rather than stacking them', () => {
    const plot = plotFor(400, 120);
    const scale = linearScale([0, 100], [plot.y + plot.height, plot.y]);
    const labels = placeYLabels([0, 1, 2, 50, 98, 99, 100], scale, plot, 120, measure, 11, 36);
    for (let i = 1; i < labels.length; i++) {
      expect(Math.abs(labels[i]!.y - labels[i - 1]!.y)).toBeGreaterThanOrEqual(13);
    }
    for (const lab of labels) {
      expect(lab.y).toBeGreaterThanOrEqual(0);
      expect(lab.y).toBeLessThanOrEqual(120);
    }
  });
});

describe('drawAxes', () => {
  it('issues grid strokes and label fillTexts from the placed ticks', () => {
    const strokes: unknown[] = [];
    const fillTexts: { text: string }[] = [];
    const ctx = {
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {
        strokes.push(this.strokeStyle);
      },
      fillText(text: string) {
        fillTexts.push({ text });
      },
    };
    const plot = plotFor(400);
    const xScale = timeScale([0, 100], [plot.x, plot.x + plot.width]);
    const yScale = linearScale([0, 50], [plot.y + plot.height, plot.y]);
    const xLabels = placeXLabels([0, 50, 100], xScale, plot, 400, measure, 11);
    const yLabels = placeYLabels([0, 25, 50], yScale, plot, 200, measure, 11, 36);
    drawAxes({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      plot,
      xScale,
      yScale,
      xLabels,
      yLabels,
      xTicks: [0, 50, 100],
      yTicks: [0, 25, 50],
      palette: {
        text: 'text',
        muted: 'muted',
        grid: 'grid',
        axis: 'axis',
        font: '11px sans',
      },
    });
    expect(strokes.length).toBeGreaterThan(0);
    expect(fillTexts.map((t) => t.text)).toEqual([...yLabels, ...xLabels].map((l) => l.text));
  });
});
