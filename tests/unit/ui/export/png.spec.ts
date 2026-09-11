import { describe, expect, it } from 'vitest';
import { CHART_EXPORT_SCALE, paintAtScale } from '@ui/export/png';

class FakeCtx {
  transform: number[] = [1, 0, 0, 1, 0, 0];
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = [a, b, c, d, e, f];
  }
}

describe('paintAtScale', () => {
  it('builds a backing store that is scale × CSS size and draws in CSS units', () => {
    const painted: { w: number; h: number }[] = [];
    const ctx = new FakeCtx();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
    };
    const out = paintAtScale(160, 80, CHART_EXPORT_SCALE, (_ctx, w, h) => {
      painted.push({ w, h });
    }, () => canvas);
    expect(out.width).toBe(320);
    expect(out.height).toBe(160);
    expect(painted).toEqual([{ w: 160, h: 80 }]);
    expect(ctx.transform[0]).toBe(2);
  });
});
