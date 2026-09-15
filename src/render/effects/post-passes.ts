/**
 * P3-A-5 — post-process passes (L3): bloom, scanlines, aberration, vignette, grain, CRT.
 */
import { boxBlurSeparable, downsampleNearest, upsampleAdd } from './box-blur';
import type { EffectCtx } from './ctx';
import { readSourcePixels, writeTargetPixels } from './software-surface';
import { TimedPass } from './timed-pass';
import { Mulberry32 } from '@shared/rng';

export interface BloomOptions {
  readonly strength?: number;
  readonly radius?: number;
  readonly threshold?: number;
}

export function createBloomPass(opts: BloomOptions = {}): TimedPass {
  return new BloomPass(opts);
}

class BloomPass extends TimedPass {
  readonly id = 'bloom';
  readonly stage = 'post' as const;
  readonly declaredCost = 2.5;
  private readonly strength: number;
  private readonly radius: number;
  private readonly threshold: number;
  private half: Uint8ClampedArray | null = null;
  private tmp: Uint8ClampedArray | null = null;
  private blur: Uint8ClampedArray | null = null;
  private halfW = 0;
  private halfH = 0;

  constructor(opts: BloomOptions) {
    super();
    this.strength = opts.strength ?? 0.55;
    this.radius = opts.radius ?? 2;
    this.threshold = opts.threshold ?? 40;
  }

  override resize(widthPx: number, heightPx: number, _dpr: number): void {
    this.halfW = Math.max(1, widthPx >> 1);
    this.halfH = Math.max(1, heightPx >> 1);
    const n = this.halfW * this.halfH * 4;
    this.half = new Uint8ClampedArray(n);
    this.tmp = new Uint8ClampedArray(n);
    this.blur = new Uint8ClampedArray(n);
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (!this.half || this.halfW !== (w >> 1) || this.halfH !== (h >> 1)) {
      this.resize(w, h, ctx.viewport.dpr);
    }
    const src = readSourcePixels(ctx.source, w, h);
    const out = src.slice();
    // Threshold: keep bright texels only in the downsample path.
    const bright = src.slice();
    for (let i = 0; i < bright.length; i += 4) {
      const lum = (bright[i]! + bright[i + 1]! + bright[i + 2]!) / 3;
      if (lum < this.threshold) {
        bright[i] = 0;
        bright[i + 1] = 0;
        bright[i + 2] = 0;
        bright[i + 3] = 0;
      }
    }
    downsampleNearest(bright, w, h, this.half!, this.halfW, this.halfH);
    boxBlurSeparable(this.half!, this.blur!, this.tmp!, this.halfW, this.halfH, this.radius);
    upsampleAdd(this.blur!, this.halfW, this.halfH, out, w, h, this.strength);
    writeTargetPixels(ctx.target, out, w, h);
  }

  protected override onDispose(): void {
    this.half = null;
    this.tmp = null;
    this.blur = null;
  }
}

export interface ScanlinesOptions {
  readonly opacity?: number;
}

export function createScanlinesPass(opts: ScanlinesOptions = {}): TimedPass {
  return new ScanlinesPass(opts);
}

class ScanlinesPass extends TimedPass {
  readonly id = 'scanlines';
  readonly stage = 'post' as const;
  readonly declaredCost = 0.3;
  private readonly opacity: number;

  constructor(opts: ScanlinesOptions) {
    super();
    this.opacity = opts.opacity ?? 0.18;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const pitch = Math.max(1, Math.round(ctx.viewport.dpr));
    const src = readSourcePixels(ctx.source, w, h);
    const out = src.slice();
    const dark = 1 - this.opacity;
    for (let y = 0; y < h; y++) {
      if (((y / pitch) | 0) % 2 === 0) continue;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        out[i] = (out[i]! * dark) | 0;
        out[i + 1] = (out[i + 1]! * dark) | 0;
        out[i + 2] = (out[i + 2]! * dark) | 0;
      }
    }
    writeTargetPixels(ctx.target, out, w, h);
  }
}

export interface ChromaticAberrationOptions {
  readonly amount?: number;
  /** 0 = full frame, 1 = edges only. */
  readonly edgeBias?: number;
}

export function createChromaticAberrationPass(opts: ChromaticAberrationOptions = {}): TimedPass {
  return new ChromaticAberrationPass(opts);
}

class ChromaticAberrationPass extends TimedPass {
  readonly id = 'chromaticAberration';
  readonly stage = 'post' as const;
  readonly declaredCost = 1.2;
  private readonly amount: number;
  private readonly edgeBias: number;

