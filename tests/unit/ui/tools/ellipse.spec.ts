import { describe, expect, it } from 'vitest';
import type { ToolPoint } from '@ui/input/router';
import { EllipseTool, midpointEllipseQuadrant } from '@ui/tools/ellipse';
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

describe('midpointEllipseQuadrant', () => {
  it('is symmetric in all four quadrants once mirrored, for a range of radii', () => {
    const radiiCases: ReadonlyArray<readonly [number, number]> = [
      [10, 6],
      [6, 10],
      [1, 1],
      [20, 20],
      [15, 4],
    ];
    for (const [rx, ry] of radiiCases) {
      const quadrant = midpointEllipseQuadrant(rx, ry);
      const full = new Set<string>();
      for (const [qx, qy] of quadrant) {
        for (const [sx, sy] of [
          [qx, qy],
          [-qx, qy],
          [qx, -qy],
          [-qx, -qy],
        ]) {
          full.add(`${sx},${sy}`);
        }
      }
      // Every point in the mirrored set has all three of its quadrant reflections present too.
      for (const key of full) {
        const [x, y] = key.split(',').map(Number);
        expect(full.has(`${-x!},${y}`)).toBe(true);
        expect(full.has(`${x},${-y!}`)).toBe(true);
        expect(full.has(`${-x!},${-y!}`)).toBe(true);
      }
    }
  });

  it('degenerates to a straight line when one radius is 0', () => {
    expect(midpointEllipseQuadrant(5, 0)).toEqual(
      Array.from({ length: 6 }, (_, x) => [x, 0]),
    );
    expect(midpointEllipseQuadrant(0, 5)).toEqual(
      Array.from({ length: 6 }, (_, y) => [0, y]),
    );
    expect(midpointEllipseQuadrant(0, 0)).toEqual([[0, 0]]);
  });
});

describe('EllipseTool', () => {
  it('draws a symmetric outline for an off-centre ellipse', () => {
    const ellipse = new EllipseTool({ state: 1 });
    ellipse.onDown(ctxAt(0, 0));
    ellipse.onMove(ctxAt(20, 12)); // bounding box (0,0)-(20,12) -> centre (10,6), rx=10, ry=6
    const ops = ellipse.preview();
    const cells = new Set(ops.map((o) => `${o.x - 10},${o.y - 6}`)); // relative to centre
    expect(cells.size).toBeGreaterThan(0);
    for (const key of cells) {
      const [dx, dy] = key.split(',').map(Number);
      expect(cells.has(`${-dx!},${dy}`)).toBe(true);
      expect(cells.has(`${dx},${-dy!}`)).toBe(true);
      expect(cells.has(`${-dx!},${-dy!}`)).toBe(true);
    }
  });

  it('fills the interior when filled is set, staying within the outline bounds', () => {
    const outline = new EllipseTool({ state: 1, filled: false });
    const filled = new EllipseTool({ state: 1, filled: true });
    outline.onDown(ctxAt(0, 0));
    outline.onMove(ctxAt(20, 12));
    filled.onDown(ctxAt(0, 0));
    filled.onMove(ctxAt(20, 12));

    expect(filled.preview().length).toBeGreaterThan(outline.preview().length);
    // The centre cell must be painted when filled, but is never part of a non-trivial outline.
    expect(filled.preview().some((o) => o.x === 10 && o.y === 6)).toBe(true);
    expect(outline.preview().some((o) => o.x === 10 && o.y === 6)).toBe(false);
  });

  it('Shift constrains to a circle (rx === ry)', () => {
    const ellipse = new EllipseTool({ state: 1 });
    ellipse.onDown(ctxAt(0, 0));
    ellipse.onMove(ctxAt(20, 6, { shift: true })); // dx=20, dy=6 -> circle radius 20
    const xs = ellipse.preview().map((o) => o.x);
    const ys = ellipse.preview().map((o) => o.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(Math.max(...ys) - Math.min(...ys));
  });

  it('Alt anchors the down-point as the centre, with the cursor giving the radii directly', () => {
    const ellipse = new EllipseTool({ state: 1 });
    ellipse.onDown(ctxAt(10, 10));
    ellipse.onMove(ctxAt(15, 13, { alt: true })); // rx=5, ry=3, centred on (10,10)
    const ops = ellipse.preview();
    expect(ops.some((o) => o.x === 15 && o.y === 10)).toBe(true); // rightmost point
    expect(ops.some((o) => o.x === 5 && o.y === 10)).toBe(true); // leftmost point
  });

  it('onUp finalises and resets; onCancel discards with no return value', () => {
    const ellipse = new EllipseTool({ state: 1 });
    ellipse.onDown(ctxAt(0, 0));
    ellipse.onMove(ctxAt(10, 6));
    const ops = ellipse.onUp(ctxAt(10, 6));
    expect(ops.length).toBeGreaterThan(0);
    expect(ellipse.preview()).toHaveLength(0);

    ellipse.onDown(ctxAt(0, 0));
    ellipse.onMove(ctxAt(10, 6));
    expect(ellipse.onCancel()).toBeUndefined();
    expect(ellipse.preview()).toHaveLength(0);
  });

  it('onMove before onDown is a no-op', () => {
    const ellipse = new EllipseTool();
    ellipse.onMove(ctxAt(5, 5));
    expect(ellipse.preview()).toHaveLength(0);
  });

  it('a second onUp with no intervening onDown returns nothing rather than throwing', () => {
    const ellipse = new EllipseTool();
    ellipse.onDown(ctxAt(0, 0));
    ellipse.onUp(ctxAt(0, 0));
    expect(ellipse.onUp(ctxAt(0, 0))).toEqual([]);
  });
});
