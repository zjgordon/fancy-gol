import { describe, expect, it } from 'vitest';
import { Camera } from '@ui/camera';
import { attachInputRouter, type ToolEvent } from '@ui/input/router';

/**
 * A minimal but functionally real `RouterSurface` double — real add/remove bookkeeping and
 * dispatch, plus a call log for pointer-capture so tests can assert the router actually claims
 * and releases it. Same "functional double" discipline as `tests/unit/render/canvas2d.spec.ts`'s
 * `FakeContext` and `gestures.spec.ts`'s `FakeSurface`.
 */
class FakeSurface {
  private readonly handlers = new Map<string, Set<(event: never) => void>>();
  readonly captured: number[] = [];
  readonly released: number[] = [];

  addEventListener(type: string, listener: (event: never) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.handlers.get(type)?.delete(listener);
  }

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }

  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.released.push(pointerId);
  }

  dispatch(type: string, event: object): void {
    for (const fn of this.handlers.get(type) ?? []) fn(event as never);
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

interface FakePointerEventInit {
  pointerId: number;
  pointerType?: string;
  button?: number;
  clientX: number;
  clientY: number;
  pressure?: number;
  timeStamp?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  coalesced?: readonly FakePointerEventInit[];
}

function pointerEvent(init: FakePointerEventInit): object {
  return {
    pointerId: init.pointerId,
    pointerType: init.pointerType ?? 'mouse',
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
    pressure: init.pressure ?? 0.5,
    timeStamp: init.timeStamp ?? 0,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
    getCoalescedEvents: init.coalesced ? () => init.coalesced!.map((c) => pointerEvent(c)) : undefined,
  };
}

function makeCamera(): Camera {
  return new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 10 });
}

function collect() {
  const events: ToolEvent[] = [];
  const handlers = {
    onDown: (e: ToolEvent) => events.push(e),
    onMove: (e: ToolEvent) => events.push(e),
    onUp: (e: ToolEvent) => events.push(e),
    onCancel: (e: ToolEvent) => events.push(e),
  };
  return { events, handlers };
}

