/**
 * P3-A-5 / P3-E-3 — effects-stage passes (L2): phosphor and trail ghosts, particles, grid glow.
 *
 * **Composited, not computed (ADR-012).** These used to be per-texel JavaScript loops that read the
 * cell layer through a helper which returned a zero buffer on a real `OffscreenCanvas`, so they cost
 * 10–17 ms a frame and drew nothing; one of them (`hueShiftByAge`) then `putImageData`'d a blank over
 * the whole layer and erased `gridGlow` along with it. Every pass here now draws *onto* L2 with
 * `drawImage`, composite modes, paths and a cached offscreen. None reads or writes pixels per frame
 * and none allocates; resources are baked at activation or resize.
 *
 * L2 is cleared by the compositor every frame, so a pass draws its whole contribution each frame.
 * Passes that keep state across frames (the ghosts) keep it in their own offscreen.
 *
 * `hueShiftByAge` is gone. Synthwave's palette already carries the age hue swing
 * (`AGE_HUE_SWING`), applied exactly and for free where the cells are painted.
 */
import { Mulberry32 } from '@shared/rng';
import type { Canvas2DContext } from '../layers';
import type { EffectCtx } from './ctx';
import { createSurface, releaseSurface, type CanvasFactory, type Surface } from './surface';
import { TimedPass } from './timed-pass';

interface FactoryOption {
  readonly canvasFactory?: CanvasFactory;
}

function withState(target: Canvas2DContext, composite: GlobalCompositeOperation, alpha: number, draw: () => void): void {
  target.save();
  target.globalCompositeOperation = composite;
  target.globalAlpha = alpha;
  draw();
  target.restore();
}

// ---------------------------------------------------------------------------------------------
// ghost trails: phosphorDecay, trailFade
// ---------------------------------------------------------------------------------------------

/** Side of the baked dither tile. Small: it repeats, and what matters is the mix of values in it. */
export const GHOST_DITHER_TILE = 64;
/** Fraction of tile pixels given a strong fade, and the strength of that fade (see {@link ghostDitherAlphas}). */
const DITHER_HI_FRACTION = 1 / 8;
const DITHER_HI_ALPHA = 0.6;

/**
 * Alphas for the two populations of the fade tile: `hi` for a sparse minority, `lo` for the rest, with
 * `hiFraction · hi + (1 − hiFraction) · lo === 1 − fade` so the *average* decay is the requested one.
 *
 * **Why not a plain fade.** Repeatedly fading an 8-bit canvas with `destination-out` at a constant
 * alpha does not reach zero: `round(L · (1 − a)) === L` once `L · a < 0.5`, so the ghost sticks at a
 * small non-zero level (measured in Chromium: alpha 3–6, and the colour drifts to yellow) — a
 * permanent faint streak wherever a cell has ever been, accumulating over a session. A minority of
 * pixels getting a strong fade each frame (> 0.5, enough to take any residual to zero), at an offset
 * that moves every frame, is stochastic rounding: every pixel is eventually cleared (a 64² sample went
 * to exactly zero by frame 200) while the mean decay follows the plain curve (90.8 vs 87 at frame 10).
 * The cost is a little spatial speckle in the trail, which the half-resolution blit softens.
 */
export function ghostDitherAlphas(fade: number): { lo: number; hi: number } {
  const a = 1 - Math.min(0.97, Math.max(0.5, fade));
  const hi = Math.min(DITHER_HI_ALPHA, (a / DITHER_HI_FRACTION) * 0.8);
  const lo = Math.max(0, (a - DITHER_HI_FRACTION * hi) / (1 - DITHER_HI_FRACTION));
  return { lo, hi };
}

/**
 * A persistent half-resolution canvas. Each frame: fade it with the dither tile, draw the live cells
 * on top, blit it to L2. Half resolution is deliberate — a phosphor ghost is soft, and it costs a
 * quarter of a full-size layer. Under reduced motion there are no trails: it clears and draws nothing.
 */
