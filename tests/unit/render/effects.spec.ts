import { describe, expect, it } from 'vitest';
import { Compositor } from '@render/compositor';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import { createNoOpPass, type EffectPass, type EffectStage } from '@render/effects/pass';
import { EffectRegistry } from '@render/effects/registry';
import type { CanvasLike } from '@render/layers';
import type { CompiledTheme, Viewport } from '@render/types';

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

const THEME: CompiledTheme = {
  id: 'fx-test',
  background: '#000000',
  palette: () => '#ffffff',
};

const VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: 8,
  widthPx: 64,
  heightPx: 64,
  dpr: 1,
};

/** Minimal GridView so Compositor.draw can reach the effect stages. */
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

/**
 * A pass that allocates one offscreen canvas and one WebAudio-shaped node, tracking live
 * counts for the P3-A-3 leak test. `dispose` must drop both.
 */
function createLeakyPass(
  id: string,
  stage: EffectStage,
  live: { canvases: number; audioNodes: number },
): EffectPass {
  let canvas: { width: number; height: number; released: boolean } | null = {
    width: 8,
    height: 8,
    released: false,
  };
  live.canvases += 1;

  let audioNode: { disconnect: () => void; released: boolean } | null = {
    released: false,
    disconnect(): void {
      if (!this.released) {
        this.released = true;
        live.audioNodes -= 1;
      }
    },
  };
  live.audioNodes += 1;

  return {
    id,
    cost: 0.05,
    stage,
    render(): void {},
    resize(w: number, h: number): void {
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    dispose(): void {
      if (canvas && !canvas.released) {
        canvas.released = true;
        live.canvases -= 1;
        canvas = null;
      }
      audioNode?.disconnect();
      audioNode = null;
    },
  };
}

describe('EffectRegistry', () => {
  it('hot-swaps passes and disposes the previous set', () => {
    const live = { canvases: 0, audioNodes: 0 };
    const registry = new EffectRegistry();
    registry.setPasses([createLeakyPass('a', 'effects', live)]);
    expect(live.canvases).toBe(1);
    expect(registry.list()).toHaveLength(1);

    registry.setPasses([createLeakyPass('b', 'post', live), createNoOpPass('c', 'background')]);
    expect(registry.swapCount).toBe(2);
    expect(live.canvases).toBe(1); // old disposed, new allocated
    expect(live.audioNodes).toBe(1);
    expect(registry.list().map((p) => p.id)).toEqual(['b', 'c']);
    expect(registry.listStage('post')[0]!.id).toBe('b');

    registry.dispose();
    expect(live.canvases).toBe(0);
    expect(live.audioNodes).toBe(0);
  });

  it('skips all passes at quality 0', () => {
    let renders = 0;
    const registry = new EffectRegistry({ quality: 0 });
    registry.setPasses([
      {
        id: 'skip-me',
        cost: 1,
        stage: 'effects',
        render(): void {
          renders += 1;
        },
        dispose(): void {},
      },
    ]);
    registry.renderStage('effects', {
      target: fakeCanvas(1, 1).getContext('2d') as CanvasRenderingContext2D,
      source: fakeCanvas(1, 1),
      viewport: VIEWPORT,
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
    });
    expect(renders).toBe(0);
  });
});

describe('EffectPass framework (P3-A-3)', () => {
  async function setUp() {
    const factory = (w: number, h: number) => fakeCanvas(w, h);
    const display = fakeCanvas(64, 64);
    const compositor = new Compositor({ canvasFactory: factory });
    await compositor.init(display);
    compositor.resize(64, 64, 1);
    compositor.setTheme(THEME);
    compositor.setViewport(VIEWPORT);
    return compositor;
  }

  it('a no-op pass adds less than 0.1 ms over an empty registry', async () => {
    const compositor = await setUp();
    const frame = emptyFrame(0);
    // Warm both paths.
    compositor.setEffectPasses([]);
    for (let i = 0; i < 20; i++) compositor.draw(frame);
    compositor.setEffectPasses([createNoOpPass()]);
    for (let i = 0; i < 20; i++) compositor.draw(frame);

    const ITER = 200;
    compositor.setEffectPasses([]);
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) compositor.draw(frame);
    const emptyMs = (performance.now() - t0) / ITER;

    compositor.setEffectPasses([createNoOpPass('noop', 'effects'), createNoOpPass('noop-post', 'post')]);
    const t1 = performance.now();
    for (let i = 0; i < ITER; i++) compositor.draw(frame);
    const withNoOpMs = (performance.now() - t1) / ITER;

    expect(withNoOpMs - emptyMs).toBeLessThan(0.1);
    compositor.dispose();
  });

  it('hot-swaps passes on theme change with no layer canvas reallocation', async () => {
    const compositor = await setUp();
    const before = compositor.layerAllocationCount;
    expect(before).toBe(4);

    const live = { canvases: 0, audioNodes: 0 };
    compositor.setEffectPasses([createLeakyPass('theme-a', 'effects', live)]);
    compositor.draw(emptyFrame(1));
    expect(compositor.layerAllocationCount).toBe(before);

    // Simulate a theme switch: new pass list, same layer stack.
    compositor.setTheme({ ...THEME, id: 'fx-test-b', background: '#111111' });
    compositor.setEffectPasses([
      createLeakyPass('theme-b-fx', 'effects', live),
      createLeakyPass('theme-b-post', 'post', live),
    ]);
    expect(compositor.effectRegistry.swapCount).toBe(2);
    expect(compositor.layerAllocationCount).toBe(before);
    expect(compositor.isBackgroundDirty()).toBe(true); // no flicker of stale L0

    compositor.draw(emptyFrame(2));
    expect(compositor.layerAllocationCount).toBe(before);
    expect(live.canvases).toBe(2);
    expect(live.audioNodes).toBe(2);

    compositor.dispose();
    expect(live.canvases).toBe(0);
    expect(live.audioNodes).toBe(0);
  });

  it('dispose releases every offscreen canvas and WebAudio node across 100 theme switches', async () => {
    const compositor = await setUp();
    const live = { canvases: 0, audioNodes: 0 };
    const stages: EffectStage[] = ['background', 'effects', 'post'];

    for (let i = 0; i < 100; i++) {
      const passes = stages.map((stage) => createLeakyPass(`t${i}-${stage}`, stage, live));
      compositor.setEffectPasses(passes);
      compositor.setTheme({ ...THEME, id: `theme-${i}` });
      compositor.draw(emptyFrame(i));
      // At most one set of three passes should be live at a time.
      expect(live.canvases).toBe(3);
      expect(live.audioNodes).toBe(3);
    }

    expect(compositor.layerAllocationCount).toBe(4);
    compositor.dispose();
    expect(live.canvases).toBe(0);
    expect(live.audioNodes).toBe(0);
  });
});