describe('attachInputRouter', () => {
  describe('starting a stroke', () => {
    it('starts a stroke on a primary-button pointerdown, converted to world coordinates', () => {
      const camera = makeCamera();
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      const router = attachInputRouter(camera, surface, handlers);

      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 50, clientY: 30 }));

      expect(events).toHaveLength(1);
      expect(events[0]!.phase).toBe('down');
      expect(events[0]!.point).toEqual({ x: 5, y: 3, pressure: 0.5, timeMs: 0 });
      expect(router.activePointerId).toBe(1);
      expect(surface.captured).toEqual([1]);
    });

    it('ignores a non-primary-button pointerdown (e.g. middle-mouse, gestures.ts\'s pan trigger)', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      const router = attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, button: 1, clientX: 0, clientY: 0 }));

      expect(events).toHaveLength(0);
      expect(router.activePointerId).toBeNull();
      expect(surface.captured).toHaveLength(0);
    });

    it('ignores a second simultaneous pointerdown while a stroke is already active', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      const router = attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
      surface.dispatch('pointerdown', pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 }));

      expect(events).toHaveLength(1); // only pointer 1's down
      expect(router.activePointerId).toBe(1);
      expect(surface.captured).toEqual([1]);
    });

    it('exposes pen pressure on down, even though nothing consumes it yet', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch(
        'pointerdown',
        pointerEvent({ pointerId: 1, pointerType: 'pen', clientX: 0, clientY: 0, pressure: 0.73 }),
      );

      expect(events[0]!.point.pressure).toBe(0.73);
    });

    it('reads modifier keys straight off the native event', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch(
        'pointerdown',
        pointerEvent({ pointerId: 1, clientX: 0, clientY: 0, shiftKey: true, altKey: true }),
      );

      expect(events[0]!.modifiers).toEqual({ shift: true, ctrl: false, alt: true, meta: false });
    });
  });

  describe('move: coalesced events', () => {
    it('a fast 1000px drag forwards every coalesced sub-sample, none dropped', () => {
      const camera = makeCamera(); // cellSize 10: screen px 100 == 10 world units
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      attachInputRouter(camera, surface, handlers);

      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));

      const STEPS = 20; // a 1000px drag coalesced into 20 sub-samples
      const coalesced = Array.from({ length: STEPS }, (_, i) => ({
        pointerId: 1,
        clientX: ((i + 1) * 1000) / STEPS,
        clientY: 0,
      }));
      surface.dispatch(
        'pointermove',
        pointerEvent({ pointerId: 1, clientX: 1000, clientY: 0, coalesced }),
      );

      const move = events.find((e) => e.phase === 'move')!;
      expect(move.coalesced).toHaveLength(STEPS);
      // Continuous and gap-free: every consecutive pair advances by exactly one step, none
      // skipped or duplicated, ending exactly at the drag's final world position.
      for (let i = 0; i < STEPS; i++) {
        expect(move.coalesced[i]!.x).toBeCloseTo(((i + 1) * 100) / STEPS, 9);
      }
      expect(move.point).toBe(move.coalesced[move.coalesced.length - 1]);
    });

    it('falls back to the event itself when getCoalescedEvents() is unavailable or returns nothing', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      attachInputRouter(makeCamera(), surface, handlers);
      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));

      surface.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 30, clientY: 20, coalesced: [] }));
      const withEmptyCoalesced = events.find((e) => e.phase === 'move')!;
      expect(withEmptyCoalesced.coalesced).toEqual([{ x: 3, y: 2, pressure: 0.5, timeMs: 0 }]);

      events.length = 0;
      const noMethod = pointerEvent({ pointerId: 1, clientX: 40, clientY: 20 }) as { getCoalescedEvents?: unknown };
      delete noMethod.getCoalescedEvents;
      surface.dispatch('pointermove', noMethod);
      const withoutMethod = events.find((e) => e.phase === 'move')!;
      expect(withoutMethod.coalesced).toEqual([{ x: 4, y: 2, pressure: 0.5, timeMs: 0 }]);
    });

    it('ignores move events for a pointer that is not the active stroke', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch('pointermove', pointerEvent({ pointerId: 99, clientX: 5, clientY: 5 }));
      expect(events).toHaveLength(0);
    });
  });

  describe('ending a stroke', () => {
    it('pointerup ends the stroke and clears activePointerId', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      const router = attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
      surface.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 10, clientY: 10 }));

      expect(events.at(-1)!.phase).toBe('up');
      expect(router.activePointerId).toBeNull();

      // A stray move for the now-ended pointer is ignored.
      events.length = 0;
      surface.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 20, clientY: 20 }));
      expect(events).toHaveLength(0);
    });

    it('pointercancel ends the stroke as a cancel', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      const router = attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
      surface.dispatch('pointercancel', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));

      expect(events.at(-1)!.phase).toBe('cancel');
      expect(router.activePointerId).toBeNull();
    });

    it('losing pointer capture mid-drag (alt-tab) cancels the stroke with no pointerup ever arriving', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      const router = attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
      surface.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 50, clientY: 0 }));
      surface.dispatch('lostpointercapture', pointerEvent({ pointerId: 1, clientX: 50, clientY: 0 }));

      expect(events.at(-1)!.phase).toBe('cancel');
      expect(router.activePointerId).toBeNull();

      // No partial edit reaches the consumer after this: a subsequent move for that pointer
      // (some stray, late-arriving event) is ignored, since the stroke is already over.
      events.length = 0;
      surface.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 100, clientY: 0 }));
      expect(events).toHaveLength(0);
    });

    it('ignores an up/cancel for a pointer that is not the active stroke', () => {
      const surface = new FakeSurface();
      const { events, handlers } = collect();
      attachInputRouter(makeCamera(), surface, handlers);

      surface.dispatch('pointerup', pointerEvent({ pointerId: 42, clientX: 0, clientY: 0 }));
      surface.dispatch('pointercancel', pointerEvent({ pointerId: 42, clientX: 0, clientY: 0 }));

      expect(events).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('removes every listener', () => {
      const surface = new FakeSurface();
      const { handlers } = collect();
      const router = attachInputRouter(makeCamera(), surface, handlers);

      router.dispose();

      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        expect(surface.listenerCount(type)).toBe(0);
      }
    });
  });
});
