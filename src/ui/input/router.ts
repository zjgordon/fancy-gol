/**
 * The one entry point for pointer input that becomes a paint stroke — Pointer Events only, one
 * code path for mouse/pen/touch (Phase 1 §2.1). Owns pointer capture, forwards every coalesced
 * sub-sample from a fast drag (not just the event's final position, via `getCoalescedEvents()`),
 * reads modifier keys and pen pressure straight off the native event, and converts every point
 * to world (cell) coordinates via the supplied `Camera`.
 *
 * This module and `src/ui/input/gestures.ts` (P1-A-2) are independent, sibling listeners meant
 * to both be attached to the same canvas — gestures.ts owns the camera (pan/zoom/pinch), this
 * module owns tool strokes (paint/draw). To not fight over the same physical input:
 *   - Only a *primary*-button pointerdown (`button === 0`, which touch also reports) starts a
 *     stroke, so gestures.ts's middle-mouse-drag pan is never mistaken for one.
 *   - Only one pointer is tracked as the active stroke at a time; a second simultaneous
 *     pointerdown (e.g. a second touch arriving mid-pinch) is ignored outright, not queued.
 * Space+left-drag (gestures.ts's *other* pan trigger) is deliberately NOT filtered here — this
 * module has no visibility into gestures.ts's Space-held state, and reaching into it would be
 * scope creep for a task whose file list is this one module. Whichever task first composes both
 * listeners onto a real canvas needs to share that state or gate which listener is live; this is
 * noted in the phase doc (P1-B-1) rather than guessed at here.
 */
import type { Camera } from '@ui/camera';

export interface ToolPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly timeMs: number;
}

export interface ToolModifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

export type ToolEventPhase = 'down' | 'move' | 'up' | 'cancel';

export interface ToolEvent {
  readonly phase: ToolEventPhase;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly point: ToolPoint;
  /**
   * Every sub-sample since the last emitted event, oldest first, with `point` always last. A
   * `move` born from a fast drag can carry many of these (via `getCoalescedEvents()`); `down`,
   * `up`, and `cancel` always carry exactly one.
   */
  readonly coalesced: readonly ToolPoint[];
  readonly modifiers: ToolModifiers;
}

export interface RouterSurface {
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void;
  getBoundingClientRect(): { left: number; top: number };
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
}

export interface ToolEventHandlers {
  onDown?(event: ToolEvent): void;
  onMove?(event: ToolEvent): void;
  onUp?(event: ToolEvent): void;
  onCancel?(event: ToolEvent): void;
}

export interface InputRouter {
  /** The pointerId currently owning a stroke, or `null` between strokes. */
  readonly activePointerId: number | null;
  /** Remove every listener. Does not itself cancel an in-progress stroke. */
  dispose(): void;
}

export function attachInputRouter(camera: Camera, target: RouterSurface, handlers: ToolEventHandlers): InputRouter {
  let activePointerId: number | null = null;

  function toWorldPoint(e: PointerEvent): ToolPoint {
    const rect = target.getBoundingClientRect();
    const world = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    return { x: world.x, y: world.y, pressure: e.pressure, timeMs: e.timeStamp };
  }

  function modifiersOf(e: PointerEvent): ToolModifiers {
    return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
  }

  function emit(phase: ToolEventPhase, e: PointerEvent, coalesced: readonly ToolPoint[]): void {
    // Every call site below passes a non-empty array (down/up/cancel: one point; move: at least
    // the raw event itself when getCoalescedEvents() yields nothing) — never a fallback here.
    const point = coalesced[coalesced.length - 1]!;
    const event: ToolEvent = {
      phase,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      point,
      coalesced,
      modifiers: modifiersOf(e),
    };
    switch (phase) {
      case 'down':
        handlers.onDown?.(event);
        break;
      case 'move':
        handlers.onMove?.(event);
        break;
      case 'up':
        handlers.onUp?.(event);
        break;
      case 'cancel':
        handlers.onCancel?.(event);
        break;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || activePointerId !== null) return;
    activePointerId = e.pointerId;
    target.setPointerCapture(e.pointerId);
    emit('down', e, [toWorldPoint(e)]);
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== activePointerId) return;
    const raw = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const points = (raw.length > 0 ? raw : [e]).map(toWorldPoint);
    emit('move', e, points);
  }

  function endStroke(phase: 'up' | 'cancel', e: PointerEvent): void {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    emit(phase, e, [toWorldPoint(e)]);
  }

  function onPointerUp(e: PointerEvent): void {
    endStroke('up', e);
  }

  function onPointerCancel(e: PointerEvent): void {
    endStroke('cancel', e);
  }

  function onLostPointerCapture(e: PointerEvent): void {
    // Alt-tab / OS focus loss mid-drag: no pointerup ever arrives for this pointer. Treat it
    // exactly like a cancel so no partial edit gets committed on the strength of a drag that
    // never properly ended.
    endStroke('cancel', e);
  }

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerCancel);
  target.addEventListener('lostpointercapture', onLostPointerCapture);

  return {
    get activePointerId() {
      return activePointerId;
    },
    dispose(): void {
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('lostpointercapture', onLostPointerCapture);
    },
  };
}
