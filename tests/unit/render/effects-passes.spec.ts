/**
 * P3-E-3 — the composited effects-stage passes (ADR-012), proven as structure.
 *
 * Like `post-passes.spec.ts`, this asserts what each pass draws and that it does no pixel I/O and no
 * per-frame allocation. What the result looks like is the browser's job
 * (`tests/perf/themes-liveness.spec.ts`).
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_CHANGES, type ChangeSummary, type EffectCtx } from '@render/effects/ctx';
import {
  GHOST_DITHER_TILE,
  createBirthFlashPass,
  createDeathParticlesPass,
  createGridGlowPass,
  createPhosphorDecayPass,
  createTrailFadePass,
  ghostDitherAlphas,
  vanishingPointX,
} from '@render/effects/effects-passes';
import type { TimedPass } from '@render/effects/timed-pass';
import { RecordingCanvas, recordingFactory } from './recording-canvas';

function rig(w = 640, h = 360) {
  const target = new RecordingCanvas(w, h);
  const cells = new RecordingCanvas(w, h);
  const baked = recordingFactory();
  const ctx = (over: Partial<EffectCtx> = {}): EffectCtx => ({
    target: target.ctx as unknown as CanvasRenderingContext2D,
    source: cells as unknown as CanvasImageSource,
    cells: cells as unknown as CanvasImageSource,
    viewport: { originX: 0, originY: 0, cellSize: 4.55, widthPx: w, heightPx: h, dpr: 1 },
    tick: 1,
    frameTime: 1 / 60,
    changes: EMPTY_CHANGES,
    quality: 3,
    reducedMotion: false,
    ...over,
  });
  return { target, cells, baked, ctx };
}

const births = (n: number): ChangeSummary => ({ births: n, deaths: 0, transitions: n });
const deaths = (n: number): ChangeSummary => ({ births: 0, deaths: n, transitions: n });

describe('the fade that makes a ghost reach zero', () => {
  /**
   * A model of `destination-out` on an 8-bit alpha channel: `round(L · (1 − a))`. Measured in Chromium
   * (2026-10-06): a constant-alpha fade of 0.1 sticks at alpha 4 for ever; the dithered fade reaches
   * exactly 0 by frame 200. The numbers below are those measurements, reproduced by the model, so the
   * property is pinned without a browser.
   */
  const fadeStep = (level: number, alpha: number): number => Math.round(level * (1 - alpha));

  it('a plain fade stalls above zero, which is the burn-in bug', () => {
    let level = 255;
    for (let frame = 0; frame < 400; frame++) level = fadeStep(level, 0.1);
    // Chromium's compositor stalled at 4; JS rounding half-up gives 5. The exact level belongs to the
    // platform. What matters, and what this pins, is that it never reaches zero.
    expect(level).toBeGreaterThan(2);
    expect(level).toBeLessThan(8);
    expect(fadeStep(level, 0.1)).toBe(level);
  });

  it('the dithered fade clears every pixel, and its mean decay matches the plain one', () => {
    const { lo, hi } = ghostDitherAlphas(0.9);
    // One pixel in eight gets the strong fade each frame, at an offset that moves every frame.
    let worst = 0;
    for (let phase = 0; phase < 8; phase++) {
      let level = 255;
      let frames = 0;
      while (level > 0 && frames < 2000) {
        level = fadeStep(level, (frames + phase) % 8 === 0 ? hi : lo);
        frames++;
      }
      worst = Math.max(worst, frames);
      expect(level).toBe(0);
    }
    expect(worst).toBeLessThan(260); // a trail is gone within a few seconds at 60 fps
  });

  it.each([0.85, 0.88, 0.9, 0.92])('fade %s: the strong fade exceeds 0.5 (so level 1 rounds to 0) and the mean is preserved', (fade) => {
    const { lo, hi } = ghostDitherAlphas(fade);
    expect(hi).toBeGreaterThan(0.5 - 1e-9);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi / 8 + (7 / 8) * lo).toBeCloseTo(1 - fade, 10);
  });
});

