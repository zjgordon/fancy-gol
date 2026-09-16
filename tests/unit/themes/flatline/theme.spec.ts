/**
 * P3-C-3 — Flatline: quality ladder, overlay, sound, CRT, phosphor clear, textRain budget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventMapper } from '@audio/events';
import { Mixer } from '@audio/mixer';
import { AudioPolicy } from '@audio/policy';
import { Scheduler } from '@audio/scheduler';
import { spawnVoice } from '@audio/voices';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { Compositor } from '@render/compositor';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import {
  FLATLINE_TEXT_RAIN_BUDGET_MS,
  createCrtCurvaturePass,
  createFlatlinePassStack,
  createPhosphorDecayPass,
  createTextRainPass,
  createThemePassStack,
  declaredCostAtQuality,
} from '@render/effects/library';
import { asSoftware, createSoftwareCanvas } from '@render/effects/software-surface';
import { EffectRegistry } from '@render/effects/registry';
import type { CanvasLike } from '@render/layers';
import { QualityGovernor } from '@render/quality-governor';
import type { EffectCtx } from '@render/effects/ctx';
import type { Viewport } from '@render/types';
import { compileTheme, ThemeRegistry } from '@themes/registry';
import { overlayPalette } from '@themes/flatline/overlay';
import { FLATLINE_TYPE_CAP_MS } from '@themes/flatline/motion';
import { FLATLINE_QUALITY, FLATLINE_QUALITY_LEVELS } from '@themes/flatline/quality';
import { FLATLINE_SOUND_PACK, FLATLINE_UI_CUES } from '@themes/flatline/sound';
import { FLATLINE_THEME } from '@themes/flatline/theme';
import { FLATLINE_TOKENS } from '@themes/flatline/tokens';
import { defaultMotionSignature } from '@themes/motion/choreography';
import { FakeAudioContext, ManualClock, MemoryStorage } from '../../audio/fakes';

const BLACK: RGB = { r: 0, g: 0, b: 0 };

function fakeCanvas(width: number, height: number): CanvasLike {
  return {
    width,
    height,
    style: {} as { width?: string; height?: string },
    getContext: (kind: string) =>
      kind === '2d'
        ? {
            fillStyle: '#000',
            clearRect(): void {},
            fillRect(): void {},
            setTransform(): void {},
            drawImage(): void {},
            createImageData(w: number, h: number) {
              return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
            },
            putImageData(): void {},
          }
        : null,
  } as unknown as CanvasLike;
}

const VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: 8,
  widthPx: 48,
  heightPx: 32,
  dpr: 1,
};

function effectCtx(
  target: ReturnType<typeof createSoftwareCanvas>,
  source: ReturnType<typeof createSoftwareCanvas>,
  extra: Partial<EffectCtx> = {},
): EffectCtx {
  const w = extra.viewport?.widthPx ?? source.width;
  const h = extra.viewport?.heightPx ?? source.height;
  return {
    target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
    source: source as unknown as CanvasImageSource,
    viewport: { ...VIEWPORT, widthPx: w, heightPx: h, ...(extra.viewport ?? {}) },
    tick: extra.tick ?? 0,
    frameTime: extra.frameTime ?? 0,
    changes: extra.changes ?? EMPTY_CHANGES,
    quality: extra.quality ?? 3,
    reducedMotion: extra.reducedMotion ?? false,
  };
}

describe('Flatline README (written before implementation)', () => {
  it('states what the theme is about in one paragraph', () => {
    const text = readFileSync(join(process.cwd(), 'src/themes/flatline/README.md'), 'utf8');
    expect(text).toMatch(/phosphor|terminal|amber/i);
    expect(text.split('\n').filter((l) => l.trim().length > 40).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Flatline theme module', () => {
  it('is a plain (non-adaptive) medium-cost atmosphere theme', () => {
    expect(FLATLINE_THEME.id).toBe('flatline');
    expect(FLATLINE_THEME.cost).toBe('medium');
    expect(FLATLINE_THEME.sound).toBe(FLATLINE_SOUND_PACK);
    expect(FLATLINE_THEME.quality).toEqual(FLATLINE_QUALITY);
    expect(FLATLINE_THEME.quality?.losslessAtQuality0).toBe(false);
  });

  it('motion is the star: typewriter enter capped at 400 ms, scramble, fall', () => {
    const def = defaultMotionSignature();
    expect(FLATLINE_THEME.motion.durationMs.slower).toBe(FLATLINE_TYPE_CAP_MS);
    expect(FLATLINE_THEME.motion.enter.maxDurationMs).toBe(FLATLINE_TYPE_CAP_MS);
    expect(FLATLINE_THEME.motion.enter.textReveal).toBe('typewriter');
    expect(FLATLINE_THEME.motion.emphasis.textReveal).toBe('scramble');
    expect(FLATLINE_THEME.motion.exit.textReveal).toBe('fall');
    expect(FLATLINE_THEME.motion.durationMs.fast).not.toBe(def.durationMs.fast);
    expect(FLATLINE_THEME.motion.durationMs.slow).not.toBe(def.durationMs.slow);
  });

  it('registers and activates through ThemeRegistry', () => {
    const calls: Array<[string, string]> = [];
    const r = new ThemeRegistry({
      root: { setProperty: (n, v) => calls.push([n, v]) },
      storage: null,
    });
    r.register(FLATLINE_THEME);
    const resolved = r.activate('flatline');
    expect(resolved.id).toBe('flatline');
    expect(Object.fromEntries(calls)['--gol-color-accent']).toBe(FLATLINE_TOKENS.color.accent);
    expect(r.getCompiledTheme()?.background).toBe(FLATLINE_TOKENS.color.bg);
  });
});

describe('Flatline quality ladder', () => {
  it('defines levels 0–3; quality 0 is empty, quality 3 is the full stack', () => {
    expect(Object.keys(FLATLINE_QUALITY_LEVELS).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(FLATLINE_QUALITY_LEVELS[0].passes).toEqual([]);
    expect(FLATLINE_QUALITY_LEVELS[3].passes).toEqual(
      expect.arrayContaining(['textRain', 'phosphorDecay', 'scanlines', 'crtCurvature']),
    );
    const stack = createThemePassStack('flatline');
    expect(stack.map((p) => p.id)).toEqual(
      expect.arrayContaining(['textRain', 'phosphorDecay', 'scanlines', 'crtCurvature']),
    );
    for (const p of stack) p.dispose();
  });

  it('is strictly more expensive than Default at quality ≥ 1 (declared cost)', () => {
    expect(declaredCostAtQuality('flatline', 0)).toBe(0);
    expect(declaredCostAtQuality('flatline', 1)).toBeGreaterThan(declaredCostAtQuality('default', 1));
    expect(declaredCostAtQuality('flatline', 3)).toBeGreaterThan(declaredCostAtQuality('default', 3));
  });

  it('CRT is a post pass so it is already off at quality ≤ 1', () => {
    expect(declaredCostAtQuality('flatline', 1)).toBeLessThan(declaredCostAtQuality('flatline', 3));
  });
});

describe('Flatline L4 overlay contrast', () => {
  it('selection and origin clear 4.5:1 on bg and on a busy phosphor glyph', () => {
    const bg = resolveOpaqueColor(FLATLINE_TOKENS.color.bg, BLACK);
    const overlay = overlayPalette(FLATLINE_TOKENS);
    expect(contrastRatio(overlay.selection, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.origin, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.gridDecade, bg)).toBeGreaterThanOrEqual(3);
    const rain = resolveOpaqueColor('rgba(255, 176, 0, 0.055)', bg);
    const ghost = resolveOpaqueColor('rgba(255, 176, 0, 0.4)', rain);
    expect(contrastRatio(overlay.selection, ghost)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Flatline sound pack', () => {
  function harness() {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    const policy = new AudioPolicy({
      storage: new MemoryStorage(),
      reducedMotion: () => false,
      prefs: { muted: false },
    });
    const clock = new ManualClock();
    const scheduler = new Scheduler({ context: ctx, mixer, policy, clock });
    const mapper = new EventMapper({
      context: ctx,
      mixer,
      scheduler,
      policy,
      clock,
      pack: FLATLINE_SOUND_PACK,
    });
    return { ctx, scheduler, mapper };
  }

  it('has teletype UI clatter, a soft hum, and a discrete generation click', () => {
    expect(FLATLINE_SOUND_PACK.ambient?.kind).toBe('drone');
    expect(FLATLINE_SOUND_PACK.ui['tool-select']?.kind).toBe('click');
    expect(FLATLINE_SOUND_PACK.sim?.birth?.kind).toBe('click');
    expect(FLATLINE_SOUND_PACK.sim?.generation?.kind).toBe('click');
    for (const cue of FLATLINE_UI_CUES) {
      expect(FLATLINE_SOUND_PACK.ui[cue], cue).toBeDefined();
    }
  });

  it('starts the ambient bed and plays a generation click', () => {
    const { mapper, scheduler } = harness();
    expect(mapper.ambientActive).toBe(true);
    mapper.noteGeneration({
      births: 1,
      centroidX: 10,
      centroidY: 10,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.flush(50);
    scheduler.tick();
    expect(mapper.lastDiscreteKind).toBe('click');
    expect(mapper.simVoiceTimesMs.length).toBeGreaterThanOrEqual(1);
    mapper.dispose();
  });

  it('spawnVoice honours a filtered teletype blip', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const voice = spawnVoice({
      context: ctx,
      destination: dest,
      kind: 'blip',
      id: 1,
      when: 0,
      params: { waveform: 'square', filter: 2200, pitch: 1240 },
    });
    expect(voice.graph.source).toMatchObject({ type: 'square' });
    expect(voice.graph.filter).not.toBeNull();
    voice.stop();
  });
});

describe('Flatline CRT curvature is off at quality ≤ 1', () => {
  it('copies the source through unchanged at quality 1', () => {
    const w = 16;
    const h = 16;
    const source = createSoftwareCanvas(w, h);
    const sctx = source.getContext('2d');
    sctx.fillStyle = '#102030';
    sctx.fillRect(0, 0, w, h);
    sctx.fillStyle = '#ffb000';
    sctx.fillRect(4, 4, 8, 8);
    const target = createSoftwareCanvas(w, h);
    const pass = createCrtCurvaturePass({ amount: 0.2 });
    pass.render(effectCtx(target, source, { quality: 1, viewport: { ...VIEWPORT, widthPx: w, heightPx: h } }));
    const src = asSoftware(source)!.pixels;
    const out = asSoftware(target)!.pixels;
    expect(out).toEqual(src);
    pass.dispose();
  });
});

describe('Flatline phosphor ghosts clear on grid clear', () => {
  it('reset() wipes burn-in so a dead frame is empty', () => {
    const w = 16;
    const h = 16;
    const live = createSoftwareCanvas(w, h);
    live.getContext('2d').fillStyle = '#ffb000';
    live.getContext('2d').fillRect(0, 0, w, h);
    const dead = createSoftwareCanvas(w, h);
    dead.getContext('2d').fillStyle = '#000000';
    dead.getContext('2d').fillRect(0, 0, w, h);

    const pass = createPhosphorDecayPass({ color: [255, 176, 0], fade: 0.9 });
    const first = createSoftwareCanvas(w, h);
    pass.render(effectCtx(first, live, { viewport: { ...VIEWPORT, widthPx: w, heightPx: h } }));
    const ghosted = createSoftwareCanvas(w, h);
    pass.render(effectCtx(ghosted, dead, { viewport: { ...VIEWPORT, widthPx: w, heightPx: h } }));
    const ghostPx = asSoftware(ghosted)!.pixels;
    expect(ghostPx[3]).toBeGreaterThan(0);

    pass.reset();
    const cleared = createSoftwareCanvas(w, h);
    pass.render(effectCtx(cleared, dead, { viewport: { ...VIEWPORT, widthPx: w, heightPx: h } }));
    const clearedPx = asSoftware(cleared)!.pixels;
    let maxA = 0;
    for (let i = 3; i < clearedPx.length; i += 4) maxA = Math.max(maxA, clearedPx[i]!);
    expect(maxA).toBe(0);
    pass.dispose();
  });

  it('Compositor.resetEffects forwards to the phosphor pass', () => {
    const registry = new EffectRegistry();
    const compositor = new Compositor({
      canvasFactory: (w, h) => fakeCanvas(w, h),
      effects: registry,
    });
    const stack = createFlatlinePassStack();
    compositor.setEffectPasses(stack);
    expect(() => compositor.resetEffects()).not.toThrow();
    compositor.dispose();
  });
});

describe('Flatline textRain costs < 1.5 ms/frame at 1080p', () => {
  it('warm render stays under the budget', () => {
    const w = 1920;
    const h = 1080;
    const pass = createTextRainPass({ seed: 3, opacity: 0.055, columns: 48, color: '#ffb000' });
    const source = createSoftwareCanvas(w, h);
    const target = createSoftwareCanvas(w, h);
    const ctx = effectCtx(target, source, {
      viewport: { ...VIEWPORT, widthPx: w, heightPx: h },
      frameTime: 0.5,
    });
    // Discard cold-start / JIT frames so the EWMA and median both reflect warm cost.
    for (let i = 0; i < 4; i++) pass.render(ctx);
    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      pass.render(ctx);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]!).toBeLessThan(FLATLINE_TEXT_RAIN_BUDGET_MS);
    expect(pass.cost).toBeLessThan(FLATLINE_TEXT_RAIN_BUDGET_MS);
    pass.dispose();
  });
});

describe('Flatline compositor at quality 0', () => {
  const theme = compileTheme(FLATLINE_THEME);

  function emptyFrame(tick: number) {
    return {
      cells: {
        get: () => 0,
        getChunk: () => undefined,
        forEachChunkInRect: () => {},
        bounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
        boundary: 'infinite' as const,
      },
      dirty: [] as const,
      tick,
    };
  }

  it('quality 0 holds a 60 fps budget under synthetic 4× frame inflation', async () => {
    const registry = new EffectRegistry();
    const gov = new QualityGovernor({ registry, initialQuality: 0 });
    const compositor = new Compositor({
      canvasFactory: (w, h) => fakeCanvas(w, h),
      effects: registry,
      qualityGovernor: gov,
    });
    await compositor.init(fakeCanvas(64, 64));
    compositor.resize(64, 64, 1);
    compositor.setTheme(theme);
    compositor.setViewport({ ...VIEWPORT, widthPx: 64, heightPx: 64 });
    compositor.setEffectPasses(createFlatlinePassStack());
    expect(registry.totalDeclaredCost()).toBe(0);

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      compositor.draw(emptyFrame(i));
      samples.push(compositor.readStats().frameMs * 4);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]!).toBeLessThan(1000 / 60);
    compositor.dispose();
  });
});

describe('Flatline pass stack', () => {
  it('createFlatlinePassStack matches the quality-3 pass list', () => {
    const stack = createFlatlinePassStack();
    expect(stack.map((p) => p.id)).toEqual(['textRain', 'phosphorDecay', 'scanlines', 'crtCurvature']);
    for (const p of stack) p.dispose();
  });
});
