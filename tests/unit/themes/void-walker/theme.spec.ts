/**
 * P3-C-5 — Void-Walker: starfield parallax, strongest bloom, pooled particles, runtime IR.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventMapper } from '@audio/events';
import { Mixer } from '@audio/mixer';
import { AudioPolicy } from '@audio/policy';
import { Scheduler } from '@audio/scheduler';
import { spawnVoice } from '@audio/voices';
import {
  VOID_REVERB_IMPULSE_SEED as AUDIO_IMPULSE_SEED,
  synthesizeReverbImpulse,
} from '@audio/impulse';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { Compositor } from '@render/compositor';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import {
  CHIBA_BLOOM_THRESHOLD,
  VOID_BLOOM_RADIUS,
  VOID_BLOOM_STRENGTH,
  VOID_BLOOM_THRESHOLD,
  createBloomPass,
  createDeathParticlesPass,
  createStarfieldPass,
  createThemePassStack,
  createVoidWalkerPassStack,
  declaredCostAtQuality,
  starParallax,
  starScreenPosition,
} from '@render/effects/library';
import { asSoftware, createSoftwareCanvas } from '@render/effects/software-surface';
import { hashPixels } from '@render/effects/pixel-hash';
import { EffectRegistry } from '@render/effects/registry';
import { COMPOSITOR_LAYER_IDS, type CanvasLike } from '@render/layers';
import { QualityGovernor } from '@render/quality-governor';
import type { EffectCtx } from '@render/effects/ctx';
import type { Viewport } from '@render/types';
import { compileTheme, ThemeRegistry } from '@themes/registry';
import { overlayPalette } from '@themes/void-walker/overlay';
import { VOID_QUALITY, VOID_QUALITY_LEVELS } from '@themes/void-walker/quality';
import { VOID_REVERB_IMPULSE_SEED, VOID_SOUND_PACK, VOID_UI_CUES } from '@themes/void-walker/sound';
import { VOID_WALKER_THEME } from '@themes/void-walker/theme';
import { VOID_WALKER_TOKENS } from '@themes/void-walker/tokens';
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

function starfieldHash(vp: Viewport, seed = 42): string {
  const pass = createStarfieldPass({ seed, layers: 3, starsPerLayer: 24 });
  const target = createSoftwareCanvas(vp.widthPx, vp.heightPx);
  const ctx: EffectCtx = {
    target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
    source: target as unknown as CanvasImageSource,
    viewport: vp,
    tick: 0,
    frameTime: 0,
    changes: EMPTY_CHANGES,
    quality: 3,
    reducedMotion: true,
  };
  pass.render(ctx);
  const hash = hashPixels(asSoftware(target)!.pixels);
  pass.dispose();
  return hash;
}

describe('Void-Walker README (written before implementation)', () => {
  it('states what the theme is about in one paragraph', () => {
    const text = readFileSync(join(process.cwd(), 'src/themes/void-walker/README.md'), 'utf8');
    expect(text).toMatch(/starlight|violet|bloom/i);
    expect(text.split('\n').filter((l) => l.trim().length > 40).length).toBeGreaterThanOrEqual(1);
  });

  it('ships zero image or audio assets', () => {
    const dir = join(process.cwd(), 'src/themes/void-walker');
    const files = readdirSync(dir);
    expect(files.some((f) => /\.(png|jpg|jpeg|webp|gif|svg|wav|mp3|ogg|flac|m4a)$/i.test(f))).toBe(
      false,
    );
    for (const f of files) {
      if (!/\.(ts|css|md)$/.test(f)) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/\.(png|jpg|jpeg|webp|gif|svg|wav|mp3|ogg)\b/i);
      expect(src).not.toMatch(/url\(/);
    }
  });
});

describe('Void-Walker theme module', () => {
  it('is a plain high-cost atmosphere theme with transparent dead cells', () => {
    expect(VOID_WALKER_THEME.id).toBe('void-walker');
    expect(VOID_WALKER_THEME.cost).toBe('high');
    expect(VOID_WALKER_THEME.sound).toBe(VOID_SOUND_PACK);
    expect(VOID_WALKER_THEME.quality).toEqual(VOID_QUALITY);
    expect(VOID_WALKER_THEME.quality?.losslessAtQuality0).toBe(false);
    expect(VOID_WALKER_THEME.cellLayerBackground).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
  });

  it('motion is slower than Default, ease-out-heavy, and never snaps', () => {
    const def = defaultMotionSignature();
    expect(VOID_WALKER_THEME.motion.durationMs.fast).toBeGreaterThan(def.durationMs.fast);
    expect(VOID_WALKER_THEME.motion.durationMs.slow).toBeGreaterThan(def.durationMs.slow);
    expect(VOID_WALKER_THEME.motion.durationMs.slower).toBeGreaterThan(def.durationMs.slower);
    expect(VOID_WALKER_THEME.motion.enter.easingKey).toBe('decelerate');
    expect(VOID_WALKER_THEME.motion.enter.keyframes.length).toBeGreaterThan(def.enter.keyframes.length);
    expect(VOID_WALKER_THEME.motion.emphasis.easingKey).not.toBe('bounce');
    expect(VOID_WALKER_THEME.motion.enter.easingKey).not.toBe('bounce');
  });

  it('registers and activates through ThemeRegistry', () => {
    const calls: Array<[string, string]> = [];
    const r = new ThemeRegistry({
      root: { setProperty: (n, v) => calls.push([n, v]) },
      storage: null,
    });
    r.register(VOID_WALKER_THEME);
    const resolved = r.activate('void-walker');
    expect(resolved.id).toBe('void-walker');
    expect(Object.fromEntries(calls)['--gol-color-accent']).toBe(VOID_WALKER_TOKENS.color.accent);
    expect(r.getCompiledTheme()?.background).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('Void-Walker quality ladder', () => {
  it('defines levels 0–3; quality 0 is empty, quality 3 is the full stack', () => {
    expect(Object.keys(VOID_QUALITY_LEVELS).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(VOID_QUALITY_LEVELS[0].passes).toEqual([]);
    expect(VOID_QUALITY_LEVELS[3].passes).toEqual([
      'starfield',
      'deathParticles',
      'trailFade',
      'bloom',
      'vignette',
    ]);
    const ids = createThemePassStack('void-walker').map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['starfield', 'deathParticles', 'trailFade', 'bloom', 'vignette']),
    );
    for (const p of createThemePassStack('void-walker')) p.dispose();
  });

  it('is strictly more expensive than Default at quality ≥ 1', () => {
    expect(declaredCostAtQuality('void-walker', 0)).toBe(0);
    expect(declaredCostAtQuality('void-walker', 1)).toBeGreaterThan(declaredCostAtQuality('default', 1));
    expect(declaredCostAtQuality('void-walker', 3)).toBeGreaterThan(declaredCostAtQuality('default', 3));
  });
});

describe('Void-Walker L4 overlay contrast', () => {
  it('selection and origin clear 4.5:1 on bg and on a busy star texel', () => {
    const bg = resolveOpaqueColor(VOID_WALKER_TOKENS.color.bg, BLACK);
    const overlay = overlayPalette(VOID_WALKER_TOKENS);
    expect(contrastRatio(overlay.selection, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.origin, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.gridDecade, bg)).toBeGreaterThanOrEqual(3);
    const star = resolveOpaqueColor('rgba(232, 224, 255, 0.35)', bg);
    expect(contrastRatio(overlay.selection, star)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Void-Walker sound pack', () => {
  it('has bell plucks, a deep pad, and a runtime impulse seed', () => {
    expect(VOID_SOUND_PACK.ambient?.kind).toBe('pad');
    expect(VOID_SOUND_PACK.ui['tool-select']?.kind).toBe('pluck');
    expect(VOID_SOUND_PACK.ui['tool-select']?.params?.reverb).toBe(true);
    expect(VOID_SOUND_PACK.sim?.birth?.kind).toBe('pluck');
    expect(VOID_REVERB_IMPULSE_SEED).toBe(AUDIO_IMPULSE_SEED);
    for (const cue of VOID_UI_CUES) {
      expect(VOID_SOUND_PACK.ui[cue], cue).toBeDefined();
    }
  });

  it('starts the ambient bed', () => {
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
      pack: VOID_SOUND_PACK,
    });
    expect(mapper.ambientActive).toBe(true);
    mapper.dispose();
  });

  it('spawnVoice convolves plucks against a synthesised impulse', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const voice = spawnVoice({
      context: ctx,
      destination: dest,
      kind: 'pluck',
      id: 1,
      when: 0,
      params: { reverb: true, pitch: 660 },
    });
    expect(voice.graph.convolver).not.toBeNull();
    expect(ctx.createConvolverCount).toBe(1);
    expect(ctx.convolvers[0]?.buffer).not.toBeNull();
    expect(ctx.convolvers[0]?.buffer?.length).toBeGreaterThan(ctx.sampleRate);
    voice.stop();
  });
});

describe('Void-Walker reverb impulse is generated at runtime', () => {
  it('is deterministic for a seed and contains no bundled audio', () => {
    const a = synthesizeReverbImpulse(48_000, { seed: AUDIO_IMPULSE_SEED });
    const b = synthesizeReverbImpulse(48_000, { seed: AUDIO_IMPULSE_SEED });
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(48_000);
    expect([...a]).toEqual([...b]);
    const other = synthesizeReverbImpulse(48_000, { seed: 99 });
    expect(other[16]).not.toBe(a[16]);
    const audioDir = join(process.cwd(), 'src/audio');
    const audioFiles = readdirSync(audioDir);
    expect(audioFiles.some((f) => /\.(wav|mp3|ogg|flac|m4a)$/i.test(f))).toBe(false);
  });
});

describe('Void-Walker starfield parallax is stable', () => {
  it('pan away and back yields the identical field', () => {
    const home: Viewport = { ...VIEWPORT, originX: 12, originY: -7, cellSize: 8 };
    const away: Viewport = { ...home, originX: 480, originY: 310 };
    const back: Viewport = { ...home };
    expect(starfieldHash(home)).toBe(starfieldHash(back));
    expect(starfieldHash(away)).not.toBe(starfieldHash(home));
  });

  it('is deterministic at extreme zoom and does not accumulate drift', () => {
    for (const cellSize of [0.02, 1, 8, 64, 128] as const) {
      const vp: Viewport = { ...VIEWPORT, originX: 1_000_003.25, originY: -88_001.5, cellSize };
      expect(starfieldHash(vp)).toBe(starfieldHash(vp));
    }
    const a = starScreenPosition(100, 40, VIEWPORT, starParallax(1));
    const period = VIEWPORT.widthPx / (starParallax(1) * VIEWPORT.cellSize);
    const b = starScreenPosition(
      100,
      40,
      { ...VIEWPORT, originX: VIEWPORT.originX + period },
      starParallax(1),
    );
    expect(b.x).toBeCloseTo(a.x, 6);
  });
});

describe('Void-Walker bloom does not obscure L4', () => {
  it('is the strongest bloom and leaves below-threshold texels alone', () => {
    expect(VOID_BLOOM_STRENGTH).toBeGreaterThan(0.38);
    expect(VOID_BLOOM_RADIUS).toBeGreaterThan(2);
    expect(VOID_BLOOM_THRESHOLD).toBeLessThan(CHIBA_BLOOM_THRESHOLD);
    expect(COMPOSITOR_LAYER_IDS).not.toContain('overlay');

    const w = 16;
    const h = 16;
    const source = createSoftwareCanvas(w, h);
    const sctx = source.getContext('2d');
    sctx.fillStyle = '#05010f';
    sctx.fillRect(0, 0, w, h);
    sctx.fillStyle = '#f4edff';
    sctx.fillRect(6, 6, 4, 4);
    const target = createSoftwareCanvas(w, h);
    const pass = createBloomPass({
      threshold: VOID_BLOOM_THRESHOLD,
      strength: VOID_BLOOM_STRENGTH,
      radius: VOID_BLOOM_RADIUS,
    });
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
    expect(lumaAt(src, 1, 1)).toBeLessThan(VOID_BLOOM_THRESHOLD);
    expect(Math.abs(lumaAt(out, 1, 1) - lumaAt(src, 1, 1))).toBeLessThan(3);
    expect(lumaAt(src, 8, 8)).toBeGreaterThan(VOID_BLOOM_THRESHOLD);
    pass.dispose();
  });
});

describe('Void-Walker death particles', () => {
  it('are pooled, hard-capped, allocation-free, and clear on reset', () => {
    const pass = createDeathParticlesPass({ cap: 64, seed: 9 });
    expect(pass.bufferAllocations).toBe(1);
    const target = createSoftwareCanvas(VIEWPORT.widthPx, VIEWPORT.heightPx);
    const ctx: EffectCtx = {
      target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
      source: target as unknown as CanvasImageSource,
      viewport: VIEWPORT,
      tick: 0,
      frameTime: 0,
      changes: { births: 0, deaths: 200, transitions: 200 },
      quality: 3,
      reducedMotion: false,
    };
    for (let i = 0; i < 40; i++) {
      pass.render({ ...ctx, tick: i });
      expect(pass.activeCount).toBeLessThanOrEqual(pass.cap);
    }
    expect(pass.bufferAllocations).toBe(1);
    pass.reset();
    expect(pass.activeCount).toBe(0);
    pass.dispose();
  });
});

describe('Void-Walker compositor at quality 0', () => {
  const theme = compileTheme(VOID_WALKER_THEME);

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
    compositor.setEffectPasses(createVoidWalkerPassStack());
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

describe('Void-Walker pass stack', () => {
  it('createVoidWalkerPassStack matches the quality-3 pass list', () => {
    const stack = createVoidWalkerPassStack();
    expect(stack.map((p) => p.id)).toEqual([
      'starfield',
      'deathParticles',
      'trailFade',
      'bloom',
      'vignette',
    ]);
    for (const p of stack) p.dispose();
  });
});
