import { describe, expect, it } from 'vitest';
import { Camera } from '@ui/camera';
import {
  GridLinesOverlay,
  SMOOTHSTEP,
  snapForCrispStroke,
  type GridLinesPalette,
} from '@ui/overlay/grid-lines';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

const PALETTE: GridLinesPalette = {
  minor: { r: 100, g: 100, b: 100 },
  decade: { r: 120, g: 120, b: 200 },
  origin: { r: 255, g: 80, b: 80 },
  badge: { r: 20, g: 20, b: 20 },
  badgeText: { r: 240, g: 240, b: 240 },
};

/**
 * A call-recording `CanvasRenderingContext2D` double — no backing pixel buffer (unlike
 * `tests/unit/render/canvas2d.spec.ts`'s `FakeContext`), since what this module's tests care
 * about is *which* lines/colours/text got issued and how many draw calls it took, not the
 * resulting pixels. Same "minimal but functionally real" discipline: `stroke()` actually
 * resolves the current path into a segment, not just a call count.
 */
class FakeCtx {
  lineWidth = 1;
  strokeStyle = '';
  fillStyle = '';
  font = '';
  textBaseline = '';

  readonly strokes: { style: string; x0: number; y0: number; x1: number; y1: number }[] = [];
  readonly fillTexts: { text: string; x: number; y: number; style: string }[] = [];
  readonly roundRects: { x: number; y: number; w: number; h: number }[] = [];
  saveCount = 0;
  restoreCount = 0;

  private path: { x: number; y: number }[] = [];

  save(): void {
    this.saveCount++;
  }
  restore(): void {
    this.restoreCount++;
  }
  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    this.path = [{ x, y }];
  }
  lineTo(x: number, y: number): void {
    this.path.push({ x, y });
  }
  stroke(): void {
    const [p0, p1] = this.path;
    if (p0 && p1) this.strokes.push({ style: this.strokeStyle, x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y });
  }
  fill(): void {}
  roundRect(x: number, y: number, w: number, h: number): void {
    this.roundRects.push({ x, y, w, h });
  }
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
  fillText(text: string, x: number, y: number): void {
    this.fillTexts.push({ text, x, y, style: this.fillStyle });
  }
}

function makeCamera(overrides: Partial<ConstructorParameters<typeof Camera>[0]> = {}): Camera {
  return new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 10, ...overrides });
}

describe('snapForCrispStroke', () => {
  it('always lands on a half-integer, for any input magnitude or sign', () => {
    for (const px of [0, 1, -1, 3.2, -3.2, 100.49, 100.51, -0.01, 12345.678]) {
      const snapped = snapForCrispStroke(px);
      expect(snapped - Math.floor(snapped)).toBeCloseTo(0.5, 9);
    }
  });
});

