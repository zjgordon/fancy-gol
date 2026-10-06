/**
 * P3-A-5 / P3-E-3 — background passes (L0): starfield, parchment, sun gradient, text rain, haze grid.
 *
 * **Composited, not computed (ADR-012).** L0 is repainted only when the theme, size, quality or (for a
 * parallax theme) the camera changes, so these are not per-frame costs, but they must still be cheap
 * and allocation-free: parchment used to allocate an 8 MB buffer and loop over 2 M texels on every
 * repaint, and the sun was ~290 one-pixel rects. They draw with real Canvas2D operations now, from
 * resources baked once at activation or resize.
 */
import { Mulberry32 } from '@shared/rng';
import type { EffectCtx } from './ctx';
import { createSurface, releaseSurface, type CanvasFactory, type Surface } from './surface';
import { TimedPass } from './timed-pass';

export const STARFIELD_PERIOD = 4096;

/** Layer 0 is farthest; each layer drifts faster with the camera. */
export function starParallax(layer: number): number {
  return 0.15 + layer * 0.25;
}

export function wrapCoord(value: number, extent: number): number {
  if (!(extent > 0)) return 0;
  const r = value % extent;
  return r < 0 ? r + extent : r;
}

/**
 * Camera shift in pixels, wrapped into one viewport period so a huge origin
 * cannot accumulate floating-point drift. Pure function of origin — pan away
 * and back lands on the same coordinate.
 */
export function starOriginShift(
  origin: number,
  parallax: number,
  cellSize: number,
  extentPx: number,
): number {
  const denom = parallax * cellSize;
  if (!(denom > 0) || !(extentPx > 0)) return 0;
  const period = extentPx / denom;
  const wrapped = origin - Math.floor(origin / period) * period;
  return wrapped * denom;
}

export function starScreenPosition(
  wx: number,
  wy: number,
  viewport: { originX: number; originY: number; cellSize: number; widthPx: number; heightPx: number },
  parallax: number,
): { x: number; y: number } {
  return {
    x: starScreenX(wx, viewport, parallax),
    y: starScreenY(wy, viewport, parallax),
  };
}

type StarViewport = { originX: number; originY: number; cellSize: number; widthPx: number; heightPx: number };

/** The two axes of {@link starScreenPosition}, separately, so the per-frame loop allocates no object per star. */
export function starScreenX(wx: number, vp: StarViewport, parallax: number): number {
  return wrapCoord(wx - starOriginShift(vp.originX, parallax, vp.cellSize, vp.widthPx), vp.widthPx);
}

export function starScreenY(wy: number, vp: StarViewport, parallax: number): number {
  return wrapCoord(wy - starOriginShift(vp.originY, parallax, vp.cellSize, vp.heightPx), vp.heightPx);
}

export interface StarfieldOptions {
  readonly seed?: number;
  readonly layers?: number;
  readonly starsPerLayer?: number;
}

export function createStarfieldPass(opts: StarfieldOptions = {}): TimedPass {
  return new StarfieldPass(opts);
}

class StarfieldPass extends TimedPass {
  readonly id = 'starfield';
  readonly stage = 'background' as const;
  readonly declaredCost = 0.8;
  private readonly seed: number;
  private readonly layerCount: number;
  private readonly starsPerLayer: number;
  /** Packed [x,y,brightness] per star, world-fixed — parallax from camera only. */
  private stars: Float32Array | null = null;
  /** Reused every frame: the viewport the star positions are computed against. */
  private readonly vp: StarViewport = { originX: 0, originY: 0, cellSize: 1, widthPx: 1, heightPx: 1 };

  constructor(opts: StarfieldOptions) {
    super();
    this.seed = opts.seed ?? 0xc0ffee;
    this.layerCount = opts.layers ?? 3;
    this.starsPerLayer = opts.starsPerLayer ?? 80;
  }

