import { describe, expect, it } from 'vitest';
import { DEFAULT_DARK_TOKENS } from '@themes/default/tokens';
import { binValues, drawHistogram } from '@ui/charts/histogram';

class FakeCtx {
  fillStyle = '';
  readonly fillRects: { x: number; y: number; w: number; h: number; style: string }[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects.push({ x, y, w, h, style: this.fillStyle });
  }
}

describe('binValues', () => {
  it('counts into equal-width bins over a nice domain', () => {
    const bins = binValues([1, 1, 1, 5, 5, 9], 3);
    expect(bins).toHaveLength(3);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(6);
    expect(bins.some((b) => b.count === 3)).toBe(true);
  });

  it('returns no bins for an empty series', () => {
    expect(binValues([], 8)).toEqual([]);
  });
});

describe('drawHistogram', () => {
  it('draws one bar per bin, taller bars for heavier counts', () => {
    const bins = binValues([0, 0, 0, 8], 4);
    const ctx = new FakeCtx();
    drawHistogram(ctx as unknown as CanvasRenderingContext2D, bins, { x: 0, y: 0, width: 200, height: 80 }, {
      fill: DEFAULT_DARK_TOKENS.color.accent,
    });
    expect(ctx.fillRects).toHaveLength(bins.length);
    const heights = ctx.fillRects.map((r) => r.h);
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  });
});
