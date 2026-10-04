/**
 * P3-A-5 — effect library: deterministic pixel hashes, declared costs, particle caps.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import {
  EFFECT_LIBRARY,
  QUALITY3_FRAME_BUDGET_MS,
  createThemePassStack,
  mostExpensiveThemeDeclaredCostMs,
} from '@render/effects/library';
import { hashPixels } from '@render/effects/pixel-hash';
import {
  createBirthFlashPass,
  createDeathParticlesPass,
  createParchmentTexturePass,
  createVignettePass,
} from '@render/effects/library';
import { createSoftwareCanvas, asSoftware } from '@render/effects/software-surface';
import type { EffectCtx } from '@render/effects/ctx';
import type { EffectPass } from '@render/effects/pass';
import type { Viewport } from '@render/types';

const VIEWPORT: Viewport = {
  originX: 3,
  originY: -2,
  cellSize: 8,
  widthPx: 48,
  heightPx: 32,
  dpr: 2,
};

function paintSource(): ReturnType<typeof createSoftwareCanvas> {
  const canvas = createSoftwareCanvas(VIEWPORT.widthPx, VIEWPORT.heightPx);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#102030';
  ctx.fillRect(0, 0, VIEWPORT.widthPx, VIEWPORT.heightPx);
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(8, 6, 12, 10);
  ctx.fillStyle = '#44aaff';
  ctx.fillRect(28, 14, 8, 8);
  return canvas;
}

function makeCtx(
  pass: EffectPass,
  tick = 7,
  changes = EMPTY_CHANGES,
  quality: 0 | 1 | 2 | 3 = 3,
): { ctx: EffectCtx; target: ReturnType<typeof createSoftwareCanvas>; source: ReturnType<typeof createSoftwareCanvas> } {
  const source = paintSource();
  const target = createSoftwareCanvas(VIEWPORT.widthPx, VIEWPORT.heightPx);
  const ctx: EffectCtx = {
    target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
    source: source as unknown as CanvasImageSource,
    viewport: VIEWPORT,
    tick,
    frameTime: tick * (1 / 60),
    changes,
    quality,
    reducedMotion: false,
  };
  void pass;
  return { ctx, target, source };
}

function runHash(pass: EffectPass, tick = 7, changes = EMPTY_CHANGES, quality: 0 | 1 | 2 | 3 = 3): string {
  const { ctx, target } = makeCtx(pass, tick, changes, quality);
  pass.resize?.(VIEWPORT.widthPx, VIEWPORT.heightPx, VIEWPORT.dpr);
  pass.render(ctx);
  const soft = asSoftware(target)!;
  return hashPixels(soft.pixels);
}

/** Large enough that a rounding drift cannot hide in a corner — P3-D-4's byte-identity gate. */
const VIGNETTE_VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: 4.55,
  widthPx: 640,
  heightPx: 360,
  dpr: 1,
};

/**
 * The pre-P3-D-4 vignette formulation: `Math.hypot` per texel, no hoisted row term. Kept
 * verbatim as the oracle for the sqrt optimisation — the 48 committed per-theme visual
 * baselines (P3-D-2) make byte-identity a hard requirement, not a nicety.
 */
function vignetteHypotReference(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  strength: number,
): Uint8ClampedArray {
  const out = src.slice();
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const maxR = Math.hypot(cx, cy) || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxR;
      const shade = 1 - strength * d * d;
      const i = (y * w + x) * 4;
      out[i] = (src[i]! * shade) | 0;
      out[i + 1] = (src[i + 1]! * shade) | 0;
      out[i + 2] = (src[i + 2]! * shade) | 0;
    }
  }
  return out;
}

/** Deterministic gradient-ish source so the oracle sees a spread of input values, not flats. */
function vignetteSource(w: number, h: number): Uint8ClampedArray {
  const canvas = createSoftwareCanvas(w, h);
  const pixels = asSoftware(canvas)!.pixels;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 7) & 255;
    pixels[i + 1] = (i * 13) & 255;
    pixels[i + 2] = (i * 29) & 255;
    pixels[i + 3] = 255;
  }
  return pixels;
}

