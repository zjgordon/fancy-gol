/**
 * P3-A-4 — degrade governor: EWMA policy, hysteresis, stage drops, status indicator.
 *
 * Quality-0 / 4× throttle ACs use a *synthetic* Default-like pass stack (themes land in C-*).
 * Frame budgets are labelled as synthetic, not hardware proof.
 */
import { describe, expect, it } from 'vitest';
import { Compositor } from '@render/compositor';
import { EMPTY_CHANGES } from '@render/effects/ctx';
import { stagesForQuality } from '@render/effects/ctx';
import type { EffectPass, EffectStage } from '@render/effects/pass';
import { EffectRegistry } from '@render/effects/registry';
import type { CanvasLike } from '@render/layers';
import {
  describeQualityIndicator,
  droppedStages,
  QualityGovernor,
} from '@render/quality-governor';
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
  id: 'default-synthetic',
  background: '#1a1a1a',
  palette: () => '#cccccc',
};

const VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: 8,
  widthPx: 64,
  heightPx: 64,
  dpr: 1,
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

function countingPass(id: string, stage: EffectStage, renders: { n: number }): EffectPass {
  return {
    id,
    cost: 1,
    stage,
    render(): void {
      renders.n += 1;
    },
    dispose(): void {},
  };
}

/** Busy-waits `ms` — synthetic expensive pass for wall-clock ACs (labelled synthetic). */
function busyPass(id: string, stage: EffectStage, ms: number): EffectPass {
  return {
    id,
    cost: ms,
    stage,
    render(): void {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        /* spin */
      }
    },
    dispose(): void {},
  };
}

describe('stagesForQuality / droppedStages', () => {
  it('drops post, then effects, then background as quality falls', () => {
    expect(stagesForQuality(3)).toEqual(['background', 'effects', 'post']);
    expect(stagesForQuality(2)).toEqual(['background', 'effects']);
    expect(stagesForQuality(1)).toEqual(['background']);
    expect(stagesForQuality(0)).toEqual([]);
    expect(droppedStages(2)).toEqual(['post']);
    expect(droppedStages(1)).toEqual(['post', 'effects']);
    expect(droppedStages(0)).toEqual(['post', 'effects', 'background']);
  });
});

describe('describeQualityIndicator', () => {
  it('names dropped stages and passes in plain language', () => {
    const passes: EffectPass[] = [
      { id: 'bloom', cost: 2, stage: 'post', render() {}, dispose() {} },
      { id: 'trailFade', cost: 1, stage: 'effects', render() {}, dispose() {} },
      { id: 'starfield', cost: 1, stage: 'background', render() {}, dispose() {} },
    ];
    expect(describeQualityIndicator(3, passes)).toBe('effects at full quality');
    expect(describeQualityIndicator(2, passes)).toMatch(/post-processing/);
    expect(describeQualityIndicator(2, passes)).toMatch(/bloom/);
    expect(describeQualityIndicator(0, passes)).toMatch(/palette only/);
    expect(describeQualityIndicator(0, passes)).toMatch(/starfield/);
  });
});