describe.each([
  ['phosphorDecay', (f: ReturnType<typeof recordingFactory>['factory']) => createPhosphorDecayPass({ fade: 0.9, canvasFactory: f })],
  ['trailFade', (f: ReturnType<typeof recordingFactory>['factory']) => createTrailFadePass({ fade: 0.85, canvasFactory: f })],
] as const)('%s ghost trail', (_id, make) => {
  it('fades its half-resolution canvas with the dither tile, draws the cells onto it, then blits it', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.render(r.ctx());
    const ghost = r.baked.canvases.find((c) => c.width === 320 && c.height === 180)!;
    expect(ghost).toBeDefined(); // half resolution
    const ops = ghost.ctx.ops.filter((o) => o.kind === 'fillRect' || o.kind === 'drawImage');
    expect(ops.map((o) => [o.kind, o.composite, o.detail])).toEqual([
      ['fillRect', 'destination-out', 'pattern'],
      ['drawImage', 'source-over', r.cells.id],
    ]);
    const blit = r.target.ctx.only('drawImage');
    expect(blit).toHaveLength(1);
    expect(blit[0]!.detail).toBe(ghost.id);
    expect(blit[0]!.args).toEqual([0, 0, 640, 360]);
    pass.dispose();
  });

  it('moves the fade pattern every frame, so no pixel can dodge the strong fade', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    for (let i = 0; i < 4; i++) pass.render(r.ctx());
    const ghost = r.baked.canvases.find((c) => c.width === 320)!;
    const offsets = ghost.ctx.only('translate').map((o) => String(o.args));
    expect(new Set(offsets).size).toBe(4);
    pass.dispose();
  });

  it('bakes one 64² dither tile and never allocates after the first frame', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.render(r.ctx());
    const tile = r.baked.canvases.find((c) => c.width === GHOST_DITHER_TILE)!;
    expect(tile.ctx.imageData).toHaveLength(1);
    const canvases = r.baked.canvases.length;
    r.target.ctx.ops.length = 0;
    for (let i = 0; i < 40; i++) pass.render(r.ctx());
    expect(r.baked.canvases.length).toBe(canvases);
    expect(r.target.ctx.only('putImageData')).toHaveLength(0);
    expect(r.target.ctx.imageDataAllocations).toBe(0);
    pass.dispose();
  });

  it('reset() empties the ghost, so a cleared grid leaves no trail', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.render(r.ctx());
    const ghost = r.baked.canvases.find((c) => c.width === 320)!;
    ghost.ctx.ops.length = 0;
    pass.reset?.();
    expect(ghost.ctx.only('clearRect')).toHaveLength(1);
    expect(ghost.ctx.only('clearRect')[0]!.args).toEqual([0, 0, 320, 180]);
    pass.dispose();
  });

  it('draws nothing under reduced motion, and clears what it had', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.render(r.ctx());
    const ghost = r.baked.canvases.find((c) => c.width === 320)!;
    ghost.ctx.ops.length = 0;
    r.target.ctx.ops.length = 0;
    pass.render(r.ctx({ reducedMotion: true }));
    expect(r.target.ctx.ops).toHaveLength(0);
    expect(ghost.ctx.only('clearRect')).toHaveLength(1);
    pass.dispose();
  });

  it('releases every canvas it baked', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.render(r.ctx());
    pass.dispose();
    expect(r.baked.live()).toBe(0);
  });
});

