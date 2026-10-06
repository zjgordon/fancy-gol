/**
 * P3-A-5 / P3-E-2 — post-process passes (L3): bloom, scanlines, aberration, vignette, grain, CRT.
 *
 * **Composited, not computed (ADR-012).** Every pass here is built from the parts of Canvas2D the
 * browser runs on the GPU — `drawImage` with scaling, `globalCompositeOperation`, patterns and
 * gradients. None reads or writes pixels, and none allocates on the per-frame path. The previous
 * implementation was a per-texel JavaScript loop over a 2 M-texel `ImageData` that cost 40–110 ms a
 * frame and, on a real `OffscreenCanvas`, read an all-zero buffer and painted nothing (ADR-011
 * amendment). Resources (noise tiles, scanline pattern, downsample chain, gradients) are baked in
 * `resize()` or on first use, which is activation, and only *drawn* afterwards.
 *
 * Every pass draws in place onto `ctx.target` (L3, which the compositor has already filled with
 * L0+L1+L2) and leaves the context state as it found it.
 *
 * Two passes are **labelled substitutes** (ADR-012 D3): Canvas2D has no cheap per-pixel geometric
 * warp, so `chromaticAberration` is an additive colour fringe on the left and right edges and
 * `crtCurvature` is a corner mask with an edge falloff. Each carries an `approximation` string. The
 * exact effects ship with Phase 5's WebGL2 renderer (P5-A-3).
 */
import { Mulberry32 } from '@shared/rng';
import type { Canvas2DContext } from '../layers';
import type { EffectCtx } from './ctx';
import { createSurface, releaseSurface, type CanvasFactory, type Surface } from './surface';
import { TimedPass } from './timed-pass';

/** Every post pass takes an injectable canvas factory so headless tests can inspect what is baked. */
interface FactoryOption {
  readonly canvasFactory?: CanvasFactory;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Run `draw` with the context's state saved, so a pass never leaks a composite op or alpha. */
function withState(target: Canvas2DContext, composite: GlobalCompositeOperation, draw: () => void): void {
  target.save();
  target.globalCompositeOperation = composite;
  target.globalAlpha = 1;
  draw();
  target.restore();
}

// ---------------------------------------------------------------------------------------------
// bloom
// ---------------------------------------------------------------------------------------------

export interface BloomOptions extends FactoryOption {
  /** Total glow added back, 0–1. */
  readonly strength?: number;
  /** Glow reach: how many successive halvings contribute (1–3). */
  readonly radius?: number;
}

export function createBloomPass(opts: BloomOptions = {}): TimedPass {
  return new BloomPass(opts);
}

/**
 * Glow from the **cell layer**, not from the composite below. Downscale L1 through a chain of
 * smoothed halvings, fold the smaller levels into the ¼-size one with `'lighter'`, and add that
 * back to L3 with a single full-size `'lighter'` blit. The glow therefore comes only from live
 * cells, and the threshold the per-texel version needed is gone: a dim cell glows dimly.
 */
class BloomPass extends TimedPass {
  readonly id = 'bloom';
  readonly stage = 'post' as const;
  readonly declaredCost = 2.2;
  private readonly strength: number;
  private readonly levels: number;
  private readonly factory: CanvasFactory | undefined;
  /** `mips[0]` is ½ size, `mips[1]` ¼, and so on. */
  private mips: Surface[] = [];
  private w = 0;
  private h = 0;

  constructor(opts: BloomOptions) {
    super();
    this.strength = clamp(opts.strength ?? 0.55, 0, 1);
    this.levels = clamp(Math.round(opts.radius ?? 2), 1, 3);
    this.factory = opts.canvasFactory;
  }

  override resize(widthPx: number, heightPx: number, _dpr: number): void {
    this.releaseMips();
    this.w = widthPx | 0;
    this.h = heightPx | 0;
    for (let k = 1; k <= this.levels + 1; k++) {
      const div = 2 ** k;
      const mip = createSurface(this.factory, Math.ceil(this.w / div), Math.ceil(this.h / div));
      mip.ctx.imageSmoothingEnabled = true;
      this.mips.push(mip);
    }
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (this.mips.length === 0 || this.w !== w || this.h !== h) this.resize(w, h, ctx.viewport.dpr);

    let from: CanvasImageSource = ctx.cells;
    for (const mip of this.mips) {
      const { width, height } = mip.canvas;
      mip.ctx.globalCompositeOperation = 'copy';
      mip.ctx.drawImage(from, 0, 0, width, height);
      from = mip.canvas;
    }
    // Fold the smaller levels into the ¼-size one so only one full-size blit is needed.
    for (let k = this.levels; k >= 2; k--) {
      const into = this.mips[k - 1]!;
      into.ctx.globalCompositeOperation = 'lighter';
      into.ctx.drawImage(this.mips[k]!.canvas, 0, 0, into.canvas.width, into.canvas.height);
    }
    const glow = this.mips[1]!;
    withState(ctx.target, 'lighter', () => {
      ctx.target.globalAlpha = this.strength / this.levels;
      ctx.target.drawImage(glow.canvas, 0, 0, w, h);
    });
  }

