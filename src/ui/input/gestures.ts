/**
 * Wheel, pinch, and drag gestures that drive a {@link Camera}: wheel-zoom-at-cursor, Shift+wheel
 * and trackpad two-finger pan, pinch-zoom, middle-drag/Space-drag pan, and inertial coasting on
 * release. Phase 1 §2.1 places the not-yet-built InputRouter/tool pipeline (P1-B-1) *below*
 * this in the stack — gestures only ever call `Camera` methods, never touch a tool or the grid,
 * so this module has no dependency on that task and needn't wait for it.
 *
 * Wheel-driven panning (the trackpad two-finger case) relies on the platform's own momentum
 * scrolling — the OS keeps sending decaying `wheel` events on its own. This module's inertia
 * model only ever applies to a released pointer-drag, which has no such native follow-through.
 *
 * Inertia is a continuous friction simulation driven by repeated `Camera.panBy` calls, not a
 * fixed-duration eased tween — so, unlike the guess recorded when `Camera.animateTo` was left
 * out of P1-A-1, this task turns out not to need it either. `animateTo` stays deferred until a
 * task adds a genuine fixed-target transition (a "fit to content" button, double-click-to-zoom).
 */
import type { Camera } from '@ui/camera';

/**
 * Wall-clock time source for inertia, injected the same way `worker/client.ts`'s
 * `FrameScheduler` and `sim.worker.ts`'s `REAL_CLOCK` are — so a test can drive it without real
 * timers. Milliseconds, monotonic.
 */
export interface Clock {
  now(): number;
}

export const REAL_CLOCK: Clock = { now: () => performance.now() };

/** Drives the inertia coast one frame at a time. Injected so a test can step frames explicitly. */
export interface FrameScheduler {
  request(fn: () => void): number;
  cancel(handle: number): void;
}

export const RAF_FRAME_SCHEDULER: FrameScheduler = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Whether to honour `prefers-reduced-motion: reduce`, injected so tests don't depend on `matchMedia`. */
export type ReducedMotionQuery = () => boolean;