describe('gridGlow', () => {
  it('redraws its cache once, then blits it: one draw call a frame while the camera holds still', () => {
    const r = rig();
    const pass = createGridGlowPass({ canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    const cache = r.baked.canvases[0]!;
    const strokes = cache.ctx.ops.filter((o) => o.kind === 'stroke' || o.kind === 'fillRect').length;
    expect(strokes).toBeGreaterThan(0);

    cache.ctx.ops.length = 0;
    r.target.ctx.ops.length = 0;
    pass.render(r.ctx());
    pass.render(r.ctx());
    expect(cache.ctx.ops).toHaveLength(0); // the cache is not touched again
    const blits = r.target.ctx.only('drawImage');
    expect(blits).toHaveLength(2); // one per frame, and nothing else drawn on the target
    expect(r.target.ctx.ops.filter((o) => o.kind === 'fillRect')).toHaveLength(0);
    pass.dispose();
  });

  it('redraws when the camera pan moves the vanishing point, and not for a sub-pixel move', () => {
    const r = rig();
    const pass = createGridGlowPass({ parallax: 0.08, canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    const cache = r.baked.canvases[0]!;
    cache.ctx.ops.length = 0;

    const moved = r.ctx();
    pass.render({ ...moved, viewport: { ...moved.viewport, originX: 40 } });
    expect(cache.ctx.ops.length).toBeGreaterThan(0);

    cache.ctx.ops.length = 0;
    const same = r.ctx();
    pass.render({ ...same, viewport: { ...same.viewport, originX: 40 } }); // identical pose
    expect(cache.ctx.ops).toHaveLength(0);
    pass.dispose();
  });

  it('draws a ray and a floor line per frame budget, with a vanishing point that tracks the pan', () => {
    expect(vanishingPointX(0, 1000, 5, 0.08)).toBe(500);
    expect(vanishingPointX(100, 1000, 5, 0.08)).toBeGreaterThan(500);
    expect(vanishingPointX(1e9, 1000, 5, 0.08)).toBe(850); // soft clamp at 35% of the frame
  });

  it('does no pixel I/O', () => {
    const r = rig();
    const pass = createGridGlowPass({ canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    for (const c of [r.target, ...r.baked.canvases]) {
      expect(c.ctx.only('putImageData')).toHaveLength(0);
      expect(c.ctx.imageDataAllocations).toBe(0);
    }
    pass.dispose();
  });
});

describe.each([
  ['birthFlash', (cap: number) => createBirthFlashPass({ cap }), births] as const,
  ['deathParticles', (cap: number) => createDeathParticlesPass({ cap, seed: 3 }), deaths] as const,
])('%s particles', (_id, make, change) => {
  it('fire from real births or deaths, and a quiet frame fires nothing', () => {
    const r = rig();
    const pass = make(64) as TimedPass & { activeCount: number };
    pass.render(r.ctx());
    expect(pass.activeCount).toBe(0);
    pass.render(r.ctx({ changes: change(20) }));
    expect(pass.activeCount).toBeGreaterThan(0);
  });

  it('draw at most one path and one fill per alpha band, however many particles are alive', () => {
    const r = rig();
    const pass = make(256);
    pass.render(r.ctx({ changes: change(500) }));
    for (let i = 0; i < 5; i++) pass.render(r.ctx());
    r.target.ctx.ops.length = 0; // count one frame, not six
    pass.render(r.ctx());
    expect(r.target.ctx.only('fill').length).toBeGreaterThan(0);
    expect(r.target.ctx.only('fill').length).toBeLessThanOrEqual(4);
    expect(r.target.ctx.only('fillRect')).toHaveLength(0); // never a rect per particle
  });

  it('are silent under reduced motion, and drop any still in flight', () => {
    const r = rig();
    const pass = make(64) as TimedPass & { activeCount: number };
    pass.render(r.ctx({ changes: change(20) }));
    expect(pass.activeCount).toBeGreaterThan(0);
    r.target.ctx.ops.length = 0;
    pass.render(r.ctx({ reducedMotion: true, changes: change(20) }));
    expect(pass.activeCount).toBe(0);
    expect(r.target.ctx.ops).toHaveLength(0);
  });

  it('are hard-capped, allocation-free, and empty after reset()', () => {
    const r = rig();
    const pass = make(32) as TimedPass & { activeCount: number; cap: number; bufferAllocations: number };
    for (let i = 0; i < 60; i++) {
      pass.render(r.ctx({ changes: change(100) }));
      expect(pass.activeCount).toBeLessThanOrEqual(32);
    }
    expect(pass.bufferAllocations).toBe(1);
    expect(r.target.ctx.only('putImageData')).toHaveLength(0);
    expect(r.target.ctx.imageDataAllocations).toBe(0);
    pass.reset?.();
    expect(pass.activeCount).toBe(0);
  });
});
