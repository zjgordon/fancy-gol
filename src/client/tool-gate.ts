/**
 * Space-drag vs paint (P2-G-1). The input router starts a tool stroke on any primary
 * pointerdown and cannot see gesture pan state, so Space+left-drag would otherwise
 * pan *and* paint. Latch at `onDown` for the life of that pointer sequence.
 */
import type { ToolEvent, ToolEventHandlers } from '@ui/input/router';

export interface GestureGate {
  readonly panning: boolean;
  readonly spaceHeld: boolean;
}

export function gateToolHandlers(gestures: GestureGate, inner: ToolEventHandlers): ToolEventHandlers {
  let suppressed = false;
  return {
    onDown: (e: ToolEvent) => {
      suppressed = gestures.panning || gestures.spaceHeld;
      if (suppressed) return;
      inner.onDown?.(e);
    },
    onMove: (e: ToolEvent) => {
      if (suppressed) return;
      inner.onMove?.(e);
    },
    onUp: (e: ToolEvent) => {
      if (suppressed) return;
      inner.onUp?.(e);
    },
    onCancel: (e: ToolEvent) => {
      if (suppressed) {
        suppressed = false;
        return;
      }
      inner.onCancel?.(e);
    },
  };
}