  private ensureStars(): void {
    if (this.stars) return;
    const n = this.layerCount * this.starsPerLayer;
    this.stars = new Float32Array(n * 3);
    const rng = new Mulberry32(this.seed);
    for (let i = 0; i < n; i++) {
      this.stars[i * 3] = rng.next() * STARFIELD_PERIOD;
      this.stars[i * 3 + 1] = rng.next() * STARFIELD_PERIOD;
      this.stars[i * 3 + 2] = 0.35 + rng.next() * 0.65;
    }
  }

  protected renderTimed(ctx: EffectCtx): void {
    this.ensureStars();
    const { widthPx: w, heightPx: h, originX, originY, cellSize } = ctx.viewport;
    ctx.target.clearRect(0, 0, w, h);
    ctx.target.fillStyle = '#05010f';
    ctx.target.fillRect(0, 0, w, h);
    const stars = this.stars!;
    const vp = this.vp;
    vp.originX = originX;
    vp.originY = originY;
    vp.cellSize = cellSize;
    vp.widthPx = w;
    vp.heightPx = h;
    for (let layer = 0; layer < this.layerCount; layer++) {
      const parallax = starParallax(layer);
      const size = 1 + (layer === this.layerCount - 1 ? 1 : 0);
      for (let s = 0; s < this.starsPerLayer; s++) {
        const i = (layer * this.starsPerLayer + s) * 3;
        const wx = stars[i]!;
        const wy = stars[i + 1]!;
        const br = stars[i + 2]!;
        const a = ctx.reducedMotion ? br * 0.7 : br;
        ctx.target.globalAlpha = a;
        ctx.target.fillStyle = '#e8e0ff';
        ctx.target.fillRect(starScreenX(wx, vp, parallax), starScreenY(wy, vp, parallax), size, size);
      }
    }
    ctx.target.globalAlpha = 1;
  }

  protected override onDispose(): void {
    this.stars = null;
  }
}

export interface ParchmentTextureOptions {
  readonly seed?: number;
  readonly width?: number;
  readonly height?: number;
  readonly canvasFactory?: CanvasFactory;
}

export function createParchmentTexturePass(opts: ParchmentTextureOptions = {}): TimedPass & {
  /** True after the one-shot procedural bake. */
  readonly generated: boolean;
  generationMs: number;
  generate(): void;
} {
  return new ParchmentTexturePass(opts);
}

/**
 * Procedural parchment, baked once into a small canvas and scaled to the viewport with a single
 * nearest-neighbour `drawImage`. Per-texel work happens only in {@link generate} — at activation, not
 * on any repaint — which is what ADR-012 permits.
 */
class ParchmentTexturePass extends TimedPass {
  readonly id = 'parchmentTexture';
  readonly stage = 'background' as const;
  readonly declaredCost = 0.2;
  private readonly seed: number;
  private readonly texW: number;
  private readonly texH: number;
  private readonly factory: CanvasFactory | undefined;
  private texture: Surface | null = null;
  generated = false;
  generationMs = 0;

  constructor(opts: ParchmentTextureOptions) {
    super();
    this.seed = opts.seed ?? 0x50415243;
    this.texW = opts.width ?? 256;
    this.texH = opts.height ?? 256;
    this.factory = opts.canvasFactory;
  }

  /** Bake once — themes call this on activation; also lazy on first render. */
  generate(): void {
    if (this.generated && this.texture) return;
    const t0 = performance.now();
    const surface = createSurface(this.factory, this.texW, this.texH);
    const image = surface.ctx.createImageData(this.texW, this.texH);
    const rng = new Mulberry32(this.seed);
    const px = image.data;
    for (let y = 0; y < this.texH; y++) {
      for (let x = 0; x < this.texW; x++) {
        const n =
          0.55 +
          0.15 * Math.sin(x * 0.07 + rng.next() * 0.01) +
          0.12 * Math.sin(y * 0.05) +
          0.08 * rng.next();
        const base = 180 + n * 40;
        const i = (y * this.texW + x) * 4;
        px[i] = (base + 12) | 0;
        px[i + 1] = (base - 8) | 0;
        px[i + 2] = (base - 28) | 0;
        px[i + 3] = 255;
      }
    }
    surface.ctx.putImageData(image, 0, 0);
    this.texture = surface;
    this.generated = true;
    this.generationMs = performance.now() - t0;
  }

