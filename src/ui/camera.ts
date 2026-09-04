/**
 * The 2D camera: the world/screen transform every tool, overlay, and renderer under
 * `src/ui/**` shares (Phase 1 §2.3). `cellSize` is device px per world cell and stays
 * fractional throughout — snapping it to an integer is what makes wheel-zoom feel notchy
 * instead of smooth. It is clamped to [{@link MIN_CELL_SIZE}, {@link MAX_CELL_SIZE}]; below
 * 1 px/cell the renderer's density-LOD path takes over (ADR-005).
 *
 * `animateTo` (Phase 1 §2.3's full `Camera` contract) lands here in P1-D-1: the cold-start
 * choreography's wide-shot-to-framed camera move is the first genuine fixed-target eased
 * transition anything needs — P1-A-1 and P1-A-2 both left it out because neither had one.
 * `Clock`/`FrameScheduler` are injected, same discipline as `ui/input/gestures.ts`'s identically
 * named pair, so the tween is exercisable frame-by-frame under test without real timers; each
 * module defines its own copy rather than sharing one, matching this codebase's established
 * per-module-boundary duplication (`brush.ts`'s PRNG, `edit-stack.ts`'s coord packing, …).
 */
import type { Rect } from '@shared/types';

/** Wall-clock time source, injected so a test can drive `animateTo` without real timers. */
export interface Clock {
  now(): number;
}

export const REAL_CLOCK: Clock = { now: () => performance.now() };

/** Drives `animateTo` one frame at a time. Injected so a test can step frames explicitly. */
export interface FrameScheduler {
  request(fn: () => void): number;
  cancel(handle: number): void;
}

export const RAF_FRAME_SCHEDULER: FrameScheduler = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** `t` in `[0, 1]` in, eased `[0, 1]` out. A provisional hand-written default — P1-E-1/P3-A-1's
 * real `MotionSignature.easings` token will eventually replace call sites that want it, the same
 * "swappable named curve, not an ad hoc literal" treatment `ui/overlay/grid-lines.ts`'s
 * `FadeCurve` already established. */
export type Easing = (t: number) => number;

export const EASE_OUT_CUBIC: Easing = (t) => 1 - (1 - t) ** 3;

export interface CameraAnimateTarget {
  readonly originX?: number;
  readonly originY?: number;
  readonly cellSize?: number;
}

export interface CameraAnimateOptions {
  readonly clock?: Clock;
  readonly scheduler?: FrameScheduler;
}

/** Below this, a cell is sub-pixel; the renderer's density-LOD path takes over (ADR-005). */
export const MIN_CELL_SIZE = 0.02;
/** Above this, further zoom buys nothing and only risks float blow-up in hot paths. */
export const MAX_CELL_SIZE = 128;

function clampCellSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_CELL_SIZE;
  return Math.min(MAX_CELL_SIZE, Math.max(MIN_CELL_SIZE, size));
}

export interface CameraOptions {
  /** Viewport size in CSS px. Required — `fitTo` and centring need it from construction. */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly cellSize?: number;
}

export class Camera {
  private _originX: number;
  private _originY: number;
  private _cellSize: number;
  private _widthPx: number;
  private _heightPx: number;
  private _dirty = true;
  private animHandle: number | null = null;
  private animScheduler: FrameScheduler | null = null;

  constructor(options: CameraOptions) {
    this._widthPx = options.widthPx;
    this._heightPx = options.heightPx;
    this._originX = options.originX ?? 0;
    this._originY = options.originY ?? 0;
    this._cellSize = clampCellSize(options.cellSize ?? 16);
  }

  get originX(): number {
    return this._originX;
  }

  set originX(value: number) {
    if (value === this._originX) return;
    this._originX = value;
    this._dirty = true;
  }

  get originY(): number {
    return this._originY;
  }

  set originY(value: number) {
    if (value === this._originY) return;
    this._originY = value;
    this._dirty = true;
  }

  get cellSize(): number {
    return this._cellSize;
  }

  set cellSize(value: number) {
    const next = clampCellSize(value);
    if (next === this._cellSize) return;
    this._cellSize = next;
    this._dirty = true;
  }

  get widthPx(): number {
    return this._widthPx;
  }

  get heightPx(): number {
    return this._heightPx;
  }

  /** Whether the transform has changed since the last {@link clearDirty} call. */
  get dirty(): boolean {
    return this._dirty;
  }

  /** Acknowledge the pending repaint. Called by the render loop right after it redraws. */
  clearDirty(): void {
    this._dirty = false;
  }

