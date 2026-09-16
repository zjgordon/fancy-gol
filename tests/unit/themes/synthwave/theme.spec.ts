/**
 * P3-C-6 — Synthwave: horizon grid, arpeggio tempo, neon CVD palette, pass stack.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arpeggioIntervalSec, ArpeggioBed } from '@audio/arpeggio';
import { EventMapper } from '@audio/events';
import { Mixer } from '@audio/mixer';
import { AudioPolicy } from '@audio/policy';
import { Scheduler } from '@audio/scheduler';
import { spawnVoice } from '@audio/voices';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { Compositor } from '@render/compositor';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import {
  createGridGlowPass,
  createSynthwavePassStack,
  createThemePassStack,
  declaredCostAtQuality,
  SYNTH_SUN_Y,
  vanishingPointX,
} from '@render/effects/library';
import { asSoftware, createSoftwareCanvas } from '@render/effects/software-surface';
import { hashPixels } from '@render/effects/pixel-hash';
import { EffectRegistry } from '@render/effects/registry';
import type { CanvasLike } from '@render/layers';
import { QualityGovernor } from '@render/quality-governor';
import type { EffectCtx } from '@render/effects/ctx';
import type { Viewport } from '@render/types';
import { compileTheme, ThemeRegistry } from '@themes/registry';
import { overlayPalette } from '@themes/synthwave/overlay';
import { SYNTH_QUALITY, SYNTH_QUALITY_LEVELS } from '@themes/synthwave/quality';
import { SYNTH_ARPEGGIO, SYNTH_UI_CUES, SYNTHWAVE_SOUND_PACK } from '@themes/synthwave/sound';
import { SYNTHWAVE_THEME } from '@themes/synthwave/theme';
import { SYNTHWAVE_TOKENS } from '@themes/synthwave/tokens';
import { defaultMotionSignature } from '@themes/motion/choreography';
import { FakeAudioContext, ManualClock, MemoryStorage } from '../../audio/fakes';
import type { FakeOscillator } from '../../audio/fakes';

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

describe('Synthwave README (written before implementation)', () => {
  it('states what the theme is about in one paragraph', () => {
    const text = readFileSync(join(process.cwd(), 'src/themes/synthwave/README.md'), 'utf8');
    expect(text).toMatch(/1984|magenta|cyan|arpeggio/i);
    expect(text.split('\n').filter((l) => l.trim().length > 40).length).toBeGreaterThanOrEqual(1);
  });

  it('ships zero image or audio assets', () => {
    const dir = join(process.cwd(), 'src/themes/synthwave');
    const files = readdirSync(dir);
    expect(files.some((f) => /\.(png|jpg|jpeg|webp|gif|svg|wav|mp3|ogg|flac|m4a)$/i.test(f))).toBe(
      false,
    );
  });
});

describe('Synthwave theme module', () => {
  it('is a plain high-cost atmosphere theme with transparent dead cells', () => {
    expect(SYNTHWAVE_THEME.id).toBe('synthwave');
    expect(SYNTHWAVE_THEME.cost).toBe('high');
    expect(SYNTHWAVE_THEME.sound).toBe(SYNTHWAVE_SOUND_PACK);
    expect(SYNTHWAVE_THEME.quality).toEqual(SYNTH_QUALITY);
    expect(SYNTHWAVE_THEME.quality?.losslessAtQuality0).toBe(false);
    expect(SYNTHWAVE_THEME.cellLayerBackground).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
  });

  it('motion is snappier than Default with an elastic overshoot', () => {
    const def = defaultMotionSignature();
    expect(SYNTHWAVE_THEME.motion.durationMs.fast).toBeLessThan(def.durationMs.fast);
    expect(SYNTHWAVE_THEME.motion.enter.easingKey).toBe('bounce');
    expect(SYNTHWAVE_THEME.motion.emphasis.easingKey).toBe('bounce');
    const mid = SYNTHWAVE_THEME.motion.enter.keyframes[1];
    expect(mid?.transform).toMatch(/1\.03/);
  });

  it('registers and activates through ThemeRegistry', () => {
    const calls: Array<[string, string]> = [];
    const r = new ThemeRegistry({
      root: { setProperty: (n, v) => calls.push([n, v]) },
      storage: null,
    });
    r.register(SYNTHWAVE_THEME);
    const resolved = r.activate('synthwave');
    expect(resolved.id).toBe('synthwave');
    expect(Object.fromEntries(calls)['--gol-color-accent']).toBe(SYNTHWAVE_TOKENS.color.accent);
    expect(r.getCompiledTheme()?.background).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('Synthwave quality ladder', () => {
  it('defines levels 0–3; quality 0 is empty, quality 3 is the full stack', () => {
    expect(Object.keys(SYNTH_QUALITY_LEVELS).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(SYNTH_QUALITY_LEVELS[0].passes).toEqual([]);
    expect(SYNTH_QUALITY_LEVELS[3].passes).toEqual([
      'sunGradient',
      'gridGlow',
      'hueShiftByAge',
      'bloom',
      'chromaticAberration',
      'scanlines',
    ]);
    const ids = createThemePassStack('synthwave').map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'sunGradient',
        'gridGlow',
        'hueShiftByAge',
        'bloom',
        'chromaticAberration',
        'scanlines',
      ]),
    );
    for (const p of createThemePassStack('synthwave')) p.dispose();
  });

  it('is strictly more expensive than Default at quality ≥ 1', () => {
    expect(declaredCostAtQuality('synthwave', 0)).toBe(0);
    expect(declaredCostAtQuality('synthwave', 1)).toBeGreaterThan(declaredCostAtQuality('default', 1));
    expect(declaredCostAtQuality('synthwave', 3)).toBeGreaterThan(declaredCostAtQuality('default', 3));
  });
});

describe('Synthwave L4 overlay contrast', () => {
  it('selection and origin clear 4.5:1 on bg and on a busy neon grid line', () => {
    const bg = resolveOpaqueColor(SYNTHWAVE_TOKENS.color.bg, BLACK);
    const overlay = overlayPalette(SYNTHWAVE_TOKENS);
    expect(contrastRatio(overlay.selection, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.origin, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.gridDecade, bg)).toBeGreaterThanOrEqual(3);
    const neon = resolveOpaqueColor('rgba(255, 43, 214, 0.26)', bg);
    expect(contrastRatio(overlay.selection, neon)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Synthwave sound pack', () => {
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
      pack: SYNTHWAVE_SOUND_PACK,
    });
    return { ctx, scheduler, mapper, clock };
  }

  it('has saw plucks with detune, gated reverb on major cues, and an arpeggio bed', () => {
    expect(SYNTHWAVE_SOUND_PACK.ambient).toBeNull();
    expect(SYNTHWAVE_SOUND_PACK.arpeggio).toEqual(SYNTH_ARPEGGIO);
    expect(SYNTHWAVE_SOUND_PACK.ui['tool-select']?.params?.waveform).toBe('sawtooth');
    expect(SYNTHWAVE_SOUND_PACK.ui['tool-select']?.params?.detune).toBe(12);
    expect(SYNTHWAVE_SOUND_PACK.ui['panel-open']?.params?.reverb).toBe(true);
    expect(SYNTHWAVE_SOUND_PACK.ui.confirm?.params?.reverb).toBe(true);
    for (const cue of SYNTH_UI_CUES) {
      expect(SYNTHWAVE_SOUND_PACK.ui[cue], cue).toBeDefined();
    }
  });

  it('starts the arpeggio bed instead of a looping ambient', () => {
    const { mapper } = harness();
    expect(mapper.arpeggioActive).toBe(true);
    expect(mapper.ambientActive).toBe(true);
    mapper.dispose();
  });

  it('spawnVoice honours sawtooth + detune for Synthwave plucks', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const voice = spawnVoice({
      context: ctx,
      destination: dest,
      kind: 'pluck',
      id: 1,
      when: 0,
      params: { waveform: 'sawtooth', detune: 12, pitch: 440 },
    });
    const source = voice.graph.source as FakeOscillator;
    expect(source.type).toBe('sawtooth');
    expect(source.detune.value).toBe(12);
    voice.stop();
  });
});

describe('Synthwave arpeggio tempo tracks TPS smoothly', () => {
  it('interval scales with TPS and setTps never restarts the next-note clock', () => {
    expect(arpeggioIntervalSec(60, 4)).toBeCloseTo(0.25, 6);
    expect(arpeggioIntervalSec(120, 4)).toBeCloseTo(0.125, 6);
    expect(arpeggioIntervalSec(30, 4)).toBeCloseTo(0.5, 6);

    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    const policy = new AudioPolicy({
      storage: new MemoryStorage(),
      reducedMotion: () => false,
      prefs: { muted: false },
    });
    const clock = new ManualClock();
    const scheduler = new Scheduler({ context: ctx, mixer, policy, clock });
    const bed = new ArpeggioBed({
      context: ctx,
      scheduler,
      policy,
      spec: SYNTH_ARPEGGIO,
      horizonSec: 1.2,
    });
    bed.pump();
    const firstNext = bed.scheduledAt[0]!;
    const beforeInterval = bed.currentIntervalSec;
    const beforeCount = bed.scheduledAt.length;
    expect(beforeCount).toBeGreaterThan(2);

    bed.setTps(120);
    expect(bed.currentIntervalSec).toBeLessThan(beforeInterval);
    expect(bed.currentIntervalSec).toBeCloseTo(arpeggioIntervalSec(120, 4), 6);
    // Already-armed first note time is unchanged — no discontinuity / restart.
    expect(bed.scheduledAt[0]).toBe(firstNext);
    expect(bed.scheduledAt.length).toBe(beforeCount);

    // Advance past the pre-armed horizon so the next pump uses the new interval.
    ctx.currentTime = bed.scheduledAt[beforeCount - 1]! + 0.001;
    bed.pump();
    const newNotes = bed.scheduledAt.slice(beforeCount);
    expect(newNotes.length).toBeGreaterThan(1);
    for (let i = 1; i < newNotes.length; i++) {
      expect(newNotes[i]! - newNotes[i - 1]!).toBeCloseTo(bed.currentIntervalSec, 5);
    }
    bed.dispose();
  });

  it('EventMapper.setTps forwards to the arpeggio bed', () => {
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
      pack: SYNTHWAVE_SOUND_PACK,
    });
    const bed = mapper.arpeggioBed!;
    const before = bed.currentIntervalSec;
    mapper.setTps(180);
    expect(bed.currentIntervalSec).toBeLessThan(before);
    expect(bed.currentTps).toBe(180);
    mapper.dispose();
  });
});

describe('Synthwave horizon grid vanishing point', () => {
  it('tracks camera pan and stays soft enough not to fight the sim', () => {
    const w = 200;
    const cell = 8;
    const home = vanishingPointX(0, w, cell);
    const right = vanishingPointX(40, w, cell);
    const left = vanishingPointX(-40, w, cell);
    expect(home).toBe(w * 0.5);
    expect(right).toBeGreaterThan(home);
    expect(left).toBeLessThan(home);
    // Soft clamp — extreme pan does not yank VP off into nonsense.
    const extreme = vanishingPointX(10_000, w, cell);
    expect(extreme).toBeLessThanOrEqual(w * 0.5 + w * 0.35 + 1e-9);
    expect(SYNTH_SUN_Y).toBe(0.55);

    const a = createGridGlowPass({ horizonY: SYNTH_SUN_Y, maxAlpha: 0.26 });
    const b = createGridGlowPass({ horizonY: SYNTH_SUN_Y, maxAlpha: 0.26 });
    const ta = createSoftwareCanvas(48, 32);
    const tb = createSoftwareCanvas(48, 32);
    const vpHome: Viewport = { ...VIEWPORT, originX: 0 };
    const vpAway: Viewport = { ...VIEWPORT, originX: 30 };
    const makeCtx = (target: ReturnType<typeof createSoftwareCanvas>, vp: Viewport): EffectCtx => ({
      target: target.getContext('2d') as unknown as CanvasRenderingContext2D,
      source: target as unknown as CanvasImageSource,
      viewport: vp,
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: true,
    });
    a.render(makeCtx(ta, vpHome));
    b.render(makeCtx(tb, vpAway));
    expect(hashPixels(asSoftware(ta)!.pixels)).not.toBe(hashPixels(asSoftware(tb)!.pixels));
    // Pan away and back restores the identical field.
    const tc = createSoftwareCanvas(48, 32);
    b.render(makeCtx(tc, vpHome));
    expect(hashPixels(asSoftware(tc)!.pixels)).toBe(hashPixels(asSoftware(ta)!.pixels));
    a.dispose();
    b.dispose();
  });
});

describe('Synthwave compositor at quality 0', () => {
  const theme = compileTheme(SYNTHWAVE_THEME);

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
    compositor.setEffectPasses(createSynthwavePassStack());
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

describe('Synthwave pass stack', () => {
  it('createSynthwavePassStack matches the quality-3 pass list', () => {
    const stack = createSynthwavePassStack();
    expect(stack.map((p) => p.id)).toEqual([
      'sunGradient',
      'gridGlow',
      'hueShiftByAge',
      'bloom',
      'chromaticAberration',
      'scanlines',
    ]);
    for (const p of stack) p.dispose();
  });
});
