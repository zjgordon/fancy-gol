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
import {
  createBirthFlashPass,
  createDeathParticlesPass,
  createParchmentTexturePass,
} from '@render/effects/library';
import { RecordingCanvas, recordingFactory, stubOffscreenCanvas } from './recording-canvas';
import type { EffectCtx } from '@render/effects/ctx';
import type { Viewport } from '@render/types';

const VIEWPORT: Viewport = {
  originX: 3,
  originY: -2,
  cellSize: 8,
  widthPx: 48,
  heightPx: 32,
  dpr: 2,
};

/** Canvas ids come from a global counter; rename them by first appearance so two runs compare equal. */
function normaliseIds(json: string): string {
  const seen = new Map<string, string>();
  return json.replace(/"c\d+"/g, (id) => {
    if (!seen.has(id)) seen.set(id, `"canvas${seen.size}"`);
    return seen.get(id)!;
  });
}

/** A ctx whose target records draws instead of holding pixels: every pass is composited (ADR-012). */
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

    // Every pass is composited now (ADR-012), so there are no pixels to hash on a test double: determinism
  // is asserted as an identical draw sequence. What the passes look like is the browser's job
  // (tests/perf/themes-liveness.spec.ts).
  it.each(EFFECT_LIBRARY.map((e) => [e.id, e] as const))(
    '%s is deterministic from a seeded input (draw sequence)',
    (_id, entry) => {
      const run = (): string => {
        const pass = entry.create();
        const { ctx } = makeRecordingCtx(11);
        pass.resize?.(VIEWPORT.widthPx, VIEWPORT.heightPx, VIEWPORT.dpr);
        // Reactive passes draw nothing on a quiet frame, so give every pass something to react to.
        pass.render({ ...ctx, changes: { births: 5, deaths: 5, transitions: 10 } });
        pass.dispose();
        return normaliseIds(JSON.stringify((ctx.target as unknown as { canvas: RecordingCanvas }).canvas.ctx.ops));
      };
      const a = run();
      expect(a).toBe(run());
      expect(a).not.toBe('[]');
    },
  );

  it('every pass declares a cost and updates a measured EWMA after render', () => {
    for (const entry of EFFECT_LIBRARY) {
      const pass = entry.create();
      const declared = pass.cost;
      expect(declared).toBeGreaterThan(0);
      const { ctx } = makeRecordingCtx();
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
    const { ctx } = makeRecordingCtx(1);
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
    const { ctx } = makeRecordingCtx(1);
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
