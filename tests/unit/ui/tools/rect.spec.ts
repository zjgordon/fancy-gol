import { describe, expect, it } from 'vitest';
import type { PaintOp } from '@shared/types';
import type { ToolPoint } from '@ui/input/router';
import { RectTool } from '@ui/tools/rect';
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

function box(x0: number, y0: number, x1: number, y1: number, state = 1): PaintOp[] {
  const ops: PaintOp[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ops.push({ x, y, state });
  return ops;
}

function border(x0: number, y0: number, x1: number, y1: number, state = 1): PaintOp[] {
  return box(x0, y0, x1, y1, state).filter((op) => op.x === x0 || op.x === x1 || op.y === y0 || op.y === y1);
}

describe('RectTool', () => {
  it('draws an outline (default) between two corners', () => {
    const rect = new RectTool({ state: 1 });
    rect.onDown(ctxAt(0, 0));
    rect.onMove(ctxAt(4, 3));
    expect(sortOps(rect.preview())).toEqual(sortOps(border(0, 0, 4, 3)));
  });

  it('fills the interior when filled is set', () => {
    const rect = new RectTool({ state: 1, filled: true });
    rect.onDown(ctxAt(0, 0));
    rect.onMove(ctxAt(4, 3));
    expect(sortOps(rect.preview())).toEqual(sortOps(box(0, 0, 4, 3)));
  });

  it('works regardless of drag direction (corner order)', () => {
    const rect = new RectTool({ state: 1, filled: true });
    rect.onDown(ctxAt(4, 3));
    rect.onMove(ctxAt(0, 0));
    expect(sortOps(rect.preview())).toEqual(sortOps(box(0, 0, 4, 3)));
  });

  it('Shift constrains to a square, sized by the larger axis delta', () => {
    const rect = new RectTool({ state: 1, filled: true });
    rect.onDown(ctxAt(0, 0));
    rect.onMove(ctxAt(6, 2, { shift: true })); // dx=6, dy=2 -> square side 6
    expect(sortOps(rect.preview())).toEqual(sortOps(box(0, 0, 6, 6)));
  });

  it('Alt anchors the down-point as the centre, doubling the extent', () => {
    const rect = new RectTool({ state: 1, filled: true });
    rect.onDown(ctxAt(5, 5));
    rect.onMove(ctxAt(8, 7, { alt: true })); // dx=3, dy=2 -> spans (2,3) to (8,7)
    expect(sortOps(rect.preview())).toEqual(sortOps(box(2, 3, 8, 7)));
  });

  it('a zero-size drag (down and up at the same cell) paints exactly one cell', () => {
    const rect = new RectTool({ state: 1 });
    rect.onDown(ctxAt(2, 2));
    const ops = rect.onUp(ctxAt(2, 2));
    expect(ops).toEqual([{ x: 2, y: 2, state: 1 }]);
  });

  it('onUp finalises and resets; onCancel discards with no return value', () => {
    const rect = new RectTool({ state: 1 });
    rect.onDown(ctxAt(0, 0));
    rect.onMove(ctxAt(2, 2));
    const ops = rect.onUp(ctxAt(2, 2));
    expect(ops.length).toBeGreaterThan(0);
    expect(rect.preview()).toHaveLength(0);

    rect.onDown(ctxAt(0, 0));
    rect.onMove(ctxAt(5, 5));
    expect(rect.onCancel()).toBeUndefined();
    expect(rect.preview()).toHaveLength(0);
  });

  it('onMove before onDown is a no-op', () => {
    const rect = new RectTool();
    rect.onMove(ctxAt(5, 5));
    expect(rect.preview()).toHaveLength(0);
  });

  it('a second onUp with no intervening onDown returns nothing rather than throwing', () => {
    const rect = new RectTool();
    rect.onDown(ctxAt(0, 0));
    rect.onUp(ctxAt(0, 0));
    expect(rect.onUp(ctxAt(0, 0))).toEqual([]);
  });
});
