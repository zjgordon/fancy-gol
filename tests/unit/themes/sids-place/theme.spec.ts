/**
 * P3-C-4 — Sids-Place: parchment bake, overlay, sound, tile irregularity, quality 0.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventMapper } from '@audio/events';
import { Mixer } from '@audio/mixer';
import { AudioPolicy } from '@audio/policy';
import { Scheduler } from '@audio/scheduler';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { Compositor } from '@render/compositor';
import {
  SIDS_PARCHMENT_BUDGET_MS,
  createParchmentTexturePass,
  createSidsPlacePassStack,
  createThemePassStack,
  declaredCostAtQuality,
} from '@render/effects/library';
import { asSoftware, createSoftwareCanvas } from '@render/effects/software-surface';
import { hashPixels } from '@render/effects/pixel-hash';
import { EffectRegistry } from '@render/effects/registry';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import type { CanvasLike } from '@render/layers';
import { QualityGovernor } from '@render/quality-governor';
import type { Viewport } from '@render/types';
import { compileTheme, ThemeRegistry } from '@themes/registry';
import { overlayPalette } from '@themes/sids-place/overlay';
import { SIDS_QUALITY, SIDS_QUALITY_LEVELS } from '@themes/sids-place/quality';
import { SIDS_SOUND_PACK, SIDS_UI_CUES } from '@themes/sids-place/sound';
import { SIDS_PLACE_THEME } from '@themes/sids-place/theme';
import { sidsTileShape } from '@themes/sids-place/tiles';
import { SIDS_PLACE_TOKENS } from '@themes/sids-place/tokens';
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

describe('Sids-Place README (written before implementation)', () => {
  it('states what the theme is about and names Highlands/Liquid', () => {
    const text = readFileSync(join(process.cwd(), 'src/themes/sids-place/README.md'), 'utf8');
    expect(text).toMatch(/parchment|manuscript|ink/i);
    expect(text).toMatch(/Highlands\/Liquid/);
    expect(text.split('\n').filter((l) => l.trim().length > 40).length).toBeGreaterThanOrEqual(1);
  });

  it('ships zero image assets', () => {
    const dir = join(process.cwd(), 'src/themes/sids-place');
    const files = ['theme.ts', 'tokens.ts', 'overlay.ts', 'sids-place.css', 'README.md'];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/\.(png|jpg|jpeg|webp|gif|svg)\b/i);
      expect(src).not.toMatch(/url\(/);
    }
  });
});

describe('Sids-Place theme module', () => {
  it('is a plain medium-cost atmosphere theme with transparent dead cells', () => {
    expect(SIDS_PLACE_THEME.id).toBe('sids-place');
    expect(SIDS_PLACE_THEME.cost).toBe('medium');
    expect(SIDS_PLACE_THEME.sound).toBe(SIDS_SOUND_PACK);
    expect(SIDS_PLACE_THEME.quality).toEqual(SIDS_QUALITY);
    expect(SIDS_PLACE_THEME.quality?.losslessAtQuality0).toBe(false);
    expect(SIDS_PLACE_THEME.cellLayerBackground).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
    expect(SIDS_PLACE_THEME.tileShape).toBe(sidsTileShape);
  });

  it('motion is weightier and slower than Default, with a settle', () => {
    const def = defaultMotionSignature();
    expect(SIDS_PLACE_THEME.motion.durationMs.fast).toBeGreaterThan(def.durationMs.fast);
    expect(SIDS_PLACE_THEME.motion.durationMs.slow).toBeGreaterThan(def.durationMs.slow);
    expect(SIDS_PLACE_THEME.motion.enter.keyframes.length).toBeGreaterThan(def.enter.keyframes.length);
    const mid = SIDS_PLACE_THEME.motion.enter.keyframes[1];
    expect(mid?.transform).toMatch(/-3px/);
  });

  it('registers and activates through ThemeRegistry', () => {
    const calls: Array<[string, string]> = [];
    const r = new ThemeRegistry({
      root: { setProperty: (n, v) => calls.push([n, v]) },
      storage: null,
    });
    r.register(SIDS_PLACE_THEME);
    const resolved = r.activate('sids-place');
    expect(resolved.id).toBe('sids-place');
    expect(Object.fromEntries(calls)['--gol-color-accent']).toBe(SIDS_PLACE_TOKENS.color.accent);
    expect(r.getCompiledTheme()?.background).toBe('rgba(0, 0, 0, 0)');
    expect(r.getCompiledTheme()?.tileShape).toBe(sidsTileShape);
  });
});

describe('Sids-Place quality ladder', () => {
  it('defines levels 0–3; quality 0 is empty, quality ≥ 1 is parchment', () => {
    expect(Object.keys(SIDS_QUALITY_LEVELS).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(SIDS_QUALITY_LEVELS[0].passes).toEqual([]);
    expect(SIDS_QUALITY_LEVELS[3].passes).toEqual(['parchmentTexture']);
    const stack = createThemePassStack('sids-place');
    expect(stack.map((p) => p.id)).toEqual(['parchmentTexture']);
    for (const p of stack) p.dispose();
  });

  it('is strictly more expensive than Default at quality ≥ 1', () => {
    expect(declaredCostAtQuality('sids-place', 0)).toBe(0);
    expect(declaredCostAtQuality('sids-place', 1)).toBeGreaterThan(declaredCostAtQuality('default', 1));
  });
});

describe('Sids-Place L4 overlay contrast', () => {
  it('selection and origin clear 4.5:1 on parchment and on a busy fibre texel', () => {
    const bg = resolveOpaqueColor(SIDS_PLACE_TOKENS.color.bg, BLACK);
    const overlay = overlayPalette(SIDS_PLACE_TOKENS);
    expect(contrastRatio(overlay.selection, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.origin, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.gridDecade, bg)).toBeGreaterThanOrEqual(3);
    const fibre = resolveOpaqueColor('rgba(90, 48, 18, 0.22)', bg);
    expect(contrastRatio(overlay.selection, fibre)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Sids-Place sound pack', () => {
  it('has paper rustle, a wooden tool clunk, and a woodwind bed', () => {
    expect(SIDS_SOUND_PACK.ambient?.kind).toBe('pad');
    expect(SIDS_SOUND_PACK.ui['tool-select']?.kind).toBe('click');
    expect(SIDS_SOUND_PACK.ui['panel-open']?.kind).toBe('noiseBurst');
    expect(SIDS_SOUND_PACK.sim?.birth?.kind).toBe('pluck');
    for (const cue of SIDS_UI_CUES) {
      expect(SIDS_SOUND_PACK.ui[cue], cue).toBeDefined();
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
      pack: SIDS_SOUND_PACK,
    });
    expect(mapper.ambientActive).toBe(true);
    mapper.dispose();
  });
});

describe('Sids-Place parchment texture', () => {
  it('is seeded, deterministic, and generated once under 40 ms at 256²', () => {
    const a = createParchmentTexturePass({ seed: 7, width: 256, height: 256 });
    const b = createParchmentTexturePass({ seed: 7, width: 256, height: 256 });
    a.generate();
    b.generate();
    expect(a.generated).toBe(true);
    expect(a.generationMs).toBeLessThan(SIDS_PARCHMENT_BUDGET_MS);
    const ms = a.generationMs;
    a.generate();
    expect(a.generationMs).toBe(ms);

    const va = createSoftwareCanvas(48, 32);
    const vb = createSoftwareCanvas(48, 32);
    const vp = { ...VIEWPORT };
    a.render({
      target: va.getContext('2d') as unknown as CanvasRenderingContext2D,
      source: va as unknown as CanvasImageSource,
      viewport: vp,
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    });
    b.render({
      target: vb.getContext('2d') as unknown as CanvasRenderingContext2D,
      source: vb as unknown as CanvasImageSource,
      viewport: vp,
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    });
    expect(hashPixels(asSoftware(va)!.pixels)).toBe(hashPixels(asSoftware(vb)!.pixels));

    const other = createParchmentTexturePass({ seed: 99, width: 256, height: 256 });
    other.generate();
    const vo = createSoftwareCanvas(48, 32);
    other.render({
      target: vo.getContext('2d') as unknown as CanvasRenderingContext2D,
      source: vo as unknown as CanvasImageSource,
      viewport: vp,
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
    });
    expect(hashPixels(asSoftware(vo)!.pixels)).not.toBe(hashPixels(asSoftware(va)!.pixels));
    a.dispose();
    b.dispose();
    other.dispose();
  });

  it('createSidsPlacePassStack bakes parchment at construction', () => {
    const stack = createSidsPlacePassStack();
    expect(stack.map((p) => p.id)).toEqual(['parchmentTexture']);
    const baked = stack[0] as ReturnType<typeof createParchmentTexturePass>;
    expect(baked.generated).toBe(true);
    expect(baked.generationMs).toBeLessThan(SIDS_PARCHMENT_BUDGET_MS);
    for (const p of stack) p.dispose();
  });
});

describe('Sids-Place cell irregularity is world-locked', () => {
  it('the same world cell always wobbles the same way', () => {
    const a = sidsTileShape(12, -4);
    const b = sidsTileShape(12, -4);
    expect(a).toEqual(b);
    expect(sidsTileShape(13, -4)).not.toEqual(a);
    expect(a.inset).toBeGreaterThanOrEqual(0);
    expect(a.inset).toBeLessThan(0.2);
  });
});

describe('Sids-Place compositor at quality 0', () => {
  const theme = compileTheme(SIDS_PLACE_THEME);

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
    compositor.setEffectPasses(createSidsPlacePassStack());
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
