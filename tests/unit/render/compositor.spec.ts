import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { Canvas2DRenderer } from '@render/canvas2d';
import { Compositor } from '@render/compositor';
import type { EffectPass } from '@render/effects/pass';
import { QualityGovernor } from '@render/quality-governor';
import { CanvasRecorder } from '@render/recorder';
import type { CanvasLike } from '@render/layers';
import type { CompiledTheme, Viewport } from '@render/types';
import type { Rect } from '@shared/types';

/**
 * Headless surface for compositor tests: records draw calls the way CanvasRecorder does for
 * the cell path, plus the clearRect / setTransform / drawImage the composite pass needs.
 */
class LayerContext {
  readonly calls: string[] = [];
  drawImageCalls = 0;
  clearRectCalls = 0;
  fillRectCalls = 0;
  bufferAllocations = 0;
  private _fillStyle = '#000000';
  private readonly recorder: CanvasRecorder | null;

  constructor(
    readonly width: number,
    readonly height: number,
    recordPixels: boolean,
  ) {
    this.recorder = recordPixels ? new CanvasRecorder(width, height) : null;
  }

  set fillStyle(value: string) {
    this._fillStyle = value;
    if (this.recorder) this.recorder.fillStyle = value;
  }

  get fillStyle(): string {
    return this._fillStyle;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRectCalls += 1;
    this.calls.push('fillRect');
    this.recorder?.fillRect(x, y, w, h);
  }

  clearRect(): void {
    this.clearRectCalls += 1;
    this.calls.push('clearRect');
  }

  setTransform(): void {
    this.calls.push('setTransform');
  }

  drawImage(): void {
    this.drawImageCalls += 1;
    this.calls.push('drawImage');
  }

  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    this.bufferAllocations += 1;
    if (this.recorder) return this.recorder.createImageData(w, h);
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4) };
  }

  putImageData(image: { width: number; height: number; data: Uint8ClampedArray }, dx: number, dy: number): void {
    this.calls.push('putImageData');
    this.recorder?.putImageData(image, dx, dy);
  }

  resetLog(): void {
    this.calls.length = 0;
    this.drawImageCalls = 0;
    this.clearRectCalls = 0;
    this.fillRectCalls = 0;
    this.bufferAllocations = 0;
    this.recorder?.resetLog();
  }

  get recordedCalls() {
    return this.recorder?.calls ?? [];
  }
}

interface Surface {
  canvas: CanvasLike;
  ctx: LayerContext;
}

function makeSurface(width: number, height: number, recordPixels: boolean): Surface {
  const ctx = new LayerContext(width, height, recordPixels);
  const canvas = {
    width,
    height,
    style: {} as { width?: string; height?: string },
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  };
  return { canvas: canvas as unknown as CanvasLike, ctx };
}

const THEME: CompiledTheme = {
  id: 'compositor-test',
  background: '#101010',
  palette: (state) => (state === 1 ? '#ff0000' : '#00ff00'),
};

const VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: 8,
  widthPx: 64,
  heightPx: 64,
  dpr: 1,
};

async function setUpCompositor(opts?: {
  recordCells?: boolean;
}): Promise<{
  compositor: Compositor;
  displayCtx: LayerContext;
  cellCtx: LayerContext;
  bgCtx: LayerContext;
}> {
  const surfaces: Surface[] = [];
  const factory = (w: number, h: number) => {
    // First four creations are L0–L3; cells is index 1.
    const record = opts?.recordCells === true && surfaces.length === 1;
    const surface = makeSurface(w, h, record);
    surfaces.push(surface);
    return surface.canvas;
  };

  const display = makeSurface(64, 64, false);
  const compositor = new Compositor({ canvasFactory: factory });
  compositor.setEffectsEnabled(false);
  await compositor.init(display.canvas);
  compositor.resize(64, 64, 1);
  compositor.setTheme(THEME);
  compositor.setViewport(VIEWPORT);

  // Layer order in COMPOSITOR_LAYER_IDS: background, cells, effects, post
  return {
    compositor,
    displayCtx: display.ctx,
    bgCtx: surfaces[0]!.ctx,
    cellCtx: surfaces[1]!.ctx,
  };
}

