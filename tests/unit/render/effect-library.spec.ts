/**
 * P3-A-5 — effect library: deterministic pixel hashes, declared costs, particle caps.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { RecordingCanvas, recordingFactory, stubOffscreenCanvas } from './recording-canvas';
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
    cells: source as unknown as CanvasImageSource,
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

const NON_POST_ENTRIES = EFFECT_LIBRARY.filter((e) => {
  const pass = e.create();
  const isPost = pass.stage === 'post';
  pass.dispose();
  return !isPost;
});

/** A ctx whose target records draws instead of holding pixels — for composited post passes. */
function makeRecordingCtx(tick = 7): { ctx: EffectCtx; baked: ReturnType<typeof recordingFactory> } {
  const target = new RecordingCanvas(VIEWPORT.widthPx, VIEWPORT.heightPx);
  const cells = new RecordingCanvas(VIEWPORT.widthPx, VIEWPORT.heightPx);
  return {
    baked: recordingFactory(),
    ctx: {
      target: target.ctx as unknown as CanvasRenderingContext2D,
      source: target as unknown as CanvasImageSource,
      cells: cells as unknown as CanvasImageSource,
      viewport: VIEWPORT,
      tick,
      frameTime: tick / 60,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    },
  };
}

// Library entries build passes with the default canvas factory, which wants `OffscreenCanvas`.
beforeAll(stubOffscreenCanvas);
afterAll(() => vi.unstubAllGlobals());

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

  // Post passes are composited (ADR-012) and have no pixels to hash on a test double: their
  // determinism is asserted as a draw sequence in post-passes.spec.ts. Browser truth for what they
  // look like is tests/perf/themes-liveness.spec.ts.
  it.each(NON_POST_ENTRIES.map((e) => [e.id, e] as const))(
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
      const { ctx } = pass.stage === 'post' ? makeRecordingCtx() : makeCtx(pass);
      pass.resize?.(VIEWPORT.widthPx, VIEWPORT.heightPx, VIEWPORT.dpr);
      pass.render(ctx);
      // EWMA replaces the declaration after the first sample.
      expect(Number.isFinite(pass.cost)).toBe(true);
      expect(pass.cost).toBeGreaterThanOrEqual(0);
      // The first sample seeds the EWMA and includes JIT and first-touch cost (it measured 58.9 ms
      // against this ceiling on a loaded box). Steady state is what the ceiling is about, so warm
      // the pass up and assert on that — same ceiling, quieter measurement (P3-E-8).
      for (let i = 0; i < 20; i++) pass.render(ctx);
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
});