  protected renderTimed(ctx: EffectCtx): void {
    if (!this.generated) this.generate();
    const texture = this.texture;
    if (!texture) return;
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const target = ctx.target;
    target.save();
    target.imageSmoothingEnabled = false; // hand-made grain: nearest, never blurred
    target.drawImage(texture.canvas, 0, 0, this.texW, this.texH, 0, 0, w, h);
    target.restore();
  }

  protected override onDispose(): void {
    releaseSurface(this.texture);
    this.texture = null;
    this.generated = false;
  }
}

export interface SunGradientOptions {
  readonly top?: string;
  readonly bottom?: string;
  readonly sunColor?: string;
  readonly sunY?: number;
}

export function createSunGradientPass(opts: SunGradientOptions = {}): TimedPass {
  return new SunGradientPass(opts);
}

/**
 * A vertical gradient and a disc: two fills, where the stepped version was ~290 one-pixel rects. The
 * gradient object is cached against the viewport height.
 */
class SunGradientPass extends TimedPass {
  readonly id = 'sunGradient';
  readonly stage = 'background' as const;
  readonly declaredCost = 0.4;
  private readonly top: string;
  private readonly bottom: string;
  private readonly sunColor: string;
  private readonly sunY: number;
  private gradient: CanvasGradient | null = null;
  private gradientHeight = -1;

  constructor(opts: SunGradientOptions) {
    super();
    this.top = opts.top ?? '#1a0033';
    this.bottom = opts.bottom ?? '#ff2a6d';
    this.sunColor = opts.sunColor ?? '#ffcc66';
    this.sunY = opts.sunY ?? 0.55;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx;
    const h = ctx.viewport.heightPx;
    const t = ctx.target;
    if (!this.gradient || this.gradientHeight !== h) {
      const g = t.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, this.top);
      g.addColorStop(1, this.bottom);
      this.gradient = g;
      this.gradientHeight = h;
    }
    t.save();
    t.fillStyle = this.gradient;
    t.fillRect(0, 0, w, h);
    t.fillStyle = this.sunColor;
    t.beginPath();
    t.arc(w * 0.5, h * this.sunY, Math.min(w, h) * 0.12, 0, Math.PI * 2);
    t.fill();
    t.restore();
  }

  protected override onDispose(): void {
    this.gradient = null;
  }
}

export interface TextRainOptions {
  readonly seed?: number;
  readonly columns?: number;
  readonly color?: string;
  readonly opacity?: number;
  /** The base colour painted under the rain. L1 is transparent for this theme, so L0 owns its background. */
  readonly background?: string;
}

export function createTextRainPass(opts: TextRainOptions = {}): TimedPass {
  return new TextRainPass(opts);
}

/**
 * Faint falling glyph stand-ins behind the cells. It is `animated`: the compositor repaints L0 every
 * frame while it is active (and not under reduced motion, where it freezes), which is what lets it
 * fall at all — in a static L0 it was drawn once and never moved. All glyphs go in one path, one fill.
 */
class TextRainPass extends TimedPass {
  readonly id = 'textRain';
  readonly stage = 'background' as const;
  readonly declaredCost = 1.2;
  override readonly animated = true;
  private readonly seed: number;
  private readonly columns: number;
  private readonly color: string;
  private readonly opacity: number;
  private readonly background: string | undefined;
  private offsets: Float32Array | null = null;
  private speeds: Float32Array | null = null;

  constructor(opts: TextRainOptions) {
    super();
    this.seed = opts.seed ?? 0x7e57;
    this.columns = opts.columns ?? 48;
    this.color = opts.color ?? '#ffb000';
    this.opacity = opts.opacity ?? 0.12;
    this.background = opts.background;
  }

  private ensure(): void {
    if (this.offsets) return;
    this.offsets = new Float32Array(this.columns);
    this.speeds = new Float32Array(this.columns);
    const rng = new Mulberry32(this.seed);
    for (let i = 0; i < this.columns; i++) {
      this.offsets[i] = rng.next();
      this.speeds[i] = 0.15 + rng.next() * 0.55;
    }
  }