export const SYSTEM_REDUCED_MOTION: ReducedMotionQuery = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The minimal DOM surface this module needs — satisfied by any real `Element`/`Window`, and
 * trivially fakeable in tests without constructing real browser event classes (same "functional
 * double" discipline as `tests/unit/render/canvas2d.spec.ts`'s `FakeContext`).
 */
export interface GestureSurface {
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
}

export interface GestureOptions {
  /**
   * Where Space-drag's keydown/keyup are observed. Defaults to `pointerTarget`; pass `window`
   * in production if `pointerTarget` (typically a canvas) won't reliably hold keyboard focus.
   */
  readonly keyTarget?: GestureSurface;
  readonly clock?: Clock;
  readonly scheduler?: FrameScheduler;
  readonly reducedMotion?: ReducedMotionQuery;
}

export interface GestureController {
  /** True while a drag-to-pan (middle-mouse or Space+drag) is active. */
  readonly panning: boolean;
  /** True while an inertia coast is in flight. */
  readonly coasting: boolean;
  /** Remove every listener and cancel any in-flight inertia. */
  dispose(): void;
}

/** One discrete wheel "notch" — Phase 1 §2.3's geometric zoom (`factor = 1.1`). */
const WHEEL_ZOOM_STEP = 1.1;
/** Continuous ctrl+wheel, the platform's trackpad-pinch-as-wheel convention. */
const PINCH_WHEEL_SENSITIVITY = 0.01;
/** Velocity for the inertia coast is measured over this trailing window of drag movement. */
const VELOCITY_WINDOW_MS = 100;
/** Hard stop, regardless of how slowly the exponential friction below is still decaying. */
const MAX_INERTIA_MS = 800;
/** Exponential decay rate. Chosen so a typical flick has settled well before {@link MAX_INERTIA_MS}. */
const FRICTION_PER_MS = 0.006;
/** Below this speed the coast is imperceptible; stop early rather than run out the clock. */
const MIN_COAST_SPEED = 0.02;

interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export function attachGestures(
  camera: Camera,
  pointerTarget: GestureSurface,
  options: GestureOptions = {},
): GestureController {
  const keyTarget = options.keyTarget ?? pointerTarget;
  const clock = options.clock ?? REAL_CLOCK;
  const scheduler = options.scheduler ?? RAF_FRAME_SCHEDULER;
  const reducedMotion = options.reducedMotion ?? SYSTEM_REDUCED_MOTION;

  let spaceHeld = false;
  let dragPointerId: number | null = null;
  let dragIsSpaceDrag = false;
  let dragLastX = 0;
  let dragLastY = 0;
  let dragSamples: Sample[] = [];

  let inertiaHandle: number | null = null;
  let inertiaVX = 0;
  let inertiaVY = 0;
  let inertiaElapsedMs = 0;
  let inertiaLastT = 0;

  const touchPoints = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let pinchMidX = 0;
  let pinchMidY = 0;

  function cancelInertia(): void {
    if (inertiaHandle !== null) {
      scheduler.cancel(inertiaHandle);
      inertiaHandle = null;
    }
  }

  function relativePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = pointerTarget.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** The two active touch points, in insertion order, once exactly two are down — else `null`. */
  function touchPair(): readonly [{ x: number; y: number }, { x: number; y: number }] | null {
    if (touchPoints.size !== 2) return null;
    const it = touchPoints.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? [a, b] : null;
  }

  function recordSample(x: number, y: number): void {
    const t = clock.now();
    dragSamples.push({ t, x, y });
    const cutoff = t - VELOCITY_WINDOW_MS;
    while (dragSamples.length > 1 && dragSamples[0]!.t < cutoff) dragSamples.shift();
  }

  function beginDrag(pointerId: number, isSpaceDrag: boolean, clientX: number, clientY: number): void {
    cancelInertia();
    dragPointerId = pointerId;
    dragIsSpaceDrag = isSpaceDrag;
    dragLastX = clientX;
    dragLastY = clientY;
    dragSamples = [];
    recordSample(clientX, clientY);
  }

  function updateDrag(clientX: number, clientY: number): void {
    const dx = clientX - dragLastX;
    const dy = clientY - dragLastY;
    dragLastX = clientX;
    dragLastY = clientY;
    camera.panBy(dx, dy);
    recordSample(clientX, clientY);
  }

  function endDrag(): void {
    dragPointerId = null;
    const first = dragSamples[0];
    const last = dragSamples[dragSamples.length - 1];
    dragSamples = [];
    if (!first || !last || reducedMotion()) return;
    const dt = last.t - first.t;
    if (dt <= 0) return;
    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    if (Math.hypot(vx, vy) < MIN_COAST_SPEED) return;
    startInertia(vx, vy);
  }

  function startInertia(vx: number, vy: number): void {
    inertiaVX = vx;
    inertiaVY = vy;
    inertiaElapsedMs = 0;
    inertiaLastT = clock.now();
    inertiaHandle = scheduler.request(stepInertia);
  }

  function stepInertia(): void {
    const now = clock.now();
    const dt = Math.max(0, now - inertiaLastT);
    inertiaLastT = now;
    inertiaElapsedMs += dt;

    camera.panBy(inertiaVX * dt, inertiaVY * dt);

    const decay = Math.exp(-FRICTION_PER_MS * dt);
    inertiaVX *= decay;
    inertiaVY *= decay;

    const speed = Math.hypot(inertiaVX, inertiaVY);
    if (speed < MIN_COAST_SPEED || inertiaElapsedMs >= MAX_INERTIA_MS) {
      inertiaHandle = null;
      return;
    }
    inertiaHandle = scheduler.request(stepInertia);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    cancelInertia();
    const { x: px, y: py } = relativePoint(e.clientX, e.clientY);
    if (e.ctrlKey) {
      camera.zoomAt(px, py, Math.exp(-e.deltaY * PINCH_WHEEL_SENSITIVITY));
    } else if (e.shiftKey) {
      camera.panBy(-e.deltaY, 0);
    } else if (e.deltaMode === 0) {
      camera.panBy(-e.deltaX, -e.deltaY);
    } else {
      camera.zoomAt(px, py, WHEEL_ZOOM_STEP ** -Math.sign(e.deltaY));
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      e.preventDefault();
      touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pair = touchPair();
      if (pair) {
        cancelInertia();
        const [a, b] = pair;
        pinchDistance = Math.hypot(b.x - a.x, b.y - a.y);
        pinchMidX = (a.x + b.x) / 2;
        pinchMidY = (a.y + b.y) / 2;
      }
      return;
    }
    const isMiddle = e.button === 1;
    const isSpaceDrag = e.button === 0 && spaceHeld;
    if (dragPointerId === null && (isMiddle || isSpaceDrag)) {
      e.preventDefault();
      beginDrag(e.pointerId, isSpaceDrag, e.clientX, e.clientY);
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (touchPoints.has(e.pointerId)) {
      touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pair = touchPair();
      if (pair) {
        const [a, b] = pair;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        camera.panBy(midX - pinchMidX, midY - pinchMidY);
        if (pinchDistance > 0) {
          const rel = relativePoint(midX, midY);
          camera.zoomAt(rel.x, rel.y, dist / pinchDistance);
        }
        pinchDistance = dist;
        pinchMidX = midX;
        pinchMidY = midY;
      }
      return;
    }
    if (e.pointerId === dragPointerId) {
      updateDrag(e.clientX, e.clientY);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (touchPoints.has(e.pointerId)) {
      touchPoints.delete(e.pointerId);
      pinchDistance = 0;
      return;
    }
    if (e.pointerId === dragPointerId) {
      endDrag();
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault();
      spaceHeld = true;
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    // Space released mid-drag without the button ever releasing — end the pan now rather than
    // keep tracking a pointer the user no longer intends to pan with.
    if (dragPointerId !== null && dragIsSpaceDrag) {
      endDrag();
    }
  }

  pointerTarget.addEventListener('wheel', onWheel, { passive: false });
  pointerTarget.addEventListener('pointerdown', onPointerDown);
  pointerTarget.addEventListener('pointermove', onPointerMove);
  pointerTarget.addEventListener('pointerup', onPointerUp);
  pointerTarget.addEventListener('pointercancel', onPointerUp);
  keyTarget.addEventListener('keydown', onKeyDown);
  keyTarget.addEventListener('keyup', onKeyUp);

  return {
    get panning() {
      return dragPointerId !== null;
    },
    get coasting() {
      return inertiaHandle !== null;
    },
    dispose(): void {
      cancelInertia();
      pointerTarget.removeEventListener('wheel', onWheel);
      pointerTarget.removeEventListener('pointerdown', onPointerDown);
      pointerTarget.removeEventListener('pointermove', onPointerMove);
      pointerTarget.removeEventListener('pointerup', onPointerUp);
      pointerTarget.removeEventListener('pointercancel', onPointerUp);
      keyTarget.removeEventListener('keydown', onKeyDown);
      keyTarget.removeEventListener('keyup', onKeyUp);
    },
  };
}