describe('effect library (P3-A-5)', () => {
  it('ships every named pass, each tagged to ≥ 1 theme', () => {
    const ids = EFFECT_LIBRARY.map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        'birthFlash',
        'bloom',
        'chromaticAberration',
        'crtCurvature',
        'deathParticles',
        'filmGrain',
        'gridGlow',
        'hazeGrid',
        'hueShiftByAge',
        'parchmentTexture',
        'phosphorDecay',
        'scanlines',
        'starfield',
        'sunGradient',
        'textRain',
        'trailFade',
        'vignette',
      ].sort(),
    );
    for (const entry of EFFECT_LIBRARY) {
      expect(entry.themes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(EFFECT_LIBRARY.map((e) => [e.id, e] as const))(
    '%s is deterministic from a seeded input (pixel hash)',
    (_id, entry) => {
      const a = entry.create();
      const b = entry.create();
      const ha = runHash(a, 11);
      const hb = runHash(b, 11);
      expect(ha).toBe(hb);
      expect(ha).not.toBe('00000000');
      a.dispose();
      b.dispose();
    },
  );

  it('every pass declares a cost and updates a measured EWMA after render', () => {
    for (const entry of EFFECT_LIBRARY) {
      const pass = entry.create();
      const declared = pass.cost;
      expect(declared).toBeGreaterThan(0);
      const { ctx } = makeCtx(pass);
      pass.resize?.(VIEWPORT.widthPx, VIEWPORT.heightPx, VIEWPORT.dpr);
      pass.render(ctx);
      // EWMA replaces the declaration after the first sample.
      expect(Number.isFinite(pass.cost)).toBe(true);
      expect(pass.cost).toBeGreaterThanOrEqual(0);
      // Tiny 48×32 canvas must stay cheap — absolute ceiling, not the 1080p declaration.
      expect(pass.cost).toBeLessThan(50);
      pass.dispose();
    }
  });

  it('most expensive theme stack fits the quality-3 frame budget (declared costs)', () => {
    const { theme, costMs } = mostExpensiveThemeDeclaredCostMs();
    expect(theme).not.toBe('default');
    expect(costMs).toBeLessThanOrEqual(QUALITY3_FRAME_BUDGET_MS);
    // Sanity: Synthwave / Void-Walker class stacks are non-trivial.
    expect(costMs).toBeGreaterThan(3);
    const stack = createThemePassStack(theme);
    expect(stack.length).toBeGreaterThanOrEqual(3);
    for (const p of stack) p.dispose();
  });

  it('deathParticles stay hard-capped and allocation-free in steady state', () => {
    const pass = createDeathParticlesPass({ cap: 64, seed: 1 });
    expect(pass.bufferAllocations).toBe(1);
    const { ctx } = makeCtx(pass, 1, { births: 0, deaths: 500, transitions: 500 });
    for (let i = 0; i < 40; i++) {
      pass.render({
        ...ctx,
        tick: i,
        changes: { births: 0, deaths: 200, transitions: 200 },
      });
      expect(pass.activeCount).toBeLessThanOrEqual(pass.cap);
    }
    expect(pass.bufferAllocations).toBe(1);
    pass.dispose();
  });

  it('birthFlash stays hard-capped and allocation-free in steady state', () => {
    const pass = createBirthFlashPass({ cap: 32 });
    expect(pass.bufferAllocations).toBe(1);
    const { ctx } = makeCtx(pass, 1, { births: 100, deaths: 0, transitions: 100 });
    for (let i = 0; i < 40; i++) {
      pass.render({
        ...ctx,
        tick: i,
        changes: { births: 50, deaths: 0, transitions: 50 },
      });
      expect(pass.activeCount).toBeLessThanOrEqual(pass.cap);
    }
    expect(pass.bufferAllocations).toBe(1);
    pass.dispose();
  });

  it('parchmentTexture generates once and stays under 40 ms', () => {
    const pass = createParchmentTexturePass({ seed: 99, width: 128, height: 128 });
    pass.generate();
    expect(pass.generated).toBe(true);
    expect(pass.generationMs).toBeLessThan(40);
    const ms = pass.generationMs;
    pass.generate();
    expect(pass.generationMs).toBe(ms);
    pass.dispose();
  });

  it('vignette is byte-identical to the Math.hypot reference for every shipped strength', () => {
    // P3-D-4 replaced a per-texel `Math.hypot` with a hoisted row term + `Math.sqrt`: 29.1 ms →
    // ~12 ms per frame at 1080p, for identical bytes. If a future edit drifts by one ulp where
    // `| 0` truncates, this fails here rather than in 48 committed screenshots.
    const strengths = [0.62, 0.55, 0.5]; // Void-Walker, library default, Chiba-City-era tuning
    for (const strength of strengths) {
      const w = VIGNETTE_VIEWPORT.widthPx;
      const h = VIGNETTE_VIEWPORT.heightPx;
      const source = vignetteSource(w, h);
      const target = createSoftwareCanvas(w, h);
      const ctx: EffectCtx = {
        target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
        source: createSoftwareCanvas(w, h) as unknown as CanvasImageSource,
        viewport: VIGNETTE_VIEWPORT,
        tick: 3,
        frameTime: 3 / 60,
        changes: EMPTY_CHANGES,
        quality: 3,
        reducedMotion: false,
      };
      const pixels = asSoftware(ctx.source)!.pixels;
      pixels.set(source);

      const pass = createVignettePass({ strength });
      pass.resize?.(w, h, 1);
      pass.render(ctx);

      const expected = vignetteHypotReference(source, w, h, strength);
      const actual = asSoftware(target)!.pixels;
      expect(actual.length, `strength ${strength}`).toBe(expected.length);
      let differing = 0;
      let firstDiffering = -1;
      for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
          differing += 1;
          if (firstDiffering < 0) firstDiffering = i;
        }
      }
      expect(
        differing,
        `strength ${strength} shifted ${differing} byte(s), first at ${firstDiffering}`,
      ).toBe(0);
      pass.dispose();
    }
  });

  it('filmGrain changes with tick but is stable for a fixed tick', () => {
    const entry = EFFECT_LIBRARY.find((e) => e.id === 'filmGrain')!;
    const h1 = runHash(entry.create(), 1);
    const h2 = runHash(entry.create(), 2);
    const h1b = runHash(entry.create(), 1);
    expect(h1).toBe(h1b);
    expect(h1).not.toBe(h2);
  });
});