  protected override onDispose(): void {
    this.releaseMips();
  }

  private releaseMips(): void {
    for (const mip of this.mips) releaseSurface(mip);
    this.mips = [];
  }
}

// ---------------------------------------------------------------------------------------------
// scanlines
// ---------------------------------------------------------------------------------------------

/** Integer device-pixel pitch so scanlines never moiré at fractional dpr. */
export function scanlinePitch(dpr: number): number {
  return Math.max(1, Math.round(dpr));
}

export interface ScanlinesOptions extends FactoryOption {
  readonly opacity?: number;
}

export function createScanlinesPass(opts: ScanlinesOptions = {}): TimedPass {
  return new ScanlinesPass(opts);
}

/**
 * A 1 × (2·pitch) tile — `pitch` clear rows, then `pitch` darkened rows — baked per integer pitch
 * and filled with `'multiply'`. The pitch is an integer number of device pixels, so the pattern
 * never beats against the pixel grid at dpr 1, 1.5, 2 or 3.
 */
class ScanlinesPass extends TimedPass {
  readonly id = 'scanlines';
  readonly stage = 'post' as const;
  readonly declaredCost = 0.1;
  private readonly opacity: number;
  private readonly factory: CanvasFactory | undefined;
  private tile: Surface | null = null;
  private pattern: CanvasPattern | null = null;
  private pitch = 0;

  constructor(opts: ScanlinesOptions) {
    super();
    this.opacity = clamp(opts.opacity ?? 0.18, 0, 1);
    this.factory = opts.canvasFactory;
  }

  override resize(_widthPx: number, _heightPx: number, dpr: number): void {
    this.bake(scanlinePitch(dpr));
  }

  protected renderTimed(ctx: EffectCtx): void {
    const pitch = scanlinePitch(ctx.viewport.dpr);
    if (!this.pattern || this.pitch !== pitch) this.bake(pitch);
    const pattern = this.pattern;
    if (!pattern) return;
    withState(ctx.target, 'multiply', () => {
      ctx.target.fillStyle = pattern;
      ctx.target.fillRect(0, 0, ctx.viewport.widthPx, ctx.viewport.heightPx);
    });
  }

  protected override onDispose(): void {
    releaseSurface(this.tile);
    this.tile = null;
    this.pattern = null;
  }

  private bake(pitch: number): void {
    releaseSurface(this.tile);
    const tile = createSurface(this.factory, 1, 2 * pitch);
    const grey = Math.round(255 * (1 - this.opacity));
    tile.ctx.fillStyle = '#ffffff';
    tile.ctx.fillRect(0, 0, 1, pitch);
    tile.ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
    tile.ctx.fillRect(0, pitch, 1, pitch);
    this.tile = tile;
    this.pitch = pitch;
    this.pattern = tile.ctx.createPattern(tile.canvas, 'repeat');
  }
}

// ---------------------------------------------------------------------------------------------
// chromatic aberration (labelled substitute)
// ---------------------------------------------------------------------------------------------

export interface ChromaticAberrationOptions extends FactoryOption {
  /** Fringe offset in device pixels. */
  readonly amount?: number;
  /** 0 = wide bands, 1 = hairline: how close to the edge the fringe is confined. */
  readonly edgeBias?: number;
}

export function createChromaticAberrationPass(opts: ChromaticAberrationOptions = {}): TimedPass {
  return new ChromaticAberrationPass(opts);
}

/**
 * **Substitute (ADR-012 D3):** an additive red and blue fringe on the left and right edge bands,
 * fading to nothing toward the middle — not the radial per-pixel channel shift of the original.
 * Each band is copied to a small scratch surface, tinted with a gradient `'multiply'`, and added
 * back offset in opposite directions with `'lighter'`, after red and blue were stripped from the
 * band in place so the fringe moves channels instead of adding light. Only ~25% of the frame is touched.
 */
class ChromaticAberrationPass extends TimedPass {
  readonly id = 'chromaticAberration';
  readonly stage = 'post' as const;
  readonly declaredCost = 13.4;
  override readonly approximation = 'colour fringe on the left and right edges, not a radial warp';
  private readonly shift: number;
  private readonly edgeBias: number;
  private readonly factory: CanvasFactory | undefined;
  private red: Surface | null = null;
  private blue: Surface | null = null;
  /** Tint ramps, outer edge → inner edge, for the left band and its mirror for the right. */
  private ramps: {
    redL: CanvasGradient;
    blueL: CanvasGradient;
    redR: CanvasGradient;
    blueR: CanvasGradient;
    /** Edge → inner: green only fading to white. Strips red and blue from the base before they are re-added shifted. */
    keepL: CanvasGradient;
    keepR: CanvasGradient;
  } | null = null;
  private bandW = 0;
  private w = 0;
  private h = 0;