  /** The on-screen viewport size changed (canvas resize / dpr change). */
  resize(widthPx: number, heightPx: number): void {
    if (widthPx === this._widthPx && heightPx === this._heightPx) return;
    this._widthPx = widthPx;
    this._heightPx = heightPx;
    this._dirty = true;
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    return {
      x: px / this._cellSize + this._originX,
      y: py / this._cellSize + this._originY,
    };
  }

  worldToScreen(x: number, y: number): { px: number; py: number } {
    return {
      px: (x - this._originX) * this._cellSize,
      py: (y - this._originY) * this._cellSize,
    };
  }

  /**
   * Zoom about the cursor: `factor` scales {@link cellSize} (clamped), but the world point
   * currently under `(px, py)` does not move on screen. Re-derives origin from the pre-zoom
   * reading rather than from `factor` directly, so a `factor` that gets clamped away, or 100
   * successive calls, never accumulates drift.
   */
  zoomAt(px: number, py: number, factor: number): void {
    const before = this.screenToWorld(px, py);
    this._cellSize = clampCellSize(this._cellSize * factor);
    this._originX = before.x - px / this._cellSize;
    this._originY = before.y - py / this._cellSize;
    this._dirty = true;
  }

  /** Pan by a screen-space delta (drag / inertia), independent of zoom level. */
  panBy(dxPx: number, dyPx: number): void {
    this._originX -= dxPx / this._cellSize;
    this._originY -= dyPx / this._cellSize;
    this._dirty = true;
  }

  /**
   * Frame `rect` (world coords), centred in the viewport, with `paddingPx` of screen-space
   * margin on whichever axis is the tighter fit. The other axis simply gets more margin —
   * that is "fit", not "stretch to fill".
   */
  fitTo(rect: Rect, paddingPx = 0): void {
    const availW = Math.max(this._widthPx - 2 * paddingPx, 1e-6);
    const availH = Math.max(this._heightPx - 2 * paddingPx, 1e-6);
    const scaleW = rect.width > 0 ? availW / rect.width : Infinity;
    const scaleH = rect.height > 0 ? availH / rect.height : Infinity;
    const fitted = Math.min(scaleW, scaleH);
    this._cellSize = clampCellSize(Number.isFinite(fitted) ? fitted : 1);
    this._originX = rect.x + rect.width / 2 - this._widthPx / 2 / this._cellSize;
    this._originY = rect.y + rect.height / 2 - this._heightPx / 2 / this._cellSize;
    this._dirty = true;
  }

  /** True while an `animateTo` tween is in flight. */
  get animating(): boolean {
    return this.animHandle !== null;
  }

  /** Stops any in-flight `animateTo` tween where it currently stands — never snaps to the target. */
  cancelAnimation(): void {
    if (this.animHandle !== null && this.animScheduler) {
      this.animScheduler.cancel(this.animHandle);
    }
    this.animHandle = null;
    this.animScheduler = null;
  }

  /**
   * Tweens whichever of `originX`/`originY`/`cellSize` are present in `target` over `ms`,
   * through `easing`. A field omitted from `target` is left untouched throughout. Cancels any
   * animation already in flight (the new one wins, it does not queue). `ms <= 0` jumps straight
   * to the target on the next frame's callback, so a caller can always await the same completion
   * signal regardless of duration.
   */
  animateTo(target: CameraAnimateTarget, ms: number, easing: Easing, options: CameraAnimateOptions = {}): void {
    this.cancelAnimation();
    const clock = options.clock ?? REAL_CLOCK;
    const scheduler = options.scheduler ?? RAF_FRAME_SCHEDULER;
    this.animScheduler = scheduler;

    const startOriginX = this._originX;
    const startOriginY = this._originY;
    const startCellSize = this._cellSize;
    const duration = Math.max(0, ms);
    const startedAt = clock.now();

    const step = (): void => {
      const elapsed = clock.now() - startedAt;
      const t = duration === 0 ? 1 : Math.min(1, elapsed / duration);
      const eased = easing(t);

      if (target.originX !== undefined) this.originX = startOriginX + (target.originX - startOriginX) * eased;
      if (target.originY !== undefined) this.originY = startOriginY + (target.originY - startOriginY) * eased;
      if (target.cellSize !== undefined) this.cellSize = startCellSize + (target.cellSize - startCellSize) * eased;

      if (t >= 1) {
        this.animHandle = null;
        this.animScheduler = null;
        return;
      }
      this.animHandle = scheduler.request(step);
    };
    this.animHandle = scheduler.request(step);
  }
}
