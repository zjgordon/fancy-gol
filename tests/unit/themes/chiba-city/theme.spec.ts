/**
 * P3-C-2 — Chiba-City: quality ladder, overlay, sound, scanlines, bloom, motion.
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
  CHIBA_BLOOM_THRESHOLD,
  createBloomPass,
  createChibaCityPassStack,
  createScanlinesPass,
  createThemePassStack,
  declaredCostAtQuality,
  scanlinePitch,
} from '@render/effects/library';
import { asSoftware, createSoftwareCanvas } from '@render/effects/software-surface';
import { EffectRegistry } from '@render/effects/registry';
import type { CanvasLike } from '@render/layers';
import { QualityGovernor } from '@render/quality-governor';
import type { EffectCtx } from '@render/effects/ctx';
import type { Viewport } from '@render/types';
import { compileTheme, ThemeRegistry } from '@themes/registry';
import { overlayPalette } from '@themes/chiba-city/overlay';
import { CHIBA_QUALITY, CHIBA_QUALITY_LEVELS } from '@themes/chiba-city/quality';
import { CHIBA_SOUND_PACK, CHIBA_UI_CUES } from '@themes/chiba-city/sound';
import { CHIBA_CITY_THEME } from '@themes/chiba-city/theme';
import { CHIBA_CITY_TOKENS } from '@themes/chiba-city/tokens';
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
  it.each([1, 1.5, 2, 3] as const)('dpr %s uses an integer device-pixel pitch', (dpr) => {
    const pitch = scanlinePitch(dpr);
    expect(Number.isInteger(pitch)).toBe(true);
    expect(pitch).toBeGreaterThanOrEqual(1);
    const source = createSoftwareCanvas(24, 24);
    source.getContext('2d').fillStyle = '#808080';
    source.getContext('2d').fillRect(0, 0, 24, 24);
    const target = createSoftwareCanvas(24, 24);
    const pass = createScanlinesPass({ opacity: 0.2 });
    const ctx: EffectCtx = {
      target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
      source: source as unknown as CanvasImageSource,
      viewport: { ...VIEWPORT, widthPx: 24, heightPx: 24, dpr },
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    };
    pass.render(ctx);
    const px = asSoftware(target)!.pixels;
    const rowLuma: number[] = [];
    for (let y = 0; y < 24; y++) {
      let s = 0;
      for (let x = 0; x < 24; x++) s += px[(y * 24 + x) * 4]!;
      rowLuma.push(s);
    }
    const period = pitch * 2;
    for (let y = 0; y + period < 24; y++) {
      expect(rowLuma[y]).toBe(rowLuma[y + period]);
    }
    pass.dispose();
  });
});

describe('Chiba-City bloom is confined to live cells', () => {
  it('does not lift a below-threshold background texel', () => {
    const w = 16;
    const h = 16;
    const source = createSoftwareCanvas(w, h);
    const sctx = source.getContext('2d');
    sctx.fillStyle = '#05090c';
    sctx.fillRect(0, 0, w, h);
    sctx.fillStyle = '#e7fff9';
    sctx.fillRect(6, 6, 4, 4);
    const target = createSoftwareCanvas(w, h);
    const pass = createBloomPass({ threshold: CHIBA_BLOOM_THRESHOLD, strength: 0.38, radius: 2 });
    pass.resize?.(w, h, 1);
    pass.render({
      target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
      source: source as unknown as CanvasImageSource,
      viewport: { ...VIEWPORT, widthPx: w, heightPx: h },
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    });
    const out = asSoftware(target)!.pixels;
    const src = asSoftware(source)!.pixels;
    const lumaAt = (buf: Uint8ClampedArray, x: number, y: number) => {
      const i = (y * w + x) * 4;
      return (buf[i]! + buf[i + 1]! + buf[i + 2]!) / 3;
    };
    expect(lumaAt(src, 1, 1)).toBeLessThan(CHIBA_BLOOM_THRESHOLD);
    expect(Math.abs(lumaAt(out, 1, 1) - lumaAt(src, 1, 1))).toBeLessThan(3);
    expect(lumaAt(src, 8, 8)).toBeGreaterThan(CHIBA_BLOOM_THRESHOLD);
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
