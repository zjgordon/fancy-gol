/**
 * P3-A-5 — effects-stage passes (L2): phosphor, particles, trails, hue, grid glow.
 */
import { Mulberry32 } from '@shared/rng';
import type { EffectCtx } from './ctx';
import { readSourcePixels, writeTargetPixels } from './software-surface';
import { TimedPass } from './timed-pass';

export interface PhosphorDecayOptions {
  readonly fade?: number;
  readonly color?: readonly [number, number, number];
}

export function createPhosphorDecayPass(opts: PhosphorDecayOptions = {}): TimedPass {
  return new PhosphorDecayPass(opts);
}

class PhosphorDecayPass extends TimedPass {
  readonly id = 'phosphorDecay';
  readonly stage = 'effects' as const;
  readonly declaredCost = 1.5;
  private readonly fade: number;
  private readonly color: readonly [number, number, number];
  private ghost: Uint8ClampedArray | null = null;
  private gw = 0;
  private gh = 0;

  constructor(opts: PhosphorDecayOptions) {
    super();
    this.fade = opts.fade ?? 0.92;
    this.color = opts.color ?? [255, 176, 0];
  }

  /** Themes call after grid clear so ghosts do not burn in. */
  clearGhosts(): void {
    this.ghost?.fill(0);
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (!this.ghost || this.gw !== w || this.gh !== h) {
      this.ghost = new Uint8ClampedArray(w * h);
      this.gw = w;
      this.gh = h;
    }
    const src = readSourcePixels(ctx.source, w, h);
    const out = new Uint8ClampedArray(w * h * 4);
    const ghost = this.ghost;
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      const lum = (src[i]! + src[i + 1]! + src[i + 2]!) / 3;
      ghost[p] = lum > 8 ? 1 : ghost[p]! * this.fade;
      if (ghost[p]! < 0.004) ghost[p] = 0;
      const a = ghost[p]!;
      out[i] = (this.color[0] * a) | 0;
      out[i + 1] = (this.color[1] * a) | 0;
      out[i + 2] = (this.color[2] * a) | 0;
      out[i + 3] = (a * 255) | 0;
    }
    writeTargetPixels(ctx.target, out, w, h);
  }

  protected override onDispose(): void {
    this.ghost = null;
  }
}

export interface GridGlowOptions {
  readonly color?: string;
  readonly spacing?: number;
}

export function createGridGlowPass(opts: GridGlowOptions = {}): TimedPass {
  return new GridGlowPass(opts);
}

class GridGlowPass extends TimedPass {
  readonly id = 'gridGlow';
  readonly stage = 'effects' as const;
  readonly declaredCost = 1.0;
  private readonly color: string;
  private readonly spacing: number;

  constructor(opts: GridGlowOptions) {
    super();
    this.color = opts.color ?? '#ff2bd6';
    this.spacing = opts.spacing ?? 32;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx;
    const h = ctx.viewport.heightPx;
    const { originX, originY, cellSize } = ctx.viewport;
    ctx.target.clearRect(0, 0, w, h);
    ctx.target.globalAlpha = 0.35;
    ctx.target.fillStyle = this.color;
    const step = this.spacing;
    const ox = ((-originX * cellSize) % step + step) % step;
    const oy = ((-originY * cellSize) % step + step) % step;
    // Perspective-ish: lines denser toward the bottom (Synthwave floor).
    for (let x = ox; x < w; x += step) {
      ctx.target.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      const y = oy + t * t * h;
      ctx.target.globalAlpha = 0.15 + t * 0.35;
      ctx.target.fillRect(0, y, w, 1);
    }
    ctx.target.globalAlpha = 1;
  }
}

export interface BirthFlashOptions {
  readonly cap?: number;
  readonly color?: string;
}

export function createBirthFlashPass(opts: BirthFlashOptions = {}): TimedPass & {
  readonly cap: number;
  readonly activeCount: number;
  /** Buffer reallocations — must stay 0 in steady state. */
  readonly bufferAllocations: number;
} {
  return new BirthFlashPass(opts);
}