  constructor(opts: ChromaticAberrationOptions) {
    super();
    this.amount = opts.amount ?? 2;
    this.edgeBias = opts.edgeBias ?? 0.65;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const src = readSourcePixels(ctx.source, w, h);
    const out = src.slice();
    const cx = (w - 1) * 0.5;
    const cy = (h - 1) * 0.5;
    const maxR = Math.hypot(cx, cy) || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / maxR;
        const dy = (y - cy) / maxR;
        const edge = Math.min(1, Math.hypot(dx, dy));
        const t = Math.max(0, (edge - this.edgeBias) / (1 - this.edgeBias || 1));
        const shift = (this.amount * t) | 0;
        const i = (y * w + x) * 4;
        const xr = clamp(x + shift, 0, w - 1);
        const xb = clamp(x - shift, 0, w - 1);
        out[i] = src[(y * w + xr) * 4]!;
        out[i + 1] = src[i + 1]!;
        out[i + 2] = src[(y * w + xb) * 4 + 2]!;
      }
    }
    writeTargetPixels(ctx.target, out, w, h);
  }
}

export interface VignetteOptions {
  readonly strength?: number;
}

export function createVignettePass(opts: VignetteOptions = {}): TimedPass {
  return new VignettePass(opts);
}

class VignettePass extends TimedPass {
  readonly id = 'vignette';
  readonly stage = 'post' as const;
  readonly declaredCost = 0.4;
  private readonly strength: number;

  constructor(opts: VignetteOptions) {
    super();
    this.strength = opts.strength ?? 0.55;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const src = readSourcePixels(ctx.source, w, h);
    const out = src.slice();
    const cx = (w - 1) * 0.5;
    const cy = (h - 1) * 0.5;
    const maxR = Math.hypot(cx, cy) || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy) / maxR;
        const shade = 1 - this.strength * d * d;
        const i = (y * w + x) * 4;
        out[i] = (out[i]! * shade) | 0;
        out[i + 1] = (out[i + 1]! * shade) | 0;
        out[i + 2] = (out[i + 2]! * shade) | 0;
      }
    }
    writeTargetPixels(ctx.target, out, w, h);
  }
}

export interface FilmGrainOptions {
  readonly seed?: number;
  readonly amount?: number;
  /** When true (default), grain evolves with tick; reducedMotion freezes it. */
  readonly animate?: boolean;
}

export function createFilmGrainPass(opts: FilmGrainOptions = {}): TimedPass {
  return new FilmGrainPass(opts);
}

class FilmGrainPass extends TimedPass {
  readonly id = 'filmGrain';
  readonly stage = 'post' as const;
  readonly declaredCost = 0.8;
  private readonly seed: number;
  private readonly amount: number;
  private readonly animate: boolean;

  constructor(opts: FilmGrainOptions) {
    super();
    this.seed = opts.seed ?? 0x6a09e667;
    this.amount = opts.amount ?? 18;
    this.animate = opts.animate ?? true;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const src = readSourcePixels(ctx.source, w, h);
    const out = src.slice();
    const tick = ctx.reducedMotion || !this.animate ? 0 : ctx.tick;
    const rng = new Mulberry32((this.seed ^ (tick * 0x9e3779b9)) >>> 0);
    for (let i = 0; i < out.length; i += 4) {
      const n = (rng.next() - 0.5) * 2 * this.amount;
      out[i] = clamp(out[i]! + n, 0, 255) | 0;
      out[i + 1] = clamp(out[i + 1]! + n, 0, 255) | 0;
      out[i + 2] = clamp(out[i + 2]! + n, 0, 255) | 0;
    }
    writeTargetPixels(ctx.target, out, w, h);
  }
}

export interface CrtCurvatureOptions {
  readonly amount?: number;
}

export function createCrtCurvaturePass(opts: CrtCurvatureOptions = {}): TimedPass {
  return new CrtCurvaturePass(opts);
}

class CrtCurvaturePass extends TimedPass {
  readonly id = 'crtCurvature';
  readonly stage = 'post' as const;
  readonly declaredCost = 2.0;
  private readonly amount: number;

  constructor(opts: CrtCurvatureOptions) {
    super();
    this.amount = opts.amount ?? 0.08;
  }

  protected renderTimed(ctx: EffectCtx): void {
    if (ctx.quality <= 1) {
      // Flatline: CRT off at quality ≤ 1 — copy source through.
      const w = ctx.viewport.widthPx | 0;
      const h = ctx.viewport.heightPx | 0;
      writeTargetPixels(ctx.target, readSourcePixels(ctx.source, w, h), w, h);
      return;
    }
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const src = readSourcePixels(ctx.source, w, h);
    const out = new Uint8ClampedArray(src.length);
    const cx = (w - 1) * 0.5;
    const cy = (h - 1) * 0.5;
    for (let y = 0; y < h; y++) {
      const ny = (y - cy) / cy;
      for (let x = 0; x < w; x++) {
        const nx = (x - cx) / cx;
        const r2 = nx * nx + ny * ny;
        const f = 1 + this.amount * r2;
        const sx = clamp(((nx / f) * cx + cx) | 0, 0, w - 1);
        const sy = clamp(((ny / f) * cy + cy) | 0, 0, h - 1);
        const si = (sy * w + sx) * 4;
        const di = (y * w + x) * 4;
        out[di] = src[si]!;
        out[di + 1] = src[si + 1]!;
        out[di + 2] = src[si + 2]!;
        out[di + 3] = src[si + 3]!;
      }
    }
    writeTargetPixels(ctx.target, out, w, h);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

