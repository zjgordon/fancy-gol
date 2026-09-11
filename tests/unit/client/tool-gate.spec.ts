import { describe, expect, it } from 'vitest';
import type { ToolEvent } from '@ui/input/router';
import { gateToolHandlers } from '@client/tool-gate';

function event(): ToolEvent {
  return {
    phase: 'down',
    pointerId: 1,
    pointerType: 'mouse',
    point: { x: 1, y: 2, pressure: 1, timeMs: 0 },
    coalesced: [],
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
  };
}

describe('gateToolHandlers', () => {
  it('forwards a stroke when the camera is not panning', () => {
    const calls: string[] = [];
    const gated = gateToolHandlers(
      { panning: false, spaceHeld: false },
      {
        onDown: () => calls.push('down'),
        onMove: () => calls.push('move'),
        onUp: () => calls.push('up'),
      },
    );
    const e = event();
    gated.onDown?.(e);
    gated.onMove?.(e);
    gated.onUp?.(e);
    expect(calls).toEqual(['down', 'move', 'up']);
  });

  it('suppresses the whole pointer sequence when Space-drag starts the stroke', () => {
    const calls: string[] = [];
    const gated = gateToolHandlers(
      { panning: false, spaceHeld: true },
      {
        onDown: () => calls.push('down'),
        onMove: () => calls.push('move'),
        onCancel: () => calls.push('cancel'),
      },
    );
    const e = event();
    gated.onDown?.(e);
    gated.onMove?.(e);
    gated.onCancel?.(e);
    expect(calls).toEqual([]);
  });

  it('forwards cancel when the stroke was not suppressed', () => {
    const calls: string[] = [];
    const gated = gateToolHandlers(
      { panning: false, spaceHeld: false },
      {
        onCancel: () => calls.push('cancel'),
      },
    );
    gated.onCancel?.(event());
    expect(calls).toEqual(['cancel']);
  });
});
