/**
 * The "boring feature" made fancy (INCEPTION's "Stay Fancy"): world-space grid lines that fade
 * in with zoom instead of hard-toggling, a stronger decade line every 10 cells, a labelled
 * origin cross, and a "you are here" badge that appears while the camera is moving and fades
 * out {@link ACTIVITY_FADE_MS} after it stops. Driven entirely by a `Camera` snapshot each
 * `draw()` call, so this has no dependency on P1-A-2's gestures or P1-B-1's not-yet-built input
 * router — it just repaints whatever the camera's current transform is, whenever it's asked to.
 *
 * Both fades are shaped by an injectable `(t: number) => number` {@link FadeCurve} rather than a
 * bespoke literal formula — the same shape ADR-008's `MotionSignature.easings` will eventually
 * have. P1-E-1 (the token contract) doesn't exist yet, so {@link SMOOTHSTEP} here is a
 * hand-written provisional default, not a real theme token; once P1-E-1 lands, its motion
 * tokens slot into `fadeCurve` with no API change to this module (see that task's note).
 *
 * Colours are a required, explicit {@link GridLinesPalette} — no hardcoded grey fallback, the
 * same discipline `render/canvas2d.ts`'s `CompiledTheme` requirement already established.
 * Palette entries are `{r,g,b}` triples rather than CSS strings: `ui/` may not import
 * `render/canvas2d.ts`'s `parseColor` (ADR-009 — only `render/types` is reachable from `ui/`),
 * and re-deriving a CSS colour parser here just to re-add alpha would duplicate it for no gain.
 */
import type { Camera } from '@ui/camera';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type FadeCurve = (t: number) => number;

/** Hand-written smoothstep (3t² − 2t³) — see the module doc: provisional until P1-E-1. */
export const SMOOTHSTEP: FadeCurve = (t) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface GridLinesPalette {
  readonly minor: RGB;
  readonly decade: RGB;
  readonly origin: RGB;
  readonly badge: RGB;
  readonly badgeText: RGB;
}

export interface GridLinesOptions {
  readonly fadeCurve?: FadeCurve;
  readonly font?: string;
}