  constructor(opts: ChromaticAberrationOptions) {
    super();
    this.shift = Math.max(1, Math.round(opts.amount ?? 2));
    this.edgeBias = clamp(opts.edgeBias ?? 0.65, 0, 0.95);
    this.factory = opts.canvasFactory;
  }

  override resize(widthPx: number, heightPx: number, _dpr: number): void {
    this.release();
    this.w = widthPx | 0;
    this.h = heightPx | 0;
    this.bandW = Math.max(8, Math.round(this.w * (1 - this.edgeBias) * 0.5));
    this.red = createSurface(this.factory, this.bandW, this.h);
    this.blue = createSurface(this.factory, this.bandW, this.h);
    const ctx = this.red.ctx;
    const ramp = (fromX: number, toX: number, color: string): CanvasGradient => {
      const g = ctx.createLinearGradient(fromX, 0, toX, 0);
      g.addColorStop(0, color);
      g.addColorStop(1, '#000000');
      return g;
    };
    const keep = (fromX: number, toX: number): CanvasGradient => {
      const g = ctx.createLinearGradient(fromX, 0, toX, 0);
      g.addColorStop(0, '#00ff00');
      g.addColorStop(1, '#ffffff');
      return g;
    };
    this.ramps = {
      keepL: keep(0, this.bandW),
      keepR: keep(this.bandW, 0),
      redL: ramp(0, this.bandW, '#ff0000'),
      blueL: ramp(0, this.bandW, '#0000ff'),
      redR: ramp(this.bandW, 0, '#ff0000'),
      blueR: ramp(this.bandW, 0, '#0000ff'),
    };
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (!this.red || !this.blue || !this.ramps || this.w !== w || this.h !== h) {
      this.resize(w, h, ctx.viewport.dpr);
    }
    const { red, blue, ramps } = this;
    if (!red || !blue || !ramps) return;
    const source = ctx.target.canvas;
    const bandW = this.bandW;

    for (const side of [-1, 1] as const) {
      const bx = side === -1 ? 0 : w - bandW;
      const tint = (scratch: Surface, gradient: CanvasGradient): void => {
        scratch.ctx.globalCompositeOperation = 'copy';
        scratch.ctx.drawImage(source, bx, 0, bandW, h, 0, 0, bandW, h);
        scratch.ctx.globalCompositeOperation = 'multiply';
        scratch.ctx.fillStyle = gradient;
        scratch.ctx.fillRect(0, 0, bandW, h);
      };
      tint(red, side === -1 ? ramps.redL : ramps.redR);
      tint(blue, side === -1 ? ramps.blueL : ramps.blueR);
      // A real channel shift moves red and blue; it does not add light. Strip them from the base
      // band (green stays), then add them back offset in opposite directions. Without this the band
      // was content + red copy + blue copy: a magenta wash on bright scenes.
      withState(ctx.target, 'multiply', () => {
        ctx.target.save();
        ctx.target.translate(bx, 0);
        ctx.target.fillStyle = side === -1 ? ramps.keepL : ramps.keepR;
        ctx.target.fillRect(0, 0, bandW, h);
        ctx.target.restore();
      });
      withState(ctx.target, 'lighter', () => {
        ctx.target.drawImage(red.canvas, bx + side * this.shift, 0);
        ctx.target.drawImage(blue.canvas, bx - side * this.shift, 0);
      });
    }
  }

  protected override onDispose(): void {
    this.release();
  }