function blinkerWorld(): Simulation {
  const sim = new Simulation({
    ruleset: CONWAY,
    width: 32,
    height: 32,
    seed: 1,
  });
  sim.paint([
    { x: 5, y: 5, state: 1 },
    { x: 6, y: 5, state: 1 },
    { x: 7, y: 5, state: 1 },
  ]);
  return sim;
}

describe('Compositor', () => {
  it('keeps cell-layer dirty-rect draw-call counts identical to a bare Canvas2DRenderer', async () => {
    const dirty: Rect[] = [{ x: 0, y: 0, width: 32, height: 32 }];
    const sim = blinkerWorld();
    const frame = { cells: sim.view(), dirty, tick: sim.tick };

    const directRecorder = new CanvasRecorder(64, 64);
    const directCanvas = {
      width: 0,
      height: 0,
      style: {} as { width?: string; height?: string },
      getContext: (kind: string) => (kind === '2d' ? directRecorder : null),
    } as unknown as HTMLCanvasElement;
    const direct = new Canvas2DRenderer();
    await direct.init(directCanvas);
    direct.resize(64, 64, 1);
    direct.setTheme(THEME);
    direct.setViewport(VIEWPORT);
    direct.draw(frame);
    const directCalls = direct.readStats().drawCalls;
    const directFillRects = directRecorder.calls.filter((c) => c.method === 'fillRect').length;

    const { compositor, cellCtx } = await setUpCompositor({ recordCells: true });
    cellCtx.resetLog();
    compositor.draw(frame);

    expect(compositor.readCellStats().drawCalls).toBe(directCalls);
    expect(cellCtx.recordedCalls.filter((c) => c.method === 'fillRect').length).toBe(directFillRects);
  });

  it('reallocates offscreen canvases only on init, never per frame', async () => {
    const { compositor } = await setUpCompositor();
    const afterInit = compositor.layerAllocationCount;
    expect(afterInit).toBe(4);

    const sim = blinkerWorld();
    for (let i = 0; i < 30; i++) {
      sim.step();
      compositor.draw({
        cells: sim.view(),
        dirty: [{ x: 0, y: 0, width: 32, height: 32 }],
        tick: sim.tick,
      });
    }
    expect(compositor.layerAllocationCount).toBe(afterInit);

    compositor.resize(128, 96, 2);
    expect(compositor.layerAllocationCount).toBe(afterInit);
  });

  it('repaints L0 lazily: static ignores pan; parallax repaints on pan; theme always dirties', async () => {
    const { compositor, bgCtx } = await setUpCompositor();
    const sim = blinkerWorld();
    const frame = { cells: sim.view(), dirty: null as Rect[] | null, tick: 0 };

    // First draw paints L0.
    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBeGreaterThan(0);
    bgCtx.resetLog();

    compositor.setBackgroundMode('static');
    compositor.setViewport({ ...VIEWPORT, originX: 10, originY: 4 });
    expect(compositor.isBackgroundDirty()).toBe(false);
    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBe(0);

    compositor.setBackgroundMode('parallax');
    compositor.setViewport({ ...VIEWPORT, originX: 20, originY: 8 });
    expect(compositor.isBackgroundDirty()).toBe(true);
    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBeGreaterThan(0);
    bgCtx.resetLog();

    compositor.setTheme({ ...THEME, background: '#202020' });
    expect(compositor.isBackgroundDirty()).toBe(true);
    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBeGreaterThan(0);
  });

  it('repaints L0 when quality changes between frames, e.g. a manual pin (PHASE_3 §2.3)', async () => {
    const { compositor, bgCtx } = await setUpCompositor();
    const governor = new QualityGovernor({ registry: compositor.effectRegistry, maxQuality: 3 });
    compositor.setQualityGovernor(governor);
    const sim = blinkerWorld();
    const frame = { cells: sim.view(), dirty: null as Rect[] | null, tick: 0 };

    compositor.draw(frame);
    bgCtx.resetLog();
    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBe(0); // static + same quality: L0 is not repainted

    // `pin` writes straight to the registry, between frames. The compositor never sees a change
    // inside `draw`, so before this was fixed the background stayed at the old quality's pixels
    // until something unrelated dirtied it.
    governor.pin(0);
    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBeGreaterThan(0);
    bgCtx.resetLog();

    governor.unpin();
    governor.pin(3);
    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBeGreaterThan(0);
    bgCtx.resetLog();

    compositor.draw(frame);
    expect(bgCtx.fillRectCalls).toBe(0);
  });

  it('reports per-stage wall time, with background at 0 on frames that do not repaint L0 (P3-E-1)', async () => {
    const { compositor } = await setUpCompositor();
    const burn = (stage: 'background' | 'effects' | 'post', ms: number): EffectPass => ({
      id: `burn-${stage}`,
      stage,
      cost: ms,
      render: () => {
        const end = performance.now() + ms;
        while (performance.now() < end) {
          /* busy-wait: a lower bound on wall time that a loaded runner can only lengthen */
        }
      },
      dispose: () => {},
    });
    compositor.setEffectPasses([burn('background', 3), burn('effects', 4), burn('post', 5)]);
    const sim = blinkerWorld();
    const frame = { cells: sim.view(), dirty: null as Rect[] | null, tick: 0 };

    compositor.draw(frame); // first draw paints L0
    const first = { ...compositor.readStageMs() };
    expect(first.background).toBeGreaterThanOrEqual(3);
    expect(first.effects).toBeGreaterThanOrEqual(4);
    expect(first.post).toBeGreaterThanOrEqual(5);

    compositor.draw(frame); // static L0, same quality: background is not repainted
    const second = compositor.readStageMs();
    expect(second.background).toBe(0);
    expect(second.effects).toBeGreaterThanOrEqual(4);
    expect(second.post).toBeGreaterThanOrEqual(5);

    compositor.setEffectQuality(2); // post stage dropped by the quality ladder
    compositor.draw(frame);
    expect(compositor.readStageMs().post).toBeLessThan(5);
  });

  describe('animated backgrounds, one-shot changes and reduced motion (P3-E-3)', () => {
    function passRecording(stage: 'background' | 'effects', animated: boolean) {
      const seen: { births: number; reducedMotion: boolean }[] = [];
      const pass: EffectPass = {
        id: `rec-${stage}`,
        stage,
        cost: 0,
        animated,
        render: (ctx) => void seen.push({ births: ctx.changes.births, reducedMotion: ctx.reducedMotion }),
        dispose: () => {},
      };
      return { pass, seen };
    }
    const frame = () => ({ cells: blinkerWorld().view(), dirty: null as Rect[] | null, tick: 0 });

    it('repaints L0 every frame for an animated background pass, and only then', async () => {
      const animated = passRecording('background', true);
      const { compositor } = await setUpCompositor();
      compositor.setEffectPasses([animated.pass]);
      compositor.draw(frame()); // first draw paints L0
      compositor.draw(frame());
      compositor.draw(frame());
      expect(animated.seen).toHaveLength(3);

      const still = passRecording('background', false);
      const other = await setUpCompositor();
      other.compositor.setEffectPasses([still.pass]);
      other.compositor.draw(frame());
      other.compositor.draw(frame());
      other.compositor.draw(frame());
      expect(still.seen).toHaveLength(1); // static L0: painted once
    });

    it('stops repainting when motion is reduced or the background stage is dropped', async () => {
      const animated = passRecording('background', true);
      const { compositor } = await setUpCompositor();
      compositor.setEffectPasses([animated.pass]);
      compositor.draw(frame());
      compositor.setReducedMotion(true); // dirties L0 once so the frozen frame is painted...
      compositor.draw(frame());
      const afterFreeze = animated.seen.length;
      compositor.draw(frame());
      compositor.draw(frame());
      expect(animated.seen.length).toBe(afterFreeze); // ...and then nothing: there is nothing to animate
      expect(animated.seen.at(-1)!.reducedMotion).toBe(true);

      compositor.setReducedMotion(false);
      compositor.setEffectQuality(0);
      const before = animated.seen.length;
      compositor.draw(frame());
      compositor.draw(frame());
      expect(animated.seen.length).toBe(before); // quality 0 runs no passes at all
    });

    it('hands a frame\'s births to the next draw only, so a camera redraw cannot replay them', async () => {
      const reactive = passRecording('effects', false);
      const { compositor } = await setUpCompositor();
      compositor.setEffectPasses([reactive.pass]);
      compositor.setChangeSummary({ births: 7, deaths: 0, transitions: 0 });
      compositor.draw(frame());
      compositor.draw(frame()); // e.g. a pan: no new simulation frame, so no new births
      expect(reactive.seen.map((s) => s.births)).toEqual([7, 0]);
    });
  });

  it('with effects disabled, composites with exactly two drawImage calls', async () => {
    const { compositor, displayCtx } = await setUpCompositor();
    const sim = blinkerWorld();
    displayCtx.resetLog();
    compositor.draw({ cells: sim.view(), dirty: null, tick: 0 });
    expect(compositor.readCompositeDrawCalls()).toBe(2);
    expect(displayCtx.drawImageCalls).toBe(2);

    compositor.setEffectsEnabled(true);
    displayCtx.resetLog();
    compositor.draw({ cells: sim.view(), dirty: null, tick: 0 });
    expect(compositor.readCompositeDrawCalls()).toBe(4);
  });

  it('with effects disabled, frame time stays within 5% of a bare Canvas2DRenderer', async () => {
    // Same-process ratio against the Phase 2 cell path. drawImage is O(1) on the test double so
    // the composite cost is the compositor's own bookkeeping — the claim under test.
    const width = 320;
    const height = 180;
    const vp: Viewport = { originX: 0, originY: 0, cellSize: 4, widthPx: width, heightPx: height, dpr: 1 };
    const sim = new Simulation({ ruleset: CONWAY, width: 80, height: 45, seed: 7 });
    sim.seedRandom(0.35, 7);
    for (let i = 0; i < 8; i++) sim.step();
    const frame = { cells: sim.view(), dirty: null as Rect[] | null, tick: sim.tick };

    const directRecorder = new CanvasRecorder(width, height);
    const directCanvas = {
      width: 0,
      height: 0,
      style: {} as { width?: string; height?: string },
      getContext: (kind: string) => (kind === '2d' ? directRecorder : null),
    } as unknown as HTMLCanvasElement;
    const direct = new Canvas2DRenderer();
    await direct.init(directCanvas);
    direct.resize(width, height, 1);
    direct.setTheme(THEME);
    direct.setViewport(vp);

    const factory = (w: number, h: number) => makeSurface(w, h, false).canvas;
    const display = makeSurface(width, height, false);
    const compositor = new Compositor({ canvasFactory: factory });
    compositor.setEffectsEnabled(false);
    await compositor.init(display.canvas);
    compositor.resize(width, height, 1);
    compositor.setTheme(THEME);
    compositor.setViewport(vp);

    const ITER = 40;
    // Warm both paths.
    for (let i = 0; i < 8; i++) {
      direct.draw(frame);
      compositor.draw(frame);
    }

    // Interleaved trials, medians (P3-E-8). Timing one 40-draw window per path, one after the
    // other, charges every drift in machine speed to whichever path ran second: it read 1.055
    // against the 1.05 ceiling on a loaded box with the compositor genuinely free. Alternating
    // the paths trial by trial puts both under the same conditions; the threshold is unchanged.
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const time = (draw: () => void): number => {
      const t0 = performance.now();
      for (let i = 0; i < ITER; i++) draw();
      return performance.now() - t0;
    };
    const directTrials: number[] = [];
    const compositorTrials: number[] = [];
    for (let trial = 0; trial < 9; trial++) {
      directTrials.push(time(() => direct.draw(frame)));
      compositorTrials.push(time(() => compositor.draw(frame)));
    }

    const ratio = median(compositorTrials) / Math.max(median(directTrials), 1e-6);
    expect(ratio).toBeLessThanOrEqual(1.05);
  });
});