describe('GridLinesOverlay', () => {
  describe('zoom fade', () => {
    it('draws nothing below the fade threshold (cellSize < 6) — a hard cutoff, not wasted work', () => {
      const camera = makeCamera({ cellSize: 5.999 });
      const ctx = new FakeCtx();
      const overlay = new GridLinesOverlay(PALETTE);

      overlay.draw(ctx as unknown as CanvasRenderingContext2D, camera, 0);

      expect(ctx.strokes).toHaveLength(0);
    });

    it('is a smooth, monotonically increasing function of cellSize across the fade range, not a step', () => {
      const alphaAt = (cellSize: number): number => {
        const camera = makeCamera({ cellSize, originX: 100, originY: 100 }); // origin out of view
        const ctx = new FakeCtx();
        new GridLinesOverlay(PALETTE).draw(ctx as unknown as CanvasRenderingContext2D, camera, 0);
        const minorStroke = ctx.strokes.find((s) => s.style.includes('100, 100, 100'));
        return minorStroke ? Number(/[\d.]+\)$/.exec(minorStroke.style)![0].slice(0, -1)) : 0;
      };

      const samples = [6.1, 7, 8, 9, 9.9, 10, 12].map(alphaAt);
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]!);
      }
      expect(samples[0]).toBeGreaterThan(0);
      expect(samples[samples.length - 1]).toBeCloseTo(0.12, 9); // MINOR_ALPHA, fully faded in
    });

    it('threading a custom fade curve changes the result — the curve is injected, not hardcoded', () => {
      const camera = makeCamera({ cellSize: 8, originX: 100, originY: 100 });
      const alwaysZero = new GridLinesOverlay(PALETTE, { fadeCurve: () => 0 });
      const ctx = new FakeCtx();
      alwaysZero.draw(ctx as unknown as CanvasRenderingContext2D, camera, 0);
      expect(ctx.strokes).toHaveLength(0); // opacity 0 throughout -> drawGrid never runs

      const alwaysOne = new GridLinesOverlay(PALETTE, { fadeCurve: () => 1 });
      const ctx2 = new FakeCtx();
      alwaysOne.draw(ctx2 as unknown as CanvasRenderingContext2D, camera, 0);
      expect(ctx2.strokes.length).toBeGreaterThan(0);
    });
  });

  describe('line classification', () => {
    it('draws minor, decade, and origin lines with distinct, correctly ordered alpha', () => {
      const camera = makeCamera({ cellSize: 20, originX: -25, originY: -25, widthPx: 500, heightPx: 500 });
      const ctx = new FakeCtx();
      new GridLinesOverlay(PALETTE).draw(ctx as unknown as CanvasRenderingContext2D, camera, 0);

      const alphaOf = (rgb: string) => Number(/[\d.]+\)$/.exec(rgb)![0].slice(0, -1));
      const originStrokes = ctx.strokes.filter((s) => s.style.startsWith('rgba(255, 80, 80'));
      const decadeStrokes = ctx.strokes.filter((s) => s.style.startsWith('rgba(120, 120, 200'));
      const minorStrokes = ctx.strokes.filter((s) => s.style.startsWith('rgba(100, 100, 100'));

      expect(originStrokes.length).toBeGreaterThan(0); // x=0 and y=0 are in view
      expect(decadeStrokes.length).toBeGreaterThan(0); // x=/-y=+-10, 20 etc.
      expect(minorStrokes.length).toBeGreaterThan(0);

      expect(alphaOf(originStrokes[0]!.style)).toBeGreaterThan(alphaOf(decadeStrokes[0]!.style));
      expect(alphaOf(decadeStrokes[0]!.style)).toBeGreaterThan(alphaOf(minorStrokes[0]!.style));
    });

    it('labels the origin only when it is in view and reasonably opaque', () => {
      const inView = makeCamera({ cellSize: 20, originX: -10, originY: -10 });
      const ctxIn = new FakeCtx();
      new GridLinesOverlay(PALETTE).draw(ctxIn as unknown as CanvasRenderingContext2D, inView, 0);
      expect(ctxIn.fillTexts.some((f) => f.text === '(0, 0)')).toBe(true);

      const outOfView = makeCamera({ cellSize: 20, originX: 1000, originY: 1000 });
      const ctxOut = new FakeCtx();
      new GridLinesOverlay(PALETTE).draw(ctxOut as unknown as CanvasRenderingContext2D, outOfView, 0);
      expect(ctxOut.fillTexts.some((f) => f.text === '(0, 0)')).toBe(false);

      const barelyFadedIn = makeCamera({ cellSize: 6.05, originX: -10, originY: -10 });
      const ctxFaint = new FakeCtx();
      new GridLinesOverlay(PALETTE).draw(ctxFaint as unknown as CanvasRenderingContext2D, barelyFadedIn, 0);
      expect(ctxFaint.fillTexts.some((f) => f.text === '(0, 0)')).toBe(false);
    });
  });

  describe('crispness', () => {
    it('every stroked line lands on a half-integer device pixel, at any effective DPR', () => {
      // Two cameras describing "the same CSS content" at DPR 1 and DPR 2: doubling widthPx,
      // heightPx and cellSize together is exactly what a DPR-2 backing store looks like for
      // the same visible CSS viewport (P1-A-1: Camera already works in device px).
      for (const dpr of [1, 2, 3]) {
        const camera = makeCamera({ widthPx: 800 * dpr, heightPx: 600 * dpr, cellSize: 10 * dpr });
        const ctx = new FakeCtx();
        new GridLinesOverlay(PALETTE).draw(ctx as unknown as CanvasRenderingContext2D, camera, 0);
        expect(ctx.strokes.length).toBeGreaterThan(0);
        for (const s of ctx.strokes) {
          // A vertical line's crisp axis is x (x0 === x1); a horizontal line's is y. The other
          // pair of endpoints just spans the viewport edge-to-edge and isn't snapped.
          const crisp = s.x0 === s.x1 ? s.x0 : s.y0;
          expect(crisp - Math.floor(crisp)).toBeCloseTo(0.5, 9);
        }
      }
    });
  });

  describe('the "you are here" badge', () => {
    it('is fully visible right after a camera change, and fades out over 600ms of inactivity', () => {
      const camera = makeCamera();
      const overlay = new GridLinesOverlay(PALETTE);
      const badgeTextOf = (ctx: FakeCtx) => ctx.fillTexts.find((f) => f.text.includes('→'));

      const ctx0 = new FakeCtx();
      overlay.draw(ctx0 as unknown as CanvasRenderingContext2D, camera, 0);
      expect(badgeTextOf(ctx0)).toBeDefined();
      expect(ctx0.roundRects).toHaveLength(1);

      const ctx300 = new FakeCtx();
      overlay.draw(ctx300 as unknown as CanvasRenderingContext2D, camera, 300);
      expect(badgeTextOf(ctx300)).toBeDefined(); // half-faded, still drawn

      const ctx650 = new FakeCtx();
      overlay.draw(ctx650 as unknown as CanvasRenderingContext2D, camera, 650);
      expect(badgeTextOf(ctx650)).toBeUndefined(); // fully faded out past 600ms
    });

    it('a camera change resets the fade-out timer', () => {
      const camera = makeCamera();
      const overlay = new GridLinesOverlay(PALETTE);
      const badgeTextOf = (ctx: FakeCtx) => ctx.fillTexts.find((f) => f.text.includes('→'));

      overlay.draw(new FakeCtx() as unknown as CanvasRenderingContext2D, camera, 0);
      overlay.draw(new FakeCtx() as unknown as CanvasRenderingContext2D, camera, 650); // faded out

      camera.panBy(50, 0); // fresh activity
      const ctx = new FakeCtx();
      overlay.draw(ctx as unknown as CanvasRenderingContext2D, camera, 651);
      expect(badgeTextOf(ctx)).toBeDefined();
    });
  });

  describe('performance', () => {
    it('draws a worst-case 1080p frame (cellSize just above the fade threshold) in well under 1ms of CPU dispatch time', () => {
      // This measures CPU-side canvas-API dispatch against a cheap fake context, the same
      // honest scope P0-H-2's frame-time budget documents — not real GPU raster time.
      const camera = makeCamera({ widthPx: 1920, heightPx: 1080, cellSize: 6.1 });
      const overlay = new GridLinesOverlay(PALETTE);
      const ctx = new FakeCtx();

      overlay.draw(ctx as unknown as CanvasRenderingContext2D, camera, 0); // warm up
      const start = performance.now();
      overlay.draw(ctx as unknown as CanvasRenderingContext2D, camera, 16);
      const elapsedMs = performance.now() - start;

      expect(ctx.strokes.length).toBeGreaterThan(100); // a real worst-case line count, not a no-op
      // V8 coverage instrumentation adds per-call overhead that dwarfs this budget on its own —
      // same reason `simulation.spec.ts`'s and `collector.spec.ts`'s wall-clock budgets skip
      // under `VITEST_COVERAGE`. The line-count assertion above still holds under coverage.
      if (!UNDER_COVERAGE) expect(elapsedMs).toBeLessThan(1);
    });
  });
});

describe('SMOOTHSTEP', () => {
  it('is 0 at t=0, 1 at t=1, 0.5 at the midpoint, and clamps outside [0,1]', () => {
    expect(SMOOTHSTEP(0)).toBe(0);
    expect(SMOOTHSTEP(1)).toBe(1);
    expect(SMOOTHSTEP(0.5)).toBeCloseTo(0.5, 9);
    expect(SMOOTHSTEP(-5)).toBe(0);
    expect(SMOOTHSTEP(5)).toBe(1);
  });
});
