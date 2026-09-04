/**
 * The 2D camera: the world/screen transform every tool, overlay, and renderer under
 * `src/ui/**` shares (Phase 1 §2.3). `cellSize` is device px per world cell and stays
 * fractional throughout — snapping it to an integer is what makes wheel-zoom feel notchy
 * instead of smooth. It is clamped to [{@link MIN_CELL_SIZE}, {@link MAX_CELL_SIZE}]; below
 * 1 px/cell the renderer's density-LOD path takes over (ADR-005).
 *
 * `animateTo` — part of Phase 1 §2.3's full `Camera` contract — is deliberately not here yet.
 * P1-A-2's inertia turned out not to need it either: a friction coast is a continuous physics
 * simulation driven by repeated `panBy` calls, not a fixed-duration eased tween. `animateTo`
 * stays deferred until a task adds a genuine fixed-target transition (a "fit to content" button,
 * double-click-to-zoom) — that task can define the `Easing` contract it actually needs, rather
 * than this one guessing at a shape nothing exercises yet.
 */
import type { Rect } from '@shared/types';

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
}
