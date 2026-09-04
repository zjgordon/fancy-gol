import { describe, expect, it } from 'vitest';
import { DEAD } from '@shared/types';
import type { ToolPoint } from '@ui/input/router';
import { Eraser } from '@ui/tools/eraser';
import type { ToolContext } from '@ui/tools/tool';

function ctxAt(x: number, y: number): ToolContext {
  const point: ToolPoint = { x, y, pressure: 0.5, timeMs: 0 };
  return {
    event: {
      phase: 'move',
      pointerId: 1,
      pointerType: 'mouse',
      point,
      coalesced: [point],
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    },
  };
}

describe('Eraser', () => {
  it('always paints DEAD, regardless of any options passed in', () => {
    const eraser = new Eraser({ size: 3, shape: 'square' });
    eraser.onDown(ctxAt(0, 0));
    for (const op of eraser.preview()) {
      expect(op.state).toBe(DEAD);
    }
    expect(eraser.preview().length).toBeGreaterThan(0);
  });

  it('does not expose any way to set a paint state', () => {
    // Structural check: TypeScript already prevents `eraser.state = ...` at compile time
    // (there is no such property); this confirms it is also absent at runtime.
    const eraser = new Eraser();
    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(eraser), 'state')).toBeUndefined();
  });

  it('has a distinct id and cursor from Brush', () => {
    const eraser = new Eraser();
    expect(eraser.id).toBe('eraser');
    expect(eraser.cursor).toBe('crosshair');
  });

  it('passes size/shape/density/symmetry through to the underlying brush', () => {
    const eraser = new Eraser({ size: 5, shape: 'diamond', density: 0.5, symmetry: 'quad' });
    expect(eraser.size).toBe(5);
    expect(eraser.shape).toBe('diamond');
    expect(eraser.density).toBe(0.5);
    expect(eraser.symmetry).toBe('quad');

    eraser.size = 9;
    eraser.shape = 'circle';
    eraser.density = 1;
    eraser.symmetry = 'none';
    expect(eraser.size).toBe(9);
    expect(eraser.shape).toBe('circle');
    expect(eraser.density).toBe(1);
    expect(eraser.symmetry).toBe('none');
  });

  it('delegates the full stroke lifecycle to the underlying brush', () => {
    const eraser = new Eraser({ size: 1 });
    eraser.onDown(ctxAt(2, 2));
    eraser.onMove(ctxAt(3, 2));
    expect(eraser.preview()).toEqual([
      { x: 2, y: 2, state: DEAD },
      { x: 3, y: 2, state: DEAD },
    ]);

    const ops = eraser.onUp(ctxAt(3, 2));
    expect(ops).toHaveLength(2);
    expect(eraser.preview()).toHaveLength(0); // reset for the next stroke

    eraser.onDown(ctxAt(0, 0));
    expect(eraser.onCancel()).toBeUndefined();
    expect(eraser.preview()).toHaveLength(0);
  });
});
