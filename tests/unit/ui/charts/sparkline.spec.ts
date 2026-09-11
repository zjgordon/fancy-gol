import { describe, expect, it } from 'vitest';
import { DEFAULT_DARK_TOKENS } from '@themes/default/tokens';
import { withChartAlpha } from '@ui/charts/series';
import { drawSparkline } from '@ui/charts/sparkline';

class FakeCtx {
  lineWidth = 1;
  strokeStyle = '';
  fillStyle = '';
  strokeCount = 0;
  fillCount = 0;
  readonly lineTos: { x: number; y: number }[] = [];
  beginPath(): void {}
  moveTo(): void {}
  lineTo(x: number, y: number): void {
    this.lineTos.push({ x, y });
  }
  closePath(): void {}
  stroke(): void {
    this.strokeCount++;
  }
  fill(): void {
    this.fillCount++;
  }
  arc(): void {}
}

describe('drawSparkline', () => {
  it('strokes values left-to-right and dots the latest sample', () => {
    const ctx = new FakeCtx();
    drawSparkline(
      ctx as unknown as CanvasRenderingContext2D,
      [1, 4, 2, 6],
      { x: 0, y: 0, width: 80, height: 20 },
      {
        stroke: DEFAULT_DARK_TOKENS.color.accent,
        fill: withChartAlpha(DEFAULT_DARK_TOKENS.color.accent, 0.2),
        dot: DEFAULT_DARK_TOKENS.color.accentStrong,
      },
    );
    expect(ctx.strokeCount).toBe(1);
    expect(ctx.fillCount).toBeGreaterThanOrEqual(2);
    expect(ctx.lineTos.length).toBeGreaterThan(0);
  });

  it('is a no-op on empty input', () => {
    const ctx = new FakeCtx();
    drawSparkline(ctx as unknown as CanvasRenderingContext2D, [], { x: 0, y: 0, width: 80, height: 20 }, {
      stroke: DEFAULT_DARK_TOKENS.color.accent,
    });
    expect(ctx.strokeCount).toBe(0);
  });
});