describe('QualityGovernor', () => {
  it('downgrades within 30 frames when EWMA stays above 20 ms', () => {
    const registry = new EffectRegistry();
    registry.setPasses([
      countingPass('bg', 'background', { n: 0 }),
      countingPass('fx', 'effects', { n: 0 }),
      countingPass('post', 'post', { n: 0 }),
    ]);
    const gov = new QualityGovernor({ registry });
    expect(gov.getQuality()).toBe(3);

    for (let i = 0; i < 30; i++) gov.observeFrame(40);
    expect(gov.getQuality()).toBe(2);
    expect(gov.getTransitionCount()).toBe(1);
    expect(gov.getLastReason().kind).toBe('downgrade');
    expect(gov.indicatorText()).toMatch(/post-processing/);
  });

  it('returns to ≥ 55 fps after a synthetic 40 ms post pass is dropped', async () => {
    const registry = new EffectRegistry();
    const gov = new QualityGovernor({ registry });
    const factory = (w: number, h: number) => fakeCanvas(w, h);
    const compositor = new Compositor({
      canvasFactory: factory,
      effects: registry,
      qualityGovernor: gov,
    });
    await compositor.init(fakeCanvas(64, 64));
    compositor.resize(64, 64, 1);
    compositor.setTheme(THEME);
    compositor.setViewport(VIEWPORT);
    // Declared 40 ms cost — render spins only if the stage still runs (quality 3).
    compositor.setEffectPasses([busyPass('heavy-post', 'post', 40)]);

    // Downgrade via frame-time policy (no busy-wait storm — keeps the suite neighbourly).
    for (let i = 0; i < 30; i++) gov.observeFrame(40);
    expect(gov.getQuality()).toBe(2);
    expect(gov.getTransitionCount()).toBe(1);

    // Post stage is inactive — synthetic frame budget should clear 55 fps (≈18.2 ms).
    const samples: number[] = [];
    for (let i = 0; i < 21; i++) {
      compositor.draw(emptyFrame(100 + i));
      samples.push(compositor.readStats().frameMs);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median).toBeLessThan(1000 / 55);
    compositor.dispose();
  });

  it('does not oscillate: ≤ 1 transition over 100 borderline frames', () => {
    const registry = new EffectRegistry();
    const gov = new QualityGovernor({ registry, initialQuality: 2 });
    // 16 ms sits in the 12–20 ms hysteresis band — streaks must clear every frame.
    for (let i = 0; i < 100; i++) gov.observeFrame(16);
    expect(gov.getTransitionCount()).toBeLessThanOrEqual(1);
    expect(gov.getQuality()).toBe(2);
  });

  it('pin freezes automatic changes', () => {
    const registry = new EffectRegistry();
    const gov = new QualityGovernor({ registry });
    gov.pin(3);
    for (let i = 0; i < 40; i++) gov.observeFrame(50);
    expect(gov.getQuality()).toBe(3);
    gov.unpin();
    for (let i = 0; i < 30; i++) gov.observeFrame(50);
    expect(gov.getQuality()).toBe(2);
  });

  it('registry skips stages the current quality has dropped', () => {
    const renders = { bg: 0, fx: 0, post: 0 };
    const registry = new EffectRegistry({ quality: 2 });
    registry.setPasses([
      {
        id: 'bg',
        cost: 1,
        stage: 'background',
        render() {
          renders.bg += 1;
        },
        dispose() {},
      },
      {
        id: 'fx',
        cost: 1,
        stage: 'effects',
        render() {
          renders.fx += 1;
        },
        dispose() {},
      },
      {
        id: 'post',
        cost: 1,
        stage: 'post',
        render() {
          renders.post += 1;
        },
        dispose() {},
      },
    ]);
    const base = {
      target: fakeCanvas(1, 1).getContext('2d') as CanvasRenderingContext2D,
      source: fakeCanvas(1, 1),
      viewport: VIEWPORT,
      tick: 0,
      frameTime: 0,
      changes: EMPTY_CHANGES,
    };
    registry.renderStage('background', base);
    registry.renderStage('effects', base);
    registry.renderStage('post', base);
    expect(renders).toEqual({ bg: 1, fx: 1, post: 0 });
    expect(registry.totalDeclaredCost()).toBe(2);
  });
});

describe('Quality 0 under synthetic 4× slowdown (Default-shaped stack)', () => {
  /**
   * Themes are not shipped yet — this proves the *mechanism*: at quality 0, declared effect
   * cost is zero and no passes run, so a 4× throttle of a cheap cell composite stays under
   * 16.67 ms (60 fps). Labelled synthetic.
   */
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
    compositor.setTheme(THEME);
    compositor.setViewport(VIEWPORT);
    // Expensive *declared* stack — must not run at quality 0 (no busy-wait; suite stays neighbourly).
    let illegalRenders = 0;
    const guard = (id: string, stage: EffectStage, cost: number): EffectPass => ({
      id,
      cost,
      stage,
      render(): void {
        illegalRenders += 1;
      },
      dispose(): void {},
    });
    compositor.setEffectPasses([
      guard('starfield', 'background', 5),
      guard('trailFade', 'effects', 8),
      guard('bloom', 'post', 12),
    ]);
    expect(gov.getQuality()).toBe(0);
    expect(registry.totalDeclaredCost()).toBe(0);

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      compositor.draw(emptyFrame(i));
      // Synthetic 4× CPU throttle: inflate measured main-thread cost.
      samples.push(compositor.readStats().frameMs * 4);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(illegalRenders).toBe(0);
    expect(median).toBeLessThan(1000 / 60);
    expect(gov.indicatorText()).toMatch(/palette only/);
    compositor.dispose();
  });
});
