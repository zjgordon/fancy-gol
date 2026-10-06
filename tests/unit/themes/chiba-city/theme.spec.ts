/**
 * P3-C-2 — Chiba-City: quality ladder, overlay, sound, scanlines, bloom, motion.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventMapper } from '@audio/events';
import { Mixer } from '@audio/mixer';
import { AudioPolicy } from '@audio/policy';
import { Scheduler } from '@audio/scheduler';
import { spawnVoice } from '@audio/voices';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { Compositor } from '@render/compositor';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import {
  createBloomPass,
  createChibaCityPassStack,
  createScanlinesPass,
  createThemePassStack,
  declaredCostAtQuality,
  scanlinePitch,
} from '@render/effects/library';
import { RecordingCanvas, recordingFactory, stubOffscreenCanvas } from '../../render/recording-canvas';
import { EffectRegistry } from '@render/effects/registry';
import type { CanvasLike } from '@render/layers';
import { QualityGovernor } from '@render/quality-governor';
import type { Viewport } from '@render/types';
import { compileTheme, ThemeRegistry } from '@themes/registry';
import { overlayPalette } from '@themes/chiba-city/overlay';
import { CHIBA_QUALITY, CHIBA_QUALITY_LEVELS } from '@themes/chiba-city/quality';
import { CHIBA_SOUND_PACK, CHIBA_UI_CUES } from '@themes/chiba-city/sound';
import { CHIBA_CITY_THEME } from '@themes/chiba-city/theme';
import { CHIBA_CITY_TOKENS } from '@themes/chiba-city/tokens';
import { defaultMotionSignature } from '@themes/motion/choreography';
import { FakeAudioContext, ManualClock, MemoryStorage } from '../../audio/fakes';

// Composited passes (ADR-012) bake canvases at activation; jsdom/node have no OffscreenCanvas.
beforeAll(stubOffscreenCanvas);
afterAll(() => vi.unstubAllGlobals());

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

describe('Chiba-City README (written before implementation)', () => {
  it('states what the theme is about in one paragraph', () => {
    const text = readFileSync(join(process.cwd(), 'src/themes/chiba-city/README.md'), 'utf8');
    expect(text).toMatch(/night market|cyberpunk|white-hot/i);
    expect(text.split('\n').filter((l) => l.trim().length > 40).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Chiba-City theme module', () => {
  it('is a plain (non-adaptive) medium-cost atmosphere theme', () => {
    expect(CHIBA_CITY_THEME.id).toBe('chiba-city');
    expect(CHIBA_CITY_THEME.cost).toBe('medium');
    expect(CHIBA_CITY_THEME.sound).toBe(CHIBA_SOUND_PACK);
    expect(CHIBA_CITY_THEME.quality).toEqual(CHIBA_QUALITY);
    expect(CHIBA_CITY_THEME.quality?.losslessAtQuality0).toBe(false);
  });

  it('motion is faster than Default and uses a one-frame overshoot', () => {
    const def = defaultMotionSignature();
    expect(CHIBA_CITY_THEME.motion.durationMs.fast).toBeLessThan(def.durationMs.fast);
    expect(CHIBA_CITY_THEME.motion.durationMs.slow).toBeLessThan(def.durationMs.slow);
    expect(CHIBA_CITY_THEME.motion.enter.keyframes.length).toBeGreaterThan(def.enter.keyframes.length);
    expect(CHIBA_CITY_THEME.motion.emphasis.easingKey).toBe('bounce');
    const mid = CHIBA_CITY_THEME.motion.enter.keyframes[1];
    expect(mid?.transform).toMatch(/-1px/);
  });

  it('registers and activates through ThemeRegistry', () => {
    const calls: Array<[string, string]> = [];
    const r = new ThemeRegistry({
      root: { setProperty: (n, v) => calls.push([n, v]) },
      storage: null,
    });
    r.register(CHIBA_CITY_THEME);
    const resolved = r.activate('chiba-city');
    expect(resolved.id).toBe('chiba-city');
    expect(Object.fromEntries(calls)['--gol-color-accent']).toBe(CHIBA_CITY_TOKENS.color.accent);
    expect(r.getCompiledTheme()?.background).toBe(CHIBA_CITY_TOKENS.color.bg);
  });
});

describe('Chiba-City quality ladder', () => {
  it('defines levels 0–3; quality 0 is empty, quality 3 is the full stack', () => {
    expect(Object.keys(CHIBA_QUALITY_LEVELS).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(CHIBA_QUALITY_LEVELS[0].passes).toEqual([]);
    expect(CHIBA_QUALITY_LEVELS[3].passes).toEqual(
      expect.arrayContaining(['hazeGrid', 'bloom', 'scanlines', 'chromaticAberration', 'filmGrain']),
    );
    const ids = createThemePassStack('chiba-city').map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['hazeGrid', 'birthFlash', 'bloom', 'scanlines']));
    for (const p of createThemePassStack('chiba-city')) p.dispose();
  });

  it('is strictly more expensive than Default at quality ≥ 1 (declared cost)', () => {
    expect(declaredCostAtQuality('chiba-city', 0)).toBe(0);
    expect(declaredCostAtQuality('chiba-city', 1)).toBeGreaterThan(declaredCostAtQuality('default', 1));
    expect(declaredCostAtQuality('chiba-city', 3)).toBeGreaterThan(declaredCostAtQuality('default', 3));
  });
});

describe('Chiba-City L4 overlay contrast', () => {
  it('selection and origin clear 4.5:1 on bg and on a busy haze line', () => {
    const bg = resolveOpaqueColor(CHIBA_CITY_TOKENS.color.bg, BLACK);
    const overlay = overlayPalette(CHIBA_CITY_TOKENS);
    expect(contrastRatio(overlay.selection, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.origin, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.gridDecade, bg)).toBeGreaterThanOrEqual(3);
    const haze = resolveOpaqueColor('rgba(46, 230, 214, 0.14)', bg);
    expect(contrastRatio(overlay.selection, haze)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Chiba-City sound pack', () => {
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
      pack: CHIBA_SOUND_PACK,
    });
    return { ctx, scheduler, mapper };
  }

  it('has filtered square blips, a modem-hum ambient, and a mechanical tool click', () => {
    expect(CHIBA_SOUND_PACK.ambient?.kind).toBe('drone');
    expect(CHIBA_SOUND_PACK.ui['tool-select']?.kind).toBe('click');
    expect(CHIBA_SOUND_PACK.sim?.birth?.kind).toBe('blip');
    expect(CHIBA_SOUND_PACK.sim?.birth?.params?.waveform).toBe('square');
    for (const cue of CHIBA_UI_CUES) {
      expect(CHIBA_SOUND_PACK.ui[cue], cue).toBeDefined();
    }
  });

  it('starts the ambient bed and plays a square birth blip', () => {
    const { mapper, scheduler } = harness();
    expect(mapper.ambientActive).toBe(true);
    mapper.noteGeneration({
      births: 3,
      centroidX: 10,
      centroidY: 10,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.flush(50);
    scheduler.tick();
    expect(mapper.simVoiceTimesMs.length).toBeGreaterThanOrEqual(1);
    mapper.dispose();
  });

  it('spawnVoice honours waveform=square and a lowpass for Chiba blips', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const voice = spawnVoice({
      context: ctx,
      destination: dest,
      kind: 'blip',
      id: 1,
      when: 0,
      params: { waveform: 'square', filter: 1600, pitch: 660 },
    });
    expect(voice.graph.source).toMatchObject({ type: 'square' });
    expect(voice.graph.filter).not.toBeNull();
    voice.stop();
  });
});

describe('Chiba-City scanlines do not moiré at dpr 1, 1.5, 2, 3', () => {
  // Structure, not pixels (ADR-012 rule 3): the tile is an integer number of device pixels per
  // half-period and is filled once across the viewport, so there is nothing to beat against.
  // How it looks in a real canvas is proven by the browser-floor liveness spec and, once
  // re-captured by P3-E-6, the per-theme baselines.
  it.each([1, 1.5, 2, 3] as const)('dpr %s uses an integer device-pixel pitch and a 2·pitch tile', (dpr) => {
    const pitch = scanlinePitch(dpr);
    expect(Number.isInteger(pitch)).toBe(true);
    expect(pitch).toBeGreaterThanOrEqual(1);
    const target = new RecordingCanvas(24, 24);
    const baked = recordingFactory();
    const pass = createScanlinesPass({ opacity: 0.2, canvasFactory: baked.factory });
    pass.render({
      target: target.ctx as unknown as CanvasRenderingContext2D,
      source: target as unknown as CanvasImageSource,
      cells: target as unknown as CanvasImageSource,
      viewport: { ...VIEWPORT, widthPx: 24, heightPx: 24, dpr },
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    });
    const tile = baked.canvases[0]!;
    expect([tile.width, tile.height]).toEqual([1, pitch * 2]);
    const fills = target.ctx.only('fillRect');
    expect(fills).toHaveLength(1);
    expect(fills[0]!.composite).toBe('multiply');
    expect(fills[0]!.args).toEqual([0, 0, 24, 24]);
    pass.dispose();
  });
});

describe('Chiba-City bloom is confined to live cells', () => {
  // Confinement is by construction: bloom samples the L1 cell layer, never the composite, so a
  // background texel cannot glow. (The per-texel version needed a luma threshold to approximate
  // this; the threshold is gone.) Once Chiba-City's cell layer is transparent (P3-E-3) the
  // guarantee is exact; until then an opaque dark background contributes only its own colour.
  it('reads the cell layer and adds a single additive blit', () => {
    const w = 16;
    const h = 16;
    const target = new RecordingCanvas(w, h);
    const cells = new RecordingCanvas(w, h);
    const composite = new RecordingCanvas(w, h);
    const baked = recordingFactory();
    const pass = createBloomPass({ strength: 0.38, radius: 2, canvasFactory: baked.factory });
    pass.resize?.(w, h, 1);
    pass.render({
      target: target.ctx as unknown as CanvasRenderingContext2D,
      source: composite as unknown as CanvasImageSource,
      cells: cells as unknown as CanvasImageSource,
      viewport: { ...VIEWPORT, widthPx: w, heightPx: h },
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    });
    const reads = baked.canvases.flatMap((c) => c.ctx.only('drawImage')).map((o) => o.detail);
    expect(reads).toContain(cells.id);
    expect(reads).not.toContain(composite.id);
    const blits = target.ctx.only('drawImage');
    expect(blits).toHaveLength(1);
    expect(blits[0]!.composite).toBe('lighter');
    pass.dispose();
  });
});

describe('Chiba-City compositor at quality 0', () => {
  const theme = compileTheme(CHIBA_CITY_THEME);

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
    compositor.setEffectPasses(createChibaCityPassStack());
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

describe('Chiba-City pass stack', () => {
  it('createChibaCityPassStack matches the quality-3 pass list', () => {
    const stack = createChibaCityPassStack();
    expect(stack.map((p) => p.id)).toEqual([
      'hazeGrid',
      'birthFlash',
      'bloom',
      'scanlines',
      'chromaticAberration',
      'filmGrain',
    ]);
    for (const p of stack) p.dispose();
  });
});
