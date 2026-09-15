/**
 * P3-A-5 — background passes (L0): starfield, parchment, sun gradient, text rain.
 */
import { Mulberry32 } from '@shared/rng';
import type { EffectCtx } from './ctx';
import { SoftwareSurface } from './software-surface';
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
  const ox = starOriginShift(viewport.originX, parallax, viewport.cellSize, viewport.widthPx);
  const oy = starOriginShift(viewport.originY, parallax, viewport.cellSize, viewport.heightPx);
  return {
    x: wrapCoord(wx - ox, viewport.widthPx),
    y: wrapCoord(wy - oy, viewport.heightPx),
  };
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
    for (let layer = 0; layer < this.layerCount; layer++) {
      const parallax = starParallax(layer);
      const size = 1 + (layer === this.layerCount - 1 ? 1 : 0);
      for (let s = 0; s < this.starsPerLayer; s++) {
        const i = (layer * this.starsPerLayer + s) * 3;
        const wx = stars[i]!;
        const wy = stars[i + 1]!;
        const br = stars[i + 2]!;
        const pos = starScreenPosition(
          wx,
          wy,
          { originX, originY, cellSize, widthPx: w, heightPx: h },
          parallax,
        );
        const a = ctx.reducedMotion ? br * 0.7 : br;
        ctx.target.globalAlpha = a;
        ctx.target.fillStyle = '#e8e0ff';
        ctx.target.fillRect(pos.x, pos.y, size, size);
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
}

export function createParchmentTexturePass(opts: ParchmentTextureOptions = {}): TimedPass & {
  /** True after the one-shot procedural bake. */
  readonly generated: boolean;
  generationMs: number;
  generate(): void;
} {
  return new ParchmentTexturePass(opts);
}

class ParchmentTexturePass extends TimedPass {
  readonly id = 'parchmentTexture';
  readonly stage = 'background' as const;
  readonly declaredCost = 0.2;
  private readonly seed: number;
  private readonly texW: number;
  private readonly texH: number;
  private texture: SoftwareSurface | null = null;
  generated = false;
  generationMs = 0;

  constructor(opts: ParchmentTextureOptions) {
    super();
    this.seed = opts.seed ?? 0x50415243;
    this.texW = opts.width ?? 256;
    this.texH = opts.height ?? 256;
  }

  /** Bake once — themes call this on activation; also lazy on first render. */
  generate(): void {
    if (this.generated && this.texture) return;
    const t0 = performance.now();
    const surf = new SoftwareSurface(this.texW, this.texH);
    const rng = new Mulberry32(this.seed);
    const px = surf.pixels;
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
    this.texture = surf;
    this.generated = true;
    this.generationMs = performance.now() - t0;
  }

  protected renderTimed(ctx: EffectCtx): void {
    if (!this.generated) this.generate();
    const w = ctx.viewport.widthPx;
    const h = ctx.viewport.heightPx;
    ctx.target.clearRect(0, 0, w, h);
    if (this.texture) {
      ctx.target.drawImage(
        this.texture.canvas as unknown as CanvasImageSource,
        0,
        0,
        this.texW,
        this.texH,
        0,
        0,
        w,
        h,
      );
    }
  }

  protected override onDispose(): void {
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

class SunGradientPass extends TimedPass {
  readonly id = 'sunGradient';
  readonly stage = 'background' as const;
  readonly declaredCost = 0.4;
  private readonly top: string;
  private readonly bottom: string;
  private readonly sunColor: string;
  private readonly sunY: number;

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
    // Banded vertical gradient (software-canvas has no real CanvasGradient).
    const bands = 32;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      ctx.target.fillStyle = lerpHex(this.top, this.bottom, t);
      ctx.target.fillRect(0, ((i * h) / bands) | 0, w, Math.ceil(h / bands) + 1);
    }
    const cy = h * this.sunY;
    const cx = w * 0.5;
    const r = Math.min(w, h) * 0.12;
    ctx.target.fillStyle = this.sunColor;
    // Approximate sun as a filled square stack (circle without path API).
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      ctx.target.fillRect(cx - half, cy + dy, half * 2, 1);
    }
  }
}

export interface TextRainOptions {
  readonly seed?: number;
  readonly columns?: number;
  readonly color?: string;
  readonly opacity?: number;
}

export function createTextRainPass(opts: TextRainOptions = {}): TimedPass {
  return new TextRainPass(opts);
}

class TextRainPass extends TimedPass {
  readonly id = 'textRain';
  readonly stage = 'background' as const;
  readonly declaredCost = 1.2;
  private readonly seed: number;
  private readonly columns: number;
  private readonly color: string;
  private readonly opacity: number;
  private offsets: Float32Array | null = null;
  private speeds: Float32Array | null = null;

  constructor(opts: TextRainOptions) {
    super();
    this.seed = opts.seed ?? 0x7e57;
    this.columns = opts.columns ?? 48;
    this.color = opts.color ?? '#ffb000';
    this.opacity = opts.opacity ?? 0.12;
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
    ctx.target.globalAlpha = this.opacity;
    ctx.target.fillStyle = this.color;
    const t = ctx.reducedMotion ? 0 : ctx.frameTime;
    for (let c = 0; c < this.columns; c++) {
      const phase = (this.offsets![c]! + t * this.speeds![c]!) % 1;
      const y = phase * h;
      const x = c * colW + colW * 0.35;
      // Glyph stand-in: 2×6 block (no font metrics in software ctx).
      ctx.target.fillRect(x, y, Math.max(1, colW * 0.25), 6);
      ctx.target.fillRect(x, (y + 14) % h, Math.max(1, colW * 0.25), 6);
    }
    ctx.target.globalAlpha = 1;
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

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = (pa[0] + (pb[0] - pa[0]) * t) | 0;
  const g = (pa[1] + (pb[1] - pa[1]) * t) | 0;
  const bl = (pa[2] + (pb[2] - pa[2]) * t) | 0;
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
}

function parseHex(s: string): [number, number, number] {
  const h = s.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}
