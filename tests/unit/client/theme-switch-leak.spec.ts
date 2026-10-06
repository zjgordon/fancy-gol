/**
 * P3-D-1 — 100 consecutive theme-stack swaps leak neither compositor canvases
 * nor dispose-tracked WebAudio-shaped nodes. Complements the abstract leaky-pass
 * test in effects.spec.ts with the real six-theme stacks.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Compositor } from '@render/compositor';
import {
  THEME_IDS,
  createThemePassStack,
} from '@render/effects/library';
import type { CanvasLike } from '@render/layers';
import type { CompiledTheme, Viewport } from '@render/types';
import { ThemeRegistry } from '@themes/registry';
import { DEFAULT_THEME } from '@themes/default/theme';
import { CHIBA_CITY_THEME } from '@themes/chiba-city/theme';
import { FLATLINE_THEME } from '@themes/flatline/theme';
import { SIDS_PLACE_THEME } from '@themes/sids-place/theme';
import { VOID_WALKER_THEME } from '@themes/void-walker/theme';
import { SYNTHWAVE_THEME } from '@themes/synthwave/theme';
import { RecordingCanvas, stubOffscreenCanvas } from '../render/recording-canvas';

// Composited passes (ADR-012) bake canvases at activation; jsdom/node have no OffscreenCanvas.
beforeAll(stubOffscreenCanvas);
afterAll(() => vi.unstubAllGlobals());

function fakeCanvas(width: number, height: number): CanvasLike {
  return new RecordingCanvas(width, height) as unknown as CanvasLike;
}

const VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: 8,
  widthPx: 64,
  heightPx: 64,
  dpr: 1,
};

const THEME: CompiledTheme = {
  id: 'switch-test',
  background: '#000000',
  palette: () => '#ffffff',
};

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

describe('100 theme switches leak no resources', () => {
  it('real theme pass stacks dispose cleanly across 100 swaps', async () => {
    const compositor = new Compositor({
      canvasFactory: (w, h) => fakeCanvas(w, h),
    });
    await compositor.init(fakeCanvas(64, 64));
    compositor.resize(64, 64, 1);
    compositor.setViewport(VIEWPORT);
    compositor.setTheme(THEME);
    compositor.setEffectsEnabled(true);

    const layersAtStart = compositor.layerAllocationCount;
    const ids = THEME_IDS;
    // Composited passes bake offscreen canvases (noise tiles, scanline pattern, bloom mips). Count
    // the ones still holding a backing store: it must stay bounded by one stack's worth, and a
    // swap that forgot to release the old stack's bakes would grow it every time.
    const baked = stubOffscreenCanvas();
    let peakLive = 0;

    for (let i = 0; i < 100; i++) {
      const id = ids[i % ids.length]!;
      const passes = createThemePassStack(id);
      compositor.setEffectPasses(passes);
      compositor.setTheme({ ...THEME, id: `${id}-${i}` });
      compositor.draw(emptyFrame(i));
      peakLive = Math.max(peakLive, baked.live());
    }

    expect(compositor.layerAllocationCount).toBe(layersAtStart);
    expect(peakLive).toBeLessThanOrEqual(24); // the heaviest stack bakes 8 grain tiles + mips + bands
    compositor.setEffectPasses([]);
    expect(baked.live()).toBe(0);
    compositor.dispose();
  });

  it('ThemeRegistry activate 100 times keeps a flat listener set and persists the last id', () => {
    const storage = {
      data: new Map<string, string>(),
      getItem(key: string) {
        return this.data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.data.set(key, value);
      },
    };
    const root = { props: new Map<string, string>(), setProperty(n: string, v: string) {
      this.props.set(n, v);
    } };
    const registry = new ThemeRegistry({
      root,
      storage,
      prefersDark: () => true,
      subscribeToSchemeChange: () => () => {},
    });
    registry.register(DEFAULT_THEME);
    registry.register(CHIBA_CITY_THEME);
    registry.register(FLATLINE_THEME);
    registry.register(SIDS_PLACE_THEME);
    registry.register(VOID_WALKER_THEME);
    registry.register(SYNTHWAVE_THEME);

    const ids = registry.list().map((t) => t.id);
    let notifications = 0;
    const unsub = registry.subscribe(() => {
      notifications += 1;
    });

    for (let i = 0; i < 100; i++) {
      registry.activate(ids[i % ids.length]!);
    }

    expect(notifications).toBe(100);
    expect(storage.data.get('gol.theme')).toBe(ids[(100 - 1) % ids.length]);
    expect(root.props.size).toBeGreaterThan(10);
    // resolve does not notify or persist
    const before = notifications;
    const peeked = registry.resolve('chiba-city');
    expect(peeked.id).toBe('chiba-city');
    expect(notifications).toBe(before);
    unsub();
    registry.dispose();
  });
});
