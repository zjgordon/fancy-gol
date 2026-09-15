/**
 * P3-C-1 — Default upgrade: quality ladder, overlay contrast, declared-cost ranking,
 * lossless quality 0, UI-only sound pack.
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
import { EffectRegistry } from '@render/effects/registry';
import {
  THEME_IDS,
  createThemePassStack,
  declaredCostAtQuality,
} from '@render/effects/library';
import type { CanvasLike } from '@render/layers';
import { QualityGovernor } from '@render/quality-governor';
import { compileTheme } from '@themes/registry';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@themes/default/theme';
import { overlayPalette } from '@themes/default/overlay';
import { DEFAULT_QUALITY_LEVELS } from '@themes/default/quality';
import { DEFAULT_SOUND_PACK, DEFAULT_UI_CUES } from '@themes/default/sound';
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from '@themes/default/tokens';
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

describe('Default README (written before the upgrade)', () => {
  it('states what the theme is about in one paragraph', () => {
    const text = readFileSync(join(process.cwd(), 'src/themes/default/README.md'), 'utf8');
    expect(text).toMatch(/performance reference/i);
    expect(text).toMatch(/quality 0/i);
    expect(text.split('\n').filter((l) => l.trim().length > 40).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Default quality ladder', () => {
  it('defines levels 0–3, all with an empty pass list', () => {
    expect(Object.keys(DEFAULT_QUALITY_LEVELS).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    for (const level of [0, 1, 2, 3] as const) {
      expect(DEFAULT_QUALITY_LEVELS[level].passes).toEqual([]);
    }
    expect(createThemePassStack('default')).toEqual([]);
  });

  it('is the cheapest theme at every quality (declared cost)', () => {
    for (const quality of [0, 1, 2, 3] as const) {
      const ours = declaredCostAtQuality('default', quality);
      expect(ours).toBe(0);
      for (const id of THEME_IDS) {
        expect(ours).toBeLessThanOrEqual(declaredCostAtQuality(id, quality));
      }
    }
  });

  it('quality 0 is visually lossless: empty stack so dropping stages changes nothing', () => {
    expect(DEFAULT_DARK_THEME.quality?.losslessAtQuality0).toBe(true);
    expect(DEFAULT_LIGHT_THEME.quality?.losslessAtQuality0).toBe(true);
  });
});

describe('Default L4 overlay contrast against the canvas', () => {
  it.each([
    ['dark', DEFAULT_DARK_TOKENS],
    ['light', DEFAULT_LIGHT_TOKENS],
  ] as const)('%s selection and origin clear 4.5:1 on bg; decade clears 3:1', (_name, tokens) => {
    const bg = resolveOpaqueColor(tokens.color.bg, BLACK);
    const overlay = overlayPalette(tokens);
    expect(contrastRatio(overlay.selection, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.origin, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(overlay.gridDecade, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('Default sound pack through EventMapper', () => {
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
      pack: DEFAULT_SOUND_PACK,
    });
    return { ctx, scheduler, mapper };
  }

  it('has a click (or blip) for every UI cue and no ambient / sim', () => {
    expect(DEFAULT_SOUND_PACK.ambient).toBeNull();
    expect(DEFAULT_SOUND_PACK.sim).toBeUndefined();
    for (const cue of DEFAULT_UI_CUES) {
      const mapping = DEFAULT_SOUND_PACK.ui[cue];
      expect(mapping, cue).toBeDefined();
      expect(['click', 'blip']).toContain(mapping!.kind);
    }
  });

  it('plays UI clicks and never emits a sim voice, even at 10k births/sec', () => {
    const { scheduler, mapper } = harness();
    mapper.noteUi('tool-select');
    scheduler.tick();
    expect(scheduler.startedAt.length).toBe(1);

    mapper.noteGeneration({
      births: 10_000,
      centroidX: 50,
      centroidY: 50,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.flush(50);
    scheduler.tick();
    expect(mapper.simVoiceTimesMs).toHaveLength(0);
    expect(mapper.textureActive).toBe(false);
  });

  it('setPack to Default silences sim after a mapper started without a pack', () => {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    const policy = new AudioPolicy({
      storage: new MemoryStorage(),
      reducedMotion: () => false,
      prefs: { muted: false },
    });
    const clock = new ManualClock();
    const scheduler = new Scheduler({ context: ctx, mixer, policy, clock });
    const mapper = new EventMapper({ context: ctx, mixer, scheduler, policy, clock });
    mapper.setPack(DEFAULT_SOUND_PACK);
    mapper.noteGeneration({
      births: 8,
      centroidX: 10,
      centroidY: 10,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.flush(50);
    scheduler.tick();
    expect(mapper.simVoiceTimesMs).toHaveLength(0);
    mapper.dispose();
  });
});

describe('Default compositor at quality 0 vs 3', () => {
  const VIEWPORT = {
    originX: 0,
    originY: 0,
    cellSize: 8,
    widthPx: 64,
    heightPx: 64,
    dpr: 1,
  };
  const theme = compileTheme(DEFAULT_DARK_THEME);

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
    compositor.setViewport(VIEWPORT);
    compositor.setEffectPasses(createThemePassStack('default'));
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

  it('quality 0 and quality 3 issue the same composite calls (no visible loss)', async () => {
    async function drawAt(quality: 0 | 3): Promise<number> {
      const registry = new EffectRegistry();
      const gov = new QualityGovernor({ registry, initialQuality: quality });
      const compositor = new Compositor({
        canvasFactory: (w, h) => fakeCanvas(w, h),
        effects: registry,
        qualityGovernor: gov,
      });
      await compositor.init(fakeCanvas(64, 64));
      compositor.resize(64, 64, 1);
      compositor.setTheme(theme);
      compositor.setViewport(VIEWPORT);
      compositor.setEffectPasses(createThemePassStack('default'));
      compositor.draw(emptyFrame(1));
      const calls = compositor.readStats().drawCalls;
      compositor.dispose();
      return calls;
    }
    expect(await drawAt(0)).toBe(await drawAt(3));
  });
});
