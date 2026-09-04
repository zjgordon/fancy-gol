/**
 * Draws P1-B-5's marquee-select rectangle and, once a selection is finalised, an animated
 * "marching ants" outline around it. Reads `SelectTool`'s current rects directly rather than
 * duplicating that state here.
 *
 * The march speed is an injectable duration (not a literal) — the same treatment
 * `grid-lines.ts`'s `FadeCurve` gave P1-A-3's zoom fade, for the same reason: P1-E-1's real
 * motion-duration tokens don't exist yet, so `DEFAULT_MARCH_PERIOD_MS` is a hand-written
 * placeholder, not a theme value, but the point of "not a literal" — a swappable, named value
 * rather than a number baked into the draw call — holds today regardless. `reducedMotion` is
 * reused directly from `gestures.ts` (same query, same default), not re-declared.
 */
import type { Camera } from '@ui/camera';
import { SYSTEM_REDUCED_MOTION, type ReducedMotionQuery } from '@ui/input/gestures';
import type { Rect } from '@shared/types';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface SelectionOverlaySource {
  readonly marqueeRect: Rect | null;
  readonly selectedRect: Rect | null;
}

export interface SelectionOverlayOptions {
  readonly marchPeriodMs?: number;
  readonly reducedMotion?: ReducedMotionQuery;
  readonly color?: RGB;
}

/** One full dash-pattern cycle takes this long when marching. Provisional — see the module doc. */
export const DEFAULT_MARCH_PERIOD_MS = 600;
const DASH_LENGTH = 6;
const MARQUEE_ALPHA = 0.9;
const SELECTION_ALPHA = 0.9;

function rgba({ r, g, b }: RGB, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export class SelectionOverlay {
  private readonly marchPeriodMs: number;
  private readonly reducedMotion: ReducedMotionQuery;
  private readonly color: RGB;

  constructor(options: SelectionOverlayOptions = {}) {
    this.marchPeriodMs = options.marchPeriodMs ?? DEFAULT_MARCH_PERIOD_MS;
    this.reducedMotion = options.reducedMotion ?? SYSTEM_REDUCED_MOTION;
    this.color = options.color ?? { r: 255, g: 255, b: 255 };
  }

  draw(ctx: Canvas2DContext, camera: Camera, source: SelectionOverlaySource, nowMs: number): void {
    if (source.marqueeRect) {
      this.strokeRect(ctx, camera, source.marqueeRect, 0, MARQUEE_ALPHA);
    }
    if (source.selectedRect) {
      const dashCycle = DASH_LENGTH * 2;
      const offset = this.reducedMotion() ? 0 : ((nowMs / this.marchPeriodMs) * dashCycle) % dashCycle;
      this.strokeRect(ctx, camera, source.selectedRect, offset, SELECTION_ALPHA);
    }
  }

  private strokeRect(ctx: Canvas2DContext, camera: Camera, rect: Rect, dashOffset: number, alpha: number): void {
    const topLeft = camera.worldToScreen(rect.x, rect.y);
    const bottomRight = camera.worldToScreen(rect.x + rect.width, rect.y + rect.height);
    ctx.save();
    ctx.strokeStyle = rgba(this.color, alpha);
    ctx.lineWidth = 1;
    ctx.setLineDash([DASH_LENGTH, DASH_LENGTH]);
    ctx.lineDashOffset = -dashOffset;
    ctx.strokeRect(
      Math.round(topLeft.px) + 0.5,
      Math.round(topLeft.py) + 0.5,
      Math.round(bottomRight.px) - Math.round(topLeft.px) - 1,
      Math.round(bottomRight.py) - Math.round(topLeft.py) - 1,
    );
    ctx.restore();
  }
}