  private release(): void {
    releaseSurface(this.red);
    releaseSurface(this.blue);
    this.red = null;
    this.blue = null;
    this.ramps = null;
  }
}

// ---------------------------------------------------------------------------------------------
// vignette
// ---------------------------------------------------------------------------------------------

export interface VignetteOptions {
  readonly strength?: number;
}

export function createVignettePass(opts: VignetteOptions = {}): TimedPass {
  return new VignettePass(opts);
}

/** Number of colour stops used to approximate the quadratic falloff. */
const VIGNETTE_STOPS = 8;

/**
 * `shade = 1 − strength · d²` (d = distance from centre ÷ distance to a corner), as a radial
 * gradient baked per size and filled with `'multiply'`. Eight stops follow the parabola to well
 * under one 8-bit level, so there is no visible banding or drift against the formula.
 */
class VignettePass extends TimedPass {
  readonly id = 'vignette';
  readonly stage = 'post' as const;
  readonly declaredCost = 0.1;
  private readonly strength: number;
  private gradient: CanvasGradient | null = null;
  private w = 0;
  private h = 0;

  constructor(opts: VignetteOptions) {
    super();
    this.strength = clamp(opts.strength ?? 0.55, 0, 1);
  }

  override resize(widthPx: number, heightPx: number, _dpr: number): void {
    this.w = widthPx | 0;
    this.h = heightPx | 0;
    this.gradient = null;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (!this.gradient || this.w !== w || this.h !== h) this.bake(ctx.target, w, h);
    const gradient = this.gradient;
    if (!gradient) return;
    withState(ctx.target, 'multiply', () => {
      ctx.target.fillStyle = gradient;
      ctx.target.fillRect(0, 0, w, h);
    });
  }

  protected override onDispose(): void {
    this.gradient = null;
  }

  private bake(target: Canvas2DContext, w: number, h: number): void {
    const cx = (w - 1) * 0.5;
    const cy = (h - 1) * 0.5;
    const maxR = Math.hypot(cx, cy) || 1;
    const g = target.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    for (let i = 0; i <= VIGNETTE_STOPS; i++) {
      const t = i / VIGNETTE_STOPS;
      const v = Math.round(255 * (1 - this.strength * t * t));
      g.addColorStop(t, `rgb(${v},${v},${v})`);
    }
    this.gradient = g;
    this.w = w;
    this.h = h;
  }
}

// ---------------------------------------------------------------------------------------------
// film grain
// ---------------------------------------------------------------------------------------------

export interface FilmGrainOptions extends FactoryOption {
  readonly seed?: number;
  /** Peak noise amplitude in 8-bit levels around mid-grey. */
  readonly amount?: number;
  /** When true (default), grain evolves with tick; reducedMotion freezes it. */
  readonly animate?: boolean;
}

export function createFilmGrainPass(opts: FilmGrainOptions = {}): TimedPass {
  return new FilmGrainPass(opts);
}

export const GRAIN_TILE_SIZE = 256;
export const GRAIN_TILE_COUNT = 8;

/**
 * Which baked tile and offset a tick selects. A function of the tick alone, so a fixed tick is a
 * fixed frame (and reduced motion, which pins tick 0, is a still image).
 */
export function grainFrameFor(tick: number): { tile: number; dx: number; dy: number } {
  const t = tick >>> 0;
  return {
    tile: (Math.imul(t, 0x9e3779b1) >>> 29) & (GRAIN_TILE_COUNT - 1),
    dx: (t * 97) % GRAIN_TILE_SIZE,
    dy: (t * 61) % GRAIN_TILE_SIZE,
  };
}

/**
 * Eight seeded 256² noise tiles baked at activation (the only per-texel work, and it runs once).
 * Each tick picks a tile and an offset from the tick alone — deterministic, so a fixed tick is a
 * fixed frame — and fills with `'overlay'`, which leaves pure black untouched and is strongest in
 * the midtones. Reduced motion pins tick 0.
 */
class FilmGrainPass extends TimedPass {
  readonly id = 'filmGrain';
  readonly stage = 'post' as const;
  readonly declaredCost = 0.1;
  private readonly seed: number;
  private readonly amount: number;
  private readonly animate: boolean;
  private readonly factory: CanvasFactory | undefined;
  private tiles: Surface[] = [];
  private patterns: CanvasPattern[] = [];

  constructor(opts: FilmGrainOptions) {
    super();
    this.seed = opts.seed ?? 0x6a09e667;
    this.amount = opts.amount ?? 18;
    this.animate = opts.animate ?? true;
    this.factory = opts.canvasFactory;
  }