class BirthFlashPass extends TimedPass {
  readonly id = 'birthFlash';
  readonly stage = 'effects' as const;
  readonly declaredCost = 0.5;
  readonly cap: number;
  private readonly color: string;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly life: Float32Array;
  private active = 0;
  bufferAllocations = 1;
  private cursor = 0;

  constructor(opts: BirthFlashOptions) {
    super();
    this.cap = opts.cap ?? 128;
    this.color = opts.color ?? '#ffffff';
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.life = new Float32Array(this.cap);
  }

  get activeCount(): number {
    return this.active;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const births = ctx.changes.births | 0;
    if (births > 0 && !ctx.reducedMotion) {
      const n = Math.min(births, 8);
      for (let i = 0; i < n; i++) this.spawn(ctx);
    }
    const w = ctx.viewport.widthPx;
    const h = ctx.viewport.heightPx;
    ctx.target.clearRect(0, 0, w, h);
    ctx.target.fillStyle = this.color;
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= ctx.reducedMotion ? this.life[i]! : 0.08;
      if (this.life[i]! <= 0) continue;
      live += 1;
      ctx.target.globalAlpha = this.life[i]!;
      ctx.target.fillRect(this.x[i]!, this.y[i]!, 4, 4);
    }
    this.active = live;
    ctx.target.globalAlpha = 1;
  }

  private spawn(ctx: EffectCtx): void {
    const i = this.cursor % this.cap;
    this.cursor += 1;
    this.x[i] = (ctx.viewport.widthPx * ((i * 0.37) % 1) + ctx.viewport.originX) % ctx.viewport.widthPx;
    this.y[i] = (ctx.viewport.heightPx * ((i * 0.61) % 1) + ctx.viewport.originY) % ctx.viewport.heightPx;
    this.life[i] = 1;
  }
}

export interface DeathParticlesOptions {
  readonly cap?: number;
  readonly seed?: number;
}

export function createDeathParticlesPass(opts: DeathParticlesOptions = {}): TimedPass & {
  readonly cap: number;
  readonly activeCount: number;
  readonly bufferAllocations: number;
} {
  return new DeathParticlesPass(opts);
}

class DeathParticlesPass extends TimedPass {
  readonly id = 'deathParticles';
  readonly stage = 'effects' as const;
  readonly declaredCost = 0.6;
  readonly cap: number;
  private readonly seed: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private active = 0;
  bufferAllocations = 1;
  private cursor = 0;
  private rng: Mulberry32;

  constructor(opts: DeathParticlesOptions) {
    super();
    this.cap = opts.cap ?? 256;
    this.seed = opts.seed ?? 0xdead;
    this.rng = new Mulberry32(this.seed);
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.vx = new Float32Array(this.cap);
    this.vy = new Float32Array(this.cap);
    this.life = new Float32Array(this.cap);
  }

  get activeCount(): number {
    return this.active;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const deaths = ctx.changes.deaths | 0;
    if (deaths > 0 && !ctx.reducedMotion) {
      const n = Math.min(deaths, 12);
      for (let i = 0; i < n; i++) this.spawn(ctx);
    }
    const w = ctx.viewport.widthPx;
    const h = ctx.viewport.heightPx;
    ctx.target.clearRect(0, 0, w, h);
    ctx.target.fillStyle = '#c8b0ff';
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      if (!ctx.reducedMotion) {
        this.x[i]! += this.vx[i]!;
        this.y[i]! += this.vy[i]!;
        this.life[i]! -= 0.04;
      } else {
        this.life[i] = 0;
      }
      if (this.life[i]! <= 0) continue;
      live += 1;
      ctx.target.globalAlpha = this.life[i]!;
      ctx.target.fillRect(this.x[i]!, this.y[i]!, 2, 2);
    }
    this.active = live;
    ctx.target.globalAlpha = 1;
    // Hard cap: never grow typed arrays after construction.
    if (this.x.length !== this.cap) throw new Error('deathParticles: pool grew');
  }

  private spawn(ctx: EffectCtx): void {
    const i = this.cursor % this.cap;
    this.cursor += 1;
    this.x[i] = this.rng.next() * ctx.viewport.widthPx;
    this.y[i] = this.rng.next() * ctx.viewport.heightPx;
    this.vx[i] = (this.rng.next() - 0.5) * 2.5;
    this.vy[i] = (this.rng.next() - 0.5) * 2.5 - 0.5;
    this.life[i] = 1;
  }
}