abstract class GhostTrailPass extends TimedPass {
  private readonly fade: number;
  private readonly factory: CanvasFactory | undefined;
  private ghost: Surface | null = null;
  private tile: Surface | null = null;
  private pattern: CanvasPattern | null = null;
  private w = 0;
  private h = 0;
  private frame = 0;

  protected constructor(fade: number, factory: CanvasFactory | undefined) {
    super();
    this.fade = fade;
    this.factory = factory;
  }

  override resize(widthPx: number, heightPx: number, _dpr: number): void {
    releaseSurface(this.ghost);
    this.w = widthPx | 0;
    this.h = heightPx | 0;
    this.ghost = createSurface(this.factory, Math.ceil(this.w / 2), Math.ceil(this.h / 2));
    this.ghost.ctx.imageSmoothingEnabled = true;
    if (!this.pattern) this.bakeTile();
  }

  /** Drop every ghost (grid clear): a cleared world must not leave a trail behind. */
  override reset(): void {
    const g = this.ghost;
    if (g) g.ctx.clearRect(0, 0, g.canvas.width, g.canvas.height);
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    if (!this.ghost || this.w !== w || this.h !== h) this.resize(w, h, ctx.viewport.dpr);
    const ghost = this.ghost;
    const pattern = this.pattern;
    if (!ghost || !pattern) return;
    if (ctx.reducedMotion) {
      this.reset();
      return;
    }
    const gw = ghost.canvas.width;
    const gh = ghost.canvas.height;
    const g = ghost.ctx;
    const f = this.frame++;

    withState(g, 'destination-out', 1, () => {
      g.fillStyle = pattern;
      g.translate((f * 7) % GHOST_DITHER_TILE, (f * 13) % GHOST_DITHER_TILE);
      g.fillRect(-GHOST_DITHER_TILE, -GHOST_DITHER_TILE, gw + GHOST_DITHER_TILE, gh + GHOST_DITHER_TILE);
    });
    withState(g, 'source-over', 1, () => g.drawImage(ctx.cells, 0, 0, gw, gh));
    // Doubling a half-size ghost without smoothing is invisible on 1-cell-wide pixel art and measured
    // ~2× cheaper than the bilinear stretch on a software rasterizer (P3-E-9).
    withState(ctx.target, 'source-over', 1, () => {
      ctx.target.imageSmoothingEnabled = false;
      ctx.target.drawImage(ghost.canvas, 0, 0, w, h);
    });
  }

  protected override onDispose(): void {
    releaseSurface(this.ghost);
    releaseSurface(this.tile);
    this.ghost = null;
    this.tile = null;
    this.pattern = null;
  }

  private bakeTile(): void {
    const { lo, hi } = ghostDitherAlphas(this.fade);
    const tile = createSurface(this.factory, GHOST_DITHER_TILE, GHOST_DITHER_TILE);
    const image = tile.ctx.createImageData(GHOST_DITHER_TILE, GHOST_DITHER_TILE);
    const rng = new Mulberry32(0x6d69727a);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = Math.round(255 * (rng.next() < DITHER_HI_FRACTION ? hi : lo));
    }
    tile.ctx.putImageData(image, 0, 0);
    this.tile = tile;
    this.pattern = tile.ctx.createPattern(tile.canvas, 'repeat');
  }
}

export interface PhosphorDecayOptions extends FactoryOption {
  /** Per-frame brightness kept, 0.5–0.97. */
  readonly fade?: number;
}

export function createPhosphorDecayPass(opts: PhosphorDecayOptions = {}): TimedPass {
  return new PhosphorDecayPass(opts);
}

/** Flatline: a dead cell leaves a fading ghost. The ghost keeps the cell's own colour (its palette is the phosphor). */
class PhosphorDecayPass extends GhostTrailPass {
  readonly id = 'phosphorDecay';
  readonly stage = 'effects' as const;
  readonly declaredCost = 2.8;

  constructor(opts: PhosphorDecayOptions) {
    super(opts.fade ?? 0.92, opts.canvasFactory);
  }
}