  override resize(_widthPx: number, _heightPx: number, _dpr: number): void {
    if (this.patterns.length === 0) this.bake();
  }

  protected renderTimed(ctx: EffectCtx): void {
    if (this.patterns.length === 0) this.bake();
    const tick = ctx.reducedMotion || !this.animate ? 0 : ctx.tick;
    const { tile, dx, dy } = grainFrameFor(tick);
    const pattern = this.patterns[tile];
    if (!pattern) return;
    withState(ctx.target, 'overlay', () => {
      ctx.target.fillStyle = pattern;
      ctx.target.translate(dx, dy);
      ctx.target.fillRect(-dx, -dy, ctx.viewport.widthPx, ctx.viewport.heightPx);
    });
  }

  protected override onDispose(): void {
    for (const tile of this.tiles) releaseSurface(tile);
    this.tiles = [];
    this.patterns = [];
  }

  private bake(): void {
    for (let t = 0; t < GRAIN_TILE_COUNT; t++) {
      const surface = createSurface(this.factory, GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
      const image = surface.ctx.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
      const rng = new Mulberry32((this.seed ^ Math.imul(t + 1, 0x9e3779b9)) >>> 0);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = clamp(128 + (rng.next() - 0.5) * 2 * this.amount, 0, 255) | 0;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      surface.ctx.putImageData(image, 0, 0);
      this.tiles.push(surface);
      const pattern = surface.ctx.createPattern(surface.canvas, 'repeat');
      if (pattern) this.patterns.push(pattern);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// CRT curvature (labelled substitute)
// ---------------------------------------------------------------------------------------------

export interface CrtCurvatureOptions {
  readonly amount?: number;
}

export function createCrtCurvaturePass(opts: CrtCurvatureOptions = {}): TimedPass {
  return new CrtCurvaturePass(opts);
}

/**
 * **Substitute (ADR-012 D3):** the look of a curved tube's corners, not a barrel warp. A radial
 * falloff concentrated at the edges is `'multiply'`-filled, then the corners outside a rounded
 * rectangle are blacked out. `roundRect` is feature-detected; without it only the falloff draws.
 */
class CrtCurvaturePass extends TimedPass {
  readonly id = 'crtCurvature';
  readonly stage = 'post' as const;
  readonly declaredCost = 0.1;
  override readonly approximation = 'CRT corners drawn as a mask, not a true barrel warp';
  private readonly amount: number;
  private gradient: CanvasGradient | null = null;
  private w = 0;
  private h = 0;

  constructor(opts: CrtCurvatureOptions) {
    super();
    this.amount = clamp(opts.amount ?? 0.08, 0, 0.5);
  }

  override resize(widthPx: number, heightPx: number, _dpr: number): void {
    this.w = widthPx | 0;
    this.h = heightPx | 0;
    this.gradient = null;
  }

  protected renderTimed(ctx: EffectCtx): void {
    // Flatline: CRT off at quality ≤ 1 (the post stage is not even scheduled there).
    if (ctx.quality <= 1) return;
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (!this.gradient || this.w !== w || this.h !== h) this.bake(ctx.target, w, h);
    const gradient = this.gradient;
    if (!gradient) return;
    const target = ctx.target;
    withState(target, 'multiply', () => {
      target.fillStyle = gradient;
      target.fillRect(0, 0, w, h);
    });
    if (typeof target.roundRect === 'function') {
      const radius = Math.min(w, h) * this.amount;
      withState(target, 'source-over', () => {
        target.fillStyle = '#000000';
        target.beginPath();
        target.rect(0, 0, w, h);
        target.roundRect(0, 0, w, h, radius);
        target.fill('evenodd');
      });
    }
  }

  protected override onDispose(): void {
    this.gradient = null;
  }

  private bake(target: Canvas2DContext, w: number, h: number): void {
    const cx = (w - 1) * 0.5;
    const cy = (h - 1) * 0.5;
    const maxR = Math.hypot(cx, cy) || 1;
    const k = clamp(this.amount * 6, 0, 0.6);
    const g = target.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    for (const t of [0, 0.4, 0.6, 0.75, 0.9, 1]) {
      const v = Math.round(255 * (1 - k * t ** 4));
      g.addColorStop(t, `rgb(${v},${v},${v})`);
    }
    this.gradient = g;
    this.w = w;
    this.h = h;
  }
}
