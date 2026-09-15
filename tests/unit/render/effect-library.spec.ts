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

  it('filmGrain changes with tick but is stable for a fixed tick', () => {
    const entry = EFFECT_LIBRARY.find((e) => e.id === 'filmGrain')!;
    const h1 = runHash(entry.create(), 1);
    const h2 = runHash(entry.create(), 2);
    const h1b = runHash(entry.create(), 1);
    expect(h1).toBe(h1b);
    expect(h1).not.toBe(h2);
  });
});