export interface TrailFadeOptions extends FactoryOption {
  readonly fade?: number;
}

export function createTrailFadePass(opts: TrailFadeOptions = {}): TimedPass {
  return new TrailFadePass(opts);
}

/** Void-Walker: soft trails behind moving structures. Same technique, a quicker fade. */
class TrailFadePass extends GhostTrailPass {
  readonly id = 'trailFade';
  readonly stage = 'effects' as const;
  readonly declaredCost = 2.8;

  constructor(opts: TrailFadeOptions) {
    super(opts.fade ?? 0.85, opts.canvasFactory);
  }
}

// ---------------------------------------------------------------------------------------------
// grid glow
// ---------------------------------------------------------------------------------------------

export interface GridGlowOptions extends FactoryOption {
  readonly color?: string;
  /** Horizon as a fraction of viewport height (aligns with sunGradient.sunY). */
  readonly horizonY?: number;
  /** How strongly camera pan shifts the vanishing point (screen px per world-px·cell). */
  readonly parallax?: number;
  /** Max ray opacity — keep the floor quiet so it never steals the simulation. */
  readonly maxAlpha?: number;
}

/**
 * Vanishing-point X for the Synthwave floor grid. Parallax is soft so a pan
 * feels like depth without yanking the horizon across the sim.
 */
export function vanishingPointX(
  originX: number,
  widthPx: number,
  cellSize: number,
  parallax = 0.08,
): number {
  const shift = originX * cellSize * parallax;
  // Soft clamp: VP may drift off-centre but stays within ~35% of the frame.
  const maxShift = widthPx * 0.35;
  const clamped = Math.max(-maxShift, Math.min(maxShift, shift));
  return widthPx * 0.5 + clamped;
}

export function createGridGlowPass(opts: GridGlowOptions = {}): TimedPass {
  return new GridGlowPass(opts);
}

const GRID_RAYS = 14;
const GRID_FLOOR_LINES = 18;

/**
 * The perspective floor, drawn once into an offscreen and blitted: one `drawImage` per frame while the
 * vanishing point holds still. It used to be ~15 000 one-pixel `fillRect`s stepped along each ray every
 * frame. The cache is redrawn only when the vanishing point (which follows the camera pan) or the
 * size changes.
 */
class GridGlowPass extends TimedPass {
  readonly id = 'gridGlow';
  readonly stage = 'effects' as const;
  readonly declaredCost = 0.1;
  private readonly color: string;
  private readonly horizonY: number;
  private readonly parallax: number;
  private readonly maxAlpha: number;
  private readonly factory: CanvasFactory | undefined;
  private cache: Surface | null = null;
  private cacheKey = '';

  constructor(opts: GridGlowOptions) {
    super();
    this.color = opts.color ?? '#ff2bd6';
    this.horizonY = opts.horizonY ?? 0.55;
    this.parallax = opts.parallax ?? 0.08;
    this.maxAlpha = opts.maxAlpha ?? 0.28;
    this.factory = opts.canvasFactory;
  }

  override resize(): void {
    releaseSurface(this.cache);
    this.cache = null;
    this.cacheKey = '';
  }

  protected renderTimed(ctx: EffectCtx): void {
    const w = ctx.viewport.widthPx | 0;
    const h = ctx.viewport.heightPx | 0;
    const vpx = Math.round(vanishingPointX(ctx.viewport.originX, w, ctx.viewport.cellSize, this.parallax));
    const key = `${w}x${h}@${vpx}`;
    if (!this.cache || this.cacheKey !== key) this.redraw(w, h, vpx, key);
    const cache = this.cache;
    if (!cache) return;
    withState(ctx.target, 'source-over', 1, () => ctx.target.drawImage(cache.canvas, 0, 0));
  }

  protected override onDispose(): void {
    releaseSurface(this.cache);
    this.cache = null;
  }