function rgba({ r, g, b }: RGB, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * A 1-device-px stroke centred exactly on an integer coordinate straddles two pixel rows/columns
 * and is rendered blurry by anti-aliasing; offsetting by half a pixel lands it cleanly on one.
 * Camera coordinates are already device px (P1-A-1), so this needs no separate DPR handling —
 * "crisp at any devicePixelRatio" falls out of always being crisp in device-pixel space.
 */
export function snapForCrispStroke(px: number): number {
  return Math.round(px) + 0.5;
}

/** Below this `cellSize`, grid lines are fully transparent — see {@link GRID_FADE_RANGE}. */
const GRID_FADE_START = 6;
/** The zoom fade completes (full opacity) at `GRID_FADE_START + GRID_FADE_RANGE`. */
const GRID_FADE_RANGE = 4;
const DECADE_SPACING = 10;
const MINOR_ALPHA = 0.12;
const DECADE_ALPHA = 0.3;
const ORIGIN_ALPHA = 0.6;
const LINE_WIDTH = 1;

/** How long after the camera stops changing the "you are here" badge takes to fade out. */
const ACTIVITY_FADE_MS = 600;
const BADGE_MARGIN = 12;
const BADGE_PADDING = 10;
const BADGE_HEIGHT = 24;
const BADGE_RADIUS = 6;
const DEFAULT_FONT = '12px monospace';

type LineStyle = 'minor' | 'decade' | 'origin';

export class GridLinesOverlay {
  private readonly palette: GridLinesPalette;
  private readonly fadeCurve: FadeCurve;
  private readonly font: string;

  private lastOriginX = NaN;
  private lastOriginY = NaN;
  private lastCellSize = NaN;
  private lastActivityMs = -Infinity;

  constructor(palette: GridLinesPalette, options: GridLinesOptions = {}) {
    this.palette = palette;
    this.fadeCurve = options.fadeCurve ?? SMOOTHSTEP;
    this.font = options.font ?? DEFAULT_FONT;
  }

  /** Paint the overlay for the current camera state. `nowMs` drives the badge's activity fade. */
  draw(ctx: Canvas2DContext, camera: Camera, nowMs: number): void {
    this.trackActivity(camera, nowMs);

    const zoomOpacity = this.fadeCurve(clamp01((camera.cellSize - GRID_FADE_START) / GRID_FADE_RANGE));
    ctx.save();
    if (zoomOpacity > 0) {
      this.drawGrid(ctx, camera, zoomOpacity);
    }

    const badgeOpacity = 1 - this.fadeCurve(clamp01((nowMs - this.lastActivityMs) / ACTIVITY_FADE_MS));
    if (badgeOpacity > 0.001) {
      this.drawBadge(ctx, camera, badgeOpacity);
    }
    ctx.restore();
  }

  private trackActivity(camera: Camera, nowMs: number): void {
    if (
      camera.originX !== this.lastOriginX ||
      camera.originY !== this.lastOriginY ||
      camera.cellSize !== this.lastCellSize
    ) {
      this.lastActivityMs = nowMs;
      this.lastOriginX = camera.originX;
      this.lastOriginY = camera.originY;
      this.lastCellSize = camera.cellSize;
    }
  }

  private drawGrid(ctx: Canvas2DContext, camera: Camera, opacity: number): void {
    const a = camera.screenToWorld(0, 0);
    const b = camera.screenToWorld(camera.widthPx, camera.heightPx);
    const x0 = Math.floor(Math.min(a.x, b.x));
    const x1 = Math.ceil(Math.max(a.x, b.x));
    const y0 = Math.floor(Math.min(a.y, b.y));
    const y1 = Math.ceil(Math.max(a.y, b.y));

    ctx.lineWidth = LINE_WIDTH;
    for (let x = x0; x <= x1; x++) {
      this.strokeVertical(ctx, camera, x, lineStyle(x), opacity);
    }
    for (let y = y0; y <= y1; y++) {
      this.strokeHorizontal(ctx, camera, y, lineStyle(y), opacity);
    }

    if (x0 <= 0 && 0 <= x1 && y0 <= 0 && 0 <= y1 && opacity > 0.3) {
      this.drawOriginLabel(ctx, camera, opacity);
    }
  }

  private strokeVertical(ctx: Canvas2DContext, camera: Camera, worldX: number, style: LineStyle, opacity: number): void {
    const { px } = camera.worldToScreen(worldX, 0);
    const x = snapForCrispStroke(px);
    ctx.strokeStyle = this.styleColor(style, opacity);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, camera.heightPx);
    ctx.stroke();
  }

  private strokeHorizontal(ctx: Canvas2DContext, camera: Camera, worldY: number, style: LineStyle, opacity: number): void {
    const { py } = camera.worldToScreen(0, worldY);
    const y = snapForCrispStroke(py);
    ctx.strokeStyle = this.styleColor(style, opacity);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(camera.widthPx, y);
    ctx.stroke();
  }

  private styleColor(style: LineStyle, opacity: number): string {
    switch (style) {
      case 'origin':
        return rgba(this.palette.origin, ORIGIN_ALPHA * opacity);
      case 'decade':
        return rgba(this.palette.decade, DECADE_ALPHA * opacity);
      case 'minor':
        return rgba(this.palette.minor, MINOR_ALPHA * opacity);
    }
  }

  private drawOriginLabel(ctx: Canvas2DContext, camera: Camera, opacity: number): void {
    const { px, py } = camera.worldToScreen(0, 0);
    ctx.save();
    ctx.font = this.font;
    ctx.fillStyle = rgba(this.palette.origin, opacity);
    ctx.textBaseline = 'top';
    ctx.fillText('(0, 0)', px + 4, py + 4);
    ctx.restore();
  }

  private drawBadge(ctx: Canvas2DContext, camera: Camera, opacity: number): void {
    const a = camera.screenToWorld(0, 0);
    const b = camera.screenToWorld(camera.widthPx, camera.heightPx);
    const text = `(${Math.round(a.x)}, ${Math.round(a.y)}) → (${Math.round(b.x)}, ${Math.round(b.y)})  ×${camera.cellSize.toFixed(2)}`;

    ctx.save();
    ctx.font = this.font;
    const width = ctx.measureText(text).width + BADGE_PADDING * 2;
    const x = camera.widthPx - BADGE_MARGIN - width;
    const y = camera.heightPx - BADGE_MARGIN - BADGE_HEIGHT;

    ctx.fillStyle = rgba(this.palette.badge, 0.85 * opacity);
    ctx.beginPath();
    ctx.roundRect(x, y, width, BADGE_HEIGHT, BADGE_RADIUS);
    ctx.fill();

    ctx.fillStyle = rgba(this.palette.badgeText, opacity);
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + BADGE_PADDING, y + BADGE_HEIGHT / 2);
    ctx.restore();
  }
}

function lineStyle(worldCoord: number): LineStyle {
  if (worldCoord === 0) return 'origin';
  return worldCoord % DECADE_SPACING === 0 ? 'decade' : 'minor';
}