export interface TrailFadeOptions {
  readonly fade?: number;
}

export function createTrailFadePass(opts: TrailFadeOptions = {}): TimedPass {
  return new TrailFadePass(opts);
}

class TrailFadePass extends TimedPass {
  readonly id = 'trailFade';
  readonly stage = 'effects' as const;
  readonly declaredCost = 0.8;
  private readonly fade: number;
  private prev: Uint8ClampedArray | null = null;
  private pw = 0;
  private ph = 0;

  constructor(opts: TrailFadeOptions) {
    super();
    this.fade = opts.fade ?? 0.85;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (!this.prev || this.pw !== w || this.ph !== h) {
      this.prev = new Uint8ClampedArray(w * h * 4);
      this.pw = w;
      this.ph = h;
    }
    const src = readSourcePixels(ctx.source, w, h);
    const out = this.prev;
    for (let i = 0; i < out.length; i += 4) {
      out[i] = Math.max(src[i]!, (out[i]! * this.fade) | 0);
      out[i + 1] = Math.max(src[i + 1]!, (out[i + 1]! * this.fade) | 0);
      out[i + 2] = Math.max(src[i + 2]!, (out[i + 2]! * this.fade) | 0);
      out[i + 3] = Math.max(src[i + 3]!, (out[i + 3]! * this.fade) | 0);
    }
    writeTargetPixels(ctx.target, out, w, h);
  }

  protected override onDispose(): void {
    this.prev = null;
  }
}

export interface HueShiftByAgeOptions {
  /** Age in [0,1] at pixel (x,y). Themes wire the age buffer here. */
  readonly ageAt?: (x: number, y: number) => number;
  readonly degrees?: number;
}

export function createHueShiftByAgePass(opts: HueShiftByAgeOptions = {}): TimedPass {
  return new HueShiftByAgePass(opts);
}

class HueShiftByAgePass extends TimedPass {
  readonly id = 'hueShiftByAge';
  readonly stage = 'effects' as const;
  readonly declaredCost = 1.5;
  private readonly ageAt: (x: number, y: number) => number;
  private readonly degrees: number;

  constructor(opts: HueShiftByAgeOptions) {
    super();
    this.degrees = opts.degrees ?? 120;
    this.ageAt =
      opts.ageAt ??
      ((x, y) => {
        // Deterministic stand-in until themes inject the real age buffer.
        return ((x * 17 + y * 31) & 255) / 255;
      });
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const src = readSourcePixels(ctx.source, w, h);
    const out = src.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3]! < 8 && src[i]! + src[i + 1]! + src[i + 2]! < 8) continue;
        const age = this.ageAt(x, y);
        const [r, g, b] = shiftHue(src[i]!, src[i + 1]!, src[i + 2]!, this.degrees * age);
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
      }
    }
    writeTargetPixels(ctx.target, out, w, h);
  }
}

function shiftHue(r: number, g: number, b: number, deg: number): [number, number, number] {
  const h = (((deg % 360) + 360) % 360) / 60;
  const v = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const s = v === 0 ? 0 : (v - min) / v;
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  let rgb: [number, number, number];
  if (h < 1) rgb = [c, x, 0];
  else if (h < 2) rgb = [x, c, 0];
  else if (h < 3) rgb = [0, c, x];
  else if (h < 4) rgb = [0, x, c];
  else if (h < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m2 = v - c;
  return [((rgb[0] + m2) * 255) | 0, ((rgb[1] + m2) * 255) | 0, ((rgb[2] + m2) * 255) | 0];
}
