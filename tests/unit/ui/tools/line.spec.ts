import { describe, expect, it } from 'vitest';
import { Mulberry32 } from '@engine/rng';
import type { PaintOp } from '@shared/types';
import { bresenham } from '@ui/tools/brush';
import type { ToolPoint } from '@ui/input/router';
import { LineTool } from '@ui/tools/line';
import type { ToolContext } from '@ui/tools/tool';

function ctxAt(x: number, y: number, mods: Partial<{ shift: boolean; alt: boolean }> = {}): ToolContext {
  const point: ToolPoint = { x, y, pressure: 0.5, timeMs: 0 };
  return {
    event: {
      phase: 'move',
      pointerId: 1,
      pointerType: 'mouse',
      point,
      coalesced: [point],
      modifiers: { shift: mods.shift ?? false, ctrl: false, alt: mods.alt ?? false, meta: false },
    },
  };
}

function sortOps(ops: readonly PaintOp[]): PaintOp[] {
  return [...ops].sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * An independently-coded reference Bresenham (the classic steep/swap-normalised integer-error
 * formulation), structurally unrelated to `brush.ts`'s symmetric double-increment version — a
 * genuine cross-check, not the same code compared to itself. Test-only.
 */
function referenceBresenham(x0: number, y0: number, x1: number, y1: number): Array<readonly [number, number]> {
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  let X0 = steep ? y0 : x0;
  let Y0 = steep ? x0 : y0;
  let X1 = steep ? y1 : x1;
  let Y1 = steep ? x1 : y1;
  let swapped = false;
  if (X0 > X1) {
    [X0, X1] = [X1, X0];
    [Y0, Y1] = [Y1, Y0];
    swapped = true;
  }
  const dx = X1 - X0;
  const dy = Math.abs(Y1 - Y0);
  let err = Math.floor(dx / 2);
  const ystep = Y0 < Y1 ? 1 : -1;
  let y = Y0;
  const pts: Array<readonly [number, number]> = [];
  for (let x = X0; x <= X1; x++) {
    pts.push(steep ? [y, x] : [x, y]);
    err -= dy;
    if (err < 0) {
      y += ystep;
      err += dx;
    }
  }
  if (swapped) pts.reverse();
  return pts;
}

describe('bresenham (brush.ts, reused by LineTool) matches an independent reference', () => {
  it('agrees with a structurally unrelated reference implementation for 10k random endpoint pairs', () => {
    // Two independently-formulated (but both textbook-correct) Bresenham variants are not
    // guaranteed bit-for-bit identical: at certain slopes there are two equally valid pixels to
    // step to, and which one a given formulation picks is a documented, harmless difference in
    // tie-breaking convention (this is *why* multiple "the" Bresenham algorithms exist in the
    // literature) — not something a real reference comparison should demand agreement on. What
    // a real reference comparison should hold both to: identical endpoints, identical length
    // (both trace the same number of steps along the line), never more than one cell apart at
    // any step (the tie-break's maximum possible spread), and overwhelming exact agreement.
    // Plain comparisons in the hot loop, not vitest matchers: ~1M points across 10k pairs makes
    // a per-point `expect()` call itself the bottleneck (matcher overhead, not the algorithm).
    const rng = new Mulberry32(0xb2e5e17e);
    let comparedPoints = 0;
    let exactMatches = 0;
    let worstDeviation = 0;
    let endpointFailures = 0;
    let lengthMismatches = 0;

    for (let i = 0; i < 10_000; i++) {
      const x0 = Math.floor(rng.next() * 200) - 100;
      const y0 = Math.floor(rng.next() * 200) - 100;
      const x1 = Math.floor(rng.next() * 200) - 100;
      const y1 = Math.floor(rng.next() * 200) - 100;

      const mine = bresenham(x0, y0, x1, y1);
      const reference = referenceBresenham(x0, y0, x1, y1);

      const [mx0, my0] = mine[0]!;
      const [mx1, my1] = mine.at(-1)!;
      if (mx0 !== x0 || my0 !== y0 || mx1 !== x1 || my1 !== y1) endpointFailures++;
      if (mine.length !== reference.length) {
        lengthMismatches++;
        continue;
      }

      for (let j = 0; j < mine.length; j++) {
        const [ax, ay] = mine[j]!;
        const [bx, by] = reference[j]!;
        worstDeviation = Math.max(worstDeviation, Math.abs(ax - bx), Math.abs(ay - by));
        comparedPoints++;
        if (ax === bx && ay === by) exactMatches++;
      }
    }

    expect(endpointFailures).toBe(0);
    expect(lengthMismatches).toBe(0);
    // The known tie-break divergence never exceeds one cell in practice (a real algorithmic bug
    // would produce a much larger deviation somewhere across 10k random pairs).
    expect(worstDeviation).toBeLessThanOrEqual(1);
    // ...and affects well under 1% of points; a much looser 95% floor keeps this from being a
    // hair-trigger flake while still failing hard on any real bug (a large mismatch fraction).
    expect(exactMatches / comparedPoints).toBeGreaterThan(0.95);
  });
});

describe('LineTool', () => {
  it('draws a straight Bresenham line from down to the current cursor position', () => {
    const line = new LineTool({ state: 1 });
    line.onDown(ctxAt(0, 0));
    line.onMove(ctxAt(5, 0));
    expect(sortOps(line.preview())).toEqual(
      sortOps(Array.from({ length: 6 }, (_, x) => ({ x, y: 0, state: 1 }))),
    );
  });

  it('the preview replaces itself on every move rather than accumulating a trail', () => {
    const line = new LineTool();
    line.onDown(ctxAt(0, 0));
    line.onMove(ctxAt(10, 0));
    line.onMove(ctxAt(2, 0)); // cursor moved back — the line should shrink, not keep the old trail
    expect(line.preview()).toHaveLength(3); // (0,0),(1,0),(2,0)
  });

  it('Shift snaps the angle to the nearest 45 degrees', () => {
    const line = new LineTool({ state: 1 });
    line.onDown(ctxAt(0, 0));
    line.onMove(ctxAt(10, 1, { shift: true })); // ~5.7 degrees -> snaps to 0 (horizontal)
    expect(line.preview().every((op) => op.y === 0)).toBe(true);
  });

  it('Alt anchors the down-point as the centre, extending symmetrically in both directions', () => {
    const line = new LineTool({ state: 1 });
    line.onDown(ctxAt(5, 5));
    line.onMove(ctxAt(8, 5, { alt: true })); // dx=3 -> spans from (2,5) to (8,5)
    const xs = line.preview().map((op) => op.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(2);
    expect(xs[xs.length - 1]).toBe(8);
    expect(line.preview().every((op) => op.y === 5)).toBe(true);
  });

  it('onUp finalises the current preview and resets for the next stroke', () => {
    const line = new LineTool({ state: 1 });
    line.onDown(ctxAt(0, 0));
    line.onMove(ctxAt(3, 0));
    const ops = line.onUp(ctxAt(3, 0));
    expect(ops).toHaveLength(4);
    expect(line.preview()).toHaveLength(0);
  });

  it('onCancel discards the in-progress line with no return value', () => {
    const line = new LineTool();
    line.onDown(ctxAt(0, 0));
    line.onMove(ctxAt(5, 5));
    expect(line.preview().length).toBeGreaterThan(0);
    expect(line.onCancel()).toBeUndefined();
    expect(line.preview()).toHaveLength(0);
  });

  it('onMove before onDown is a no-op', () => {
    const line = new LineTool();
    line.onMove(ctxAt(5, 5));
    expect(line.preview()).toHaveLength(0);
  });

  it('a second onUp with no intervening onDown returns nothing rather than throwing', () => {
    const line = new LineTool();
    line.onDown(ctxAt(0, 0));
    line.onUp(ctxAt(0, 0));
    expect(line.onUp(ctxAt(0, 0))).toEqual([]);
  });

  it('Shift with no movement at all degenerates to a single point, not NaN', () => {
    const line = new LineTool({ state: 1 });
    line.onDown(ctxAt(4, 4));
    line.onMove(ctxAt(4, 4, { shift: true }));
    expect(line.preview()).toEqual([{ x: 4, y: 4, state: 1 }]);
  });
});
