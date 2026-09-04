import { describe, expect, it } from 'vitest';
import { Camera } from '@ui/camera';
import { DEFAULT_MARCH_PERIOD_MS, SelectionOverlay, type SelectionOverlaySource } from '@ui/overlay/selection';

/** A call-recording `CanvasRenderingContext2D` double — same discipline as `grid-lines.spec.ts`'s. */
class FakeCtx {
  lineWidth = 1;
  strokeStyle = '';
  lineDashOffset = 0;

  readonly strokes: { x: number; y: number; w: number; h: number; dashOffset: number; style: string }[] = [];
  private pendingDashOffset = 0;

  save(): void {}
  restore(): void {}
  setLineDash(_segments: number[]): void {
    this.pendingDashOffset = this.lineDashOffset;
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.strokes.push({ x, y, w, h, dashOffset: this.lineDashOffset, style: this.strokeStyle });
    void this.pendingDashOffset;
  }
}

function camera(): Camera {
  return new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 10 });
}

function source(overrides: Partial<SelectionOverlaySource> = {}): SelectionOverlaySource {
  return { marqueeRect: null, selectedRect: null, ...overrides };
}

describe('SelectionOverlay', () => {
  it('draws nothing when there is no marquee and no selection', () => {
    const overlay = new SelectionOverlay();
    const ctx = new FakeCtx();
    overlay.draw(ctx as unknown as CanvasRenderingContext2D, camera(), source(), 0);
    expect(ctx.strokes).toHaveLength(0);
  });

  it('draws the marquee rectangle with a static (non-animated) dash offset', () => {
    const overlay = new SelectionOverlay();
    const rect = { x: 2, y: 3, width: 5, height: 4 };

    const ctxA = new FakeCtx();
    overlay.draw(ctxA as unknown as CanvasRenderingContext2D, camera(), source({ marqueeRect: rect }), 0);
    const ctxB = new FakeCtx();
    overlay.draw(ctxB as unknown as CanvasRenderingContext2D, camera(), source({ marqueeRect: rect }), 5000);

    expect(ctxA.strokes).toHaveLength(1);
    expect(ctxA.strokes[0]!.dashOffset).toBeCloseTo(0, 9);
    expect(ctxB.strokes[0]!.dashOffset).toBeCloseTo(0, 9); // the marquee itself never marches
  });

  it('the selection outline marches over time', () => {
    const overlay = new SelectionOverlay();
    const rect = { x: 0, y: 0, width: 10, height: 10 };

    const early = new FakeCtx();
    overlay.draw(early as unknown as CanvasRenderingContext2D, camera(), source({ selectedRect: rect }), 0);
    const later = new FakeCtx();
    overlay.draw(later as unknown as CanvasRenderingContext2D, camera(), source({ selectedRect: rect }), 300);

    expect(early.strokes[0]!.dashOffset).toBeCloseTo(0, 9);
    expect(later.strokes[0]!.dashOffset).not.toBe(0);
  });

  it('reduced motion stops the march: the dash offset stays 0 regardless of elapsed time', () => {
    const overlay = new SelectionOverlay({ reducedMotion: () => true });
    const rect = { x: 0, y: 0, width: 10, height: 10 };

    for (const nowMs of [0, 300, 10_000]) {
      const ctx = new FakeCtx();
      overlay.draw(ctx as unknown as CanvasRenderingContext2D, camera(), source({ selectedRect: rect }), nowMs);
      expect(ctx.strokes[0]!.dashOffset).toBeCloseTo(0, 9);
    }
  });

  it('the march period is injected, not a literal — a different period changes the offset for the same time', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const fast = new SelectionOverlay({ marchPeriodMs: 100 });
    const slow = new SelectionOverlay({ marchPeriodMs: DEFAULT_MARCH_PERIOD_MS * 100 });

    const ctxFast = new FakeCtx();
    fast.draw(ctxFast as unknown as CanvasRenderingContext2D, camera(), source({ selectedRect: rect }), 250);
    const ctxSlow = new FakeCtx();
    slow.draw(ctxSlow as unknown as CanvasRenderingContext2D, camera(), source({ selectedRect: rect }), 250);

    expect(ctxFast.strokes[0]!.dashOffset).not.toBe(ctxSlow.strokes[0]!.dashOffset);
  });

  it('draws both the marquee and a prior selection at once (a new drag in progress, old selection still visible)', () => {
    const overlay = new SelectionOverlay();
    const ctx = new FakeCtx();
    overlay.draw(
      ctx as unknown as CanvasRenderingContext2D,
      camera(),
      source({ marqueeRect: { x: 0, y: 0, width: 2, height: 2 }, selectedRect: { x: 5, y: 5, width: 3, height: 3 } }),
      0,
    );
    expect(ctx.strokes).toHaveLength(2);
  });
});