  private redraw(w: number, h: number, vpx: number, key: string): void {
    if (!this.cache || this.cache.canvas.width !== w || this.cache.canvas.height !== h) {
      releaseSurface(this.cache);
      this.cache = createSurface(this.factory, w, h);
    }
    const g = this.cache.ctx;
    const vpy = h * this.horizonY;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = this.color;
    g.fillStyle = this.color;
    g.lineWidth = 1;

    // Perspective rays from the vanishing point down to the bottom edge, brighter toward the sides.
    for (let i = 0; i < GRID_RAYS; i++) {
      const t = i / (GRID_RAYS - 1);
      g.globalAlpha = this.maxAlpha * (0.25 + 0.75 * Math.abs(t - 0.5) * 2);
      g.beginPath();
      g.moveTo(vpx, vpy);
      g.lineTo(t * w, h);
      g.stroke();
    }
    // Floor lines, denser toward the bottom (perspective foreshortening).
    for (let i = 0; i < GRID_FLOOR_LINES; i++) {
      const t = i / (GRID_FLOOR_LINES - 1);
      g.globalAlpha = this.maxAlpha * (0.2 + t * 0.8);
      g.fillRect(0, vpy + t * t * (h - vpy), w, 1);
    }
    g.globalAlpha = 1;
    this.cacheKey = key;
  }
}

// ---------------------------------------------------------------------------------------------
// reactive particles: birthFlash, deathParticles
// ---------------------------------------------------------------------------------------------

/** Brightness bands a particle pool is drawn in: one path and one fill each, however many particles. */
const ALPHA_BANDS = 4;

/** Draw every live particle as one path per alpha band — at most {@link ALPHA_BANDS} fills a frame. */
function drawParticleBands(
  target: Canvas2DContext,
  color: string,
  x: Float32Array,
  y: Float32Array,
  life: Float32Array,
  size: number,
): void {
  target.save();
  target.fillStyle = color;
  for (let band = 0; band < ALPHA_BANDS; band++) {
    const hi = (band + 1) / ALPHA_BANDS;
    const lo = band / ALPHA_BANDS;
    let any = false;
    for (let i = 0; i < life.length; i++) {
      const l = life[i]!;
      if (l <= lo || l > hi) continue;
      if (!any) {
        target.beginPath();
        any = true;
      }
      target.rect(x[i]!, y[i]!, size, size);
    }
    if (any) {
      target.globalAlpha = hi;
      target.fill();
    }
  }
  target.restore();
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
  readonly declaredCost = 0.1;
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

  override reset(): void {
    this.life.fill(0);
    this.active = 0;
    this.cursor = 0;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const births = ctx.changes.births | 0;
    if (ctx.reducedMotion) {
      // Flashes are motion: spawn nothing and drop any still in flight.
      if (this.active > 0) this.reset();
      return;
    }
    if (births > 0) {
      const n = Math.min(births, 8);
      for (let i = 0; i < n; i++) this.spawn(ctx);
    }
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= 0.08;
      if (this.life[i]! > 0) live += 1;
    }
    this.active = live;
    if (live > 0) drawParticleBands(ctx.target, this.color, this.x, this.y, this.life, 4);
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
  readonly declaredCost = 0.1;
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

  override reset(): void {
    this.life.fill(0);
    this.active = 0;
    this.cursor = 0;
    this.rng = new Mulberry32(this.seed);
  }

  get activeCount(): number {
    return this.active;
  }

  protected renderTimed(ctx: EffectCtx): void {
    const deaths = ctx.changes.deaths | 0;
    if (ctx.reducedMotion) {
      if (this.active > 0) this.reset();
      return;
    }
    if (deaths > 0) {
      const n = Math.min(deaths, 12);
      for (let i = 0; i < n; i++) this.spawn(ctx);
    }
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      this.x[i]! += this.vx[i]!;
      this.y[i]! += this.vy[i]!;
      this.life[i]! -= 0.04;
      if (this.life[i]! > 0) live += 1;
    }
    this.active = live;
    if (live > 0) drawParticleBands(ctx.target, '#c8b0ff', this.x, this.y, this.life, 2);
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
