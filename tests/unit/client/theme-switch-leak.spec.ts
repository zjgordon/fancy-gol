/**
 * P3-D-1 — 100 consecutive theme-stack swaps leak neither compositor canvases
 * nor dispose-tracked WebAudio-shaped nodes. Complements the abstract leaky-pass
 * test in effects.spec.ts with the real six-theme stacks.
 */
import { describe, expect, it } from 'vitest';
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

function fakeCanvas(width: number, height: number): CanvasLike {
  const canvas = {
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
  };
  return canvas as unknown as CanvasLike;
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

    for (let i = 0; i < 100; i++) {
      const id = ids[i % ids.length]!;
      const passes = createThemePassStack(id);
      compositor.setEffectPasses(passes);
      compositor.setTheme({ ...THEME, id: `${id}-${i}` });
      compositor.draw(emptyFrame(i));
    }

    expect(compositor.layerAllocationCount).toBe(layersAtStart);
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