  protected renderTimed(ctx: EffectCtx): void {
    this.ensure();
    const w = ctx.viewport.widthPx;
    const h = ctx.viewport.heightPx;
    const colW = w / this.columns;
    const glyphW = Math.max(1, colW * 0.25);
    const t = ctx.reducedMotion ? 0 : ctx.frameTime;
    const target = ctx.target;
    target.save();
    if (this.background) {
      target.fillStyle = this.background;
      target.fillRect(0, 0, w, h);
    }
    target.globalAlpha = this.opacity;
    target.fillStyle = this.color;
    target.beginPath();
    for (let c = 0; c < this.columns; c++) {
      const y = ((this.offsets![c]! + t * this.speeds![c]!) % 1) * h;
      const x = c * colW + colW * 0.35;
      // Glyph stand-in: a 6 px block, twice per column (no font metrics needed).
      target.rect(x, y, glyphW, 6);
      target.rect(x, (y + 14) % h, glyphW, 6);
    }
    target.fill();
    target.restore();
  }

  protected override onDispose(): void {
    this.offsets = null;
    this.speeds = null;
  }
}

export interface HazeGridOptions {
  readonly bg?: string;
  readonly line?: string;
}

/** Chiba-City L0: near-black fill with a faint cyan grid that recedes into haze. */
export function createHazeGridPass(opts: HazeGridOptions = {}): TimedPass {
  return new HazeGridPass(opts);
}

class HazeGridPass extends TimedPass {
  readonly id = 'hazeGrid';
  readonly stage = 'background' as const;
  readonly declaredCost = 0.4;
  private readonly bg: string;
  private readonly line: string;

  constructor(opts: HazeGridOptions) {
    super();
    this.bg = opts.bg ?? '#05090c';
    this.line = opts.line ?? '#2ee6d6';
  }

  protected renderTimed(ctx: EffectCtx): void {
    const { widthPx: w, heightPx: h, originX, originY, cellSize } = ctx.viewport;
    ctx.target.globalAlpha = 1;
    ctx.target.fillStyle = this.bg;
    ctx.target.fillRect(0, 0, w, h);

    if (cellSize < 0.5) return;

    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxR = Math.hypot(cx, cy) || 1;
    const decadeOnly = cellSize < 4;
    const step = decadeOnly ? 10 : 1;
    const worldX0 = originX;
    const worldY0 = originY;
    const worldX1 = originX + w / cellSize;
    const worldY1 = originY + h / cellSize;
    const gx0 = Math.floor(worldX0 / step) * step;
    const gy0 = Math.floor(worldY0 / step) * step;

    ctx.target.fillStyle = this.line;
    for (let gx = gx0; gx <= worldX1; gx += step) {
      const sx = (gx - originX) * cellSize;
      if (sx < -1 || sx > w + 1) continue;
      const decade = ((gx % 10) + 10) % 10 === 0;
      if (decadeOnly && !decade) continue;
      const edge = Math.min(1, Math.abs(sx - cx) / maxR);
      const a = (decade ? 0.14 : 0.045) * (1 - edge * 0.85);
      if (a < 0.008) continue;
      ctx.target.globalAlpha = a;
      ctx.target.fillRect(sx, 0, 1, h);
    }
    for (let gy = gy0; gy <= worldY1; gy += step) {
      const sy = (gy - originY) * cellSize;
      if (sy < -1 || sy > h + 1) continue;
      const decade = ((gy % 10) + 10) % 10 === 0;
      if (decadeOnly && !decade) continue;
      const edge = Math.min(1, Math.abs(sy - cy) / maxR);
      const a = (decade ? 0.14 : 0.045) * (1 - edge * 0.85);
      if (a < 0.008) continue;
      ctx.target.globalAlpha = a;
      ctx.target.fillRect(0, sy, w, 1);
    }
    ctx.target.globalAlpha = 1;
  }
}

