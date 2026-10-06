/**
 * P3-E-2 — the composited post passes (ADR-012), proven as *structure*.
 *
 * These tests assert what each pass draws, with which composite operation, and that it does so
 * without pixel I/O or per-frame allocation. They deliberately cannot claim what the result looks
 * like: that is the browser's job (`tests/perf/themes-liveness.spec.ts`, ADR-012 rule 3). The
 * per-texel versions these replace passed every unit test while painting nothing in Chromium.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_CHANGES, type EffectCtx } from '@render/effects/ctx';
import {
  GRAIN_TILE_COUNT,
  GRAIN_TILE_SIZE,
  createBloomPass,
  createChromaticAberrationPass,
  createCrtCurvaturePass,
  createFilmGrainPass,
  createScanlinesPass,
  createVignettePass,
  grainFrameFor,
  scanlinePitch,
} from '@render/effects/post-passes';
import { describeQualityIndicator } from '@render/quality-governor';
import { createChibaCityPassStack, createFlatlinePassStack } from '@render/effects/library';
import type { TimedPass } from '@render/effects/timed-pass';
import { RecordingCanvas, recordingFactory, type FakeGradient } from './recording-canvas';

interface Rig {
  readonly target: RecordingCanvas;
  readonly cells: RecordingCanvas;
  readonly source: RecordingCanvas;
  readonly baked: ReturnType<typeof recordingFactory>;
  ctx(over?: Partial<EffectCtx>): EffectCtx;
}

function rig(w = 640, h = 360, dpr = 1): Rig {
  const target = new RecordingCanvas(w, h);
  const cells = new RecordingCanvas(w, h);
  const source = new RecordingCanvas(w, h);
  const baked = recordingFactory();
  return {
    target,
    cells,
    source,
    baked,
    ctx: (over = {}) => ({
      target: target.ctx as unknown as CanvasRenderingContext2D,
      source: source as unknown as CanvasImageSource,
      cells: cells as unknown as CanvasImageSource,
      viewport: { originX: 0, originY: 0, cellSize: 4.55, widthPx: w, heightPx: h, dpr },
      tick: 7,
      frameTime: 7 / 60,
      changes: EMPTY_CHANGES,
      quality: 3,
      reducedMotion: false,
      ...over,
    }),
  };
}

/** Canvas ids come from a global counter; rename them by first appearance so runs compare equal. */
function normaliseIds(json: string): string {
  const seen = new Map<string, string>();
  return json.replace(/"c\d+"/g, (id) => {
    if (!seen.has(id)) seen.set(id, `"canvas${seen.size}"`);
    return seen.get(id)!;
  });
}

type Factory = (f: ReturnType<typeof recordingFactory>['factory']) => TimedPass;

const POST_PASSES: readonly (readonly [string, Factory])[] = [
  ['bloom', (canvasFactory) => createBloomPass({ strength: 0.5, radius: 2, canvasFactory })],
  ['scanlines', (canvasFactory) => createScanlinesPass({ opacity: 0.2, canvasFactory })],
  ['chromaticAberration', (canvasFactory) => createChromaticAberrationPass({ amount: 2, edgeBias: 0.7, canvasFactory })],
  ['vignette', (canvasFactory) => createVignettePass({ strength: 0.6, canvasFactory })],
  ['filmGrain', (canvasFactory) => createFilmGrainPass({ seed: 3, amount: 9, canvasFactory })],
  ['crtCurvature', (canvasFactory) => createCrtCurvaturePass({ amount: 0.06, canvasFactory })],
];

describe.each(POST_PASSES)('%s is composited (ADR-012 rules 1 and 2)', (_id, make) => {
  it('does no pixel I/O and allocates no canvas after its first frame', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.resize?.(640, 360, 1);
    pass.render(r.ctx({ tick: 0 })); // first frame: bake is allowed here
    const canvasesAfterBake = r.baked.canvases.length;
    r.target.ctx.ops.length = 0;
    for (let tick = 1; tick <= 30; tick++) pass.render(r.ctx({ tick }));

    expect(r.target.ctx.only('putImageData')).toHaveLength(0);
    expect(r.target.ctx.imageDataAllocations).toBe(0);
    expect(r.baked.canvases.length).toBe(canvasesAfterBake);
    expect(r.target.ctx.ops.length).toBeGreaterThan(0); // and it did draw something
    pass.dispose();
  });

  it('leaves the target context state as it found it', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.render(r.ctx());
    expect(r.target.ctx.globalCompositeOperation).toBe('source-over');
    expect(r.target.ctx.globalAlpha).toBe(1);
    pass.dispose();
  });

  it('is deterministic: the same inputs draw the same sequence', () => {
    const run = (): string => {
      const r = rig();
      const pass = make(r.baked.factory);
      pass.resize?.(640, 360, 1);
      pass.render(r.ctx({ tick: 11 }));
      pass.dispose();
      return normaliseIds(JSON.stringify(r.target.ctx.ops));
    };
    expect(run()).toBe(run());
  });

  it('releases every offscreen canvas it baked on dispose', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.resize?.(640, 360, 1);
    pass.render(r.ctx());
    pass.dispose();
    expect(r.baked.live()).toBe(0);
  });

  it('does not reallocate when resized to the size it already has, and releases on a real resize', () => {
    const r = rig();
    const pass = make(r.baked.factory);
    pass.render(r.ctx());
    const first = r.baked.canvases.length;
    pass.render(r.ctx());
    expect(r.baked.canvases.length).toBe(first);
    pass.resize?.(320, 180, 1);
    pass.render(r.ctx());
    pass.dispose();
    expect(r.baked.live()).toBe(0);
  });
});

describe('bloom', () => {
  it('samples the L1 cell layer, never the composite below it', () => {
    const r = rig();
    const pass = createBloomPass({ strength: 0.4, radius: 2, canvasFactory: r.baked.factory });
    pass.resize?.(640, 360, 1);
    pass.render(r.ctx());
    const fromCells = r.baked.canvases
      .flatMap((c) => c.ctx.only('drawImage'))
      .filter((op) => op.detail === r.cells.id);
    const fromSource = r.baked.canvases
      .flatMap((c) => c.ctx.only('drawImage'))
      .filter((op) => op.detail === r.source.id);
    expect(fromCells).toHaveLength(1);
    expect(fromSource).toHaveLength(0);
    pass.dispose();
  });

  it('adds one glow blit to the target with lighter at strength ÷ levels', () => {
    for (const [radius, levels] of [[1, 1], [2, 2], [3, 3]] as const) {
      const r = rig();
      const pass = createBloomPass({ strength: 0.6, radius, canvasFactory: r.baked.factory });
      pass.resize?.(640, 360, 1);
      pass.render(r.ctx());
      const blits = r.target.ctx.only('drawImage');
      expect(blits, `radius ${radius}`).toHaveLength(1);
      expect(blits[0]!.composite).toBe('lighter');
      expect(blits[0]!.alpha).toBeCloseTo(0.6 / levels, 10);
      expect(blits[0]!.args).toEqual([0, 0, 640, 360]);
      pass.dispose();
    }
  });

  it('builds a halving chain whose depth follows radius', () => {
    const sizes = (radius: number): number[] => {
      const r = rig(640, 360);
      const pass = createBloomPass({ radius, canvasFactory: r.baked.factory });
      pass.resize?.(640, 360, 1);
      const widths = r.baked.canvases.map((c) => c.width);
      pass.dispose();
      return widths;
    };
    expect(sizes(1)).toEqual([320, 160]);
    expect(sizes(2)).toEqual([320, 160, 80]);
    expect(sizes(3)).toEqual([320, 160, 80, 40]);
  });

  it('leaves a canvas with nothing in it unlit (no cells → the only draw is an additive blit)', () => {
    const r = rig();
    const pass = createBloomPass({ strength: 0.5, radius: 2, canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    // `lighter` of a transparent glow adds nothing; there is no source-over or copy onto the target.
    expect(r.target.ctx.ops.filter((o) => o.kind === 'drawImage' && o.composite !== 'lighter')).toHaveLength(0);
    pass.dispose();
  });
});

describe('scanlines do not moiré at dpr 1, 1.5, 2, 3', () => {
  it.each([1, 1.5, 2, 3] as const)('dpr %s: an integer pitch, a 2·pitch tile, one multiply fill', (dpr) => {
    const r = rig(640, 360, dpr);
    const pass = createScanlinesPass({ opacity: 0.2, canvasFactory: r.baked.factory });
    pass.resize?.(640, 360, dpr);
    pass.render(r.ctx());

    const pitch = scanlinePitch(dpr);
    expect(Number.isInteger(pitch)).toBe(true);
    // The 1 × 2·pitch tile is baked, painted into a full-frame overlay as a pattern, then released.
    const [tile, overlay] = r.baked.canvases;
    const rows = tile!.ctx.only('fillRect');
    expect(rows.map((o) => [o.detail, o.args])).toEqual([
      ['#ffffff', [0, 0, 1, pitch]],
      ['rgb(204,204,204)', [0, pitch, 1, pitch]],
    ]);

    expect([overlay!.width, overlay!.height]).toEqual([640, 360]);
    const baked = overlay!.ctx.only('fillRect');
    expect(baked).toHaveLength(1);
    expect(baked[0]!.detail).toBe('pattern');
    expect(baked[0]!.args).toEqual([0, 0, 640, 360]);

    // Per frame: one multiply blit of the overlay, no fill (a multiply pattern fill is ~4× dearer).
    expect(r.target.ctx.only('fillRect')).toHaveLength(0);
    const blits = r.target.ctx.only('drawImage');
    expect(blits).toHaveLength(1);
    expect(blits[0]!.composite).toBe('multiply');
    pass.dispose();
  });

  it('rebakes when dpr changes, and only then', () => {
    const r = rig(640, 360, 1);
    const pass = createScanlinesPass({ canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    pass.render(r.ctx());
    expect(r.baked.canvases).toHaveLength(2); // tile + overlay
    pass.render({ ...r.ctx(), viewport: { ...r.ctx().viewport, dpr: 2 } });
    expect(r.baked.canvases).toHaveLength(4);
    expect(r.baked.canvases[2]!.ctx.only('fillRect')[0]!.args).toEqual([0, 0, 1, 2]); // pitch 2
    pass.dispose();
  });
});

describe('vignette', () => {
  const ref = (strength: number, t: number): number => 255 * (1 - strength * t * t);

  it.each([0.5, 0.55, 0.62])('strength %s: the baked gradient tracks 1 − s·d² within one 8-bit level', (strength) => {
    const r = rig(640, 360);
    const pass = createVignettePass({ strength, canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    const g = r.baked.canvases[0]!.ctx.gradients[0] as FakeGradient;
    expect(g.shape).toBe('radial');
    const stops = g.stops.map((s) => ({ t: s.offset, v: Number(/rgb\((\d+),/.exec(s.color)![1]) }));
    expect(stops[0]).toEqual({ t: 0, v: 255 });
    // Linear interpolation between stops is what the GPU does; compare it to the formula everywhere.
    let worst = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const hi = stops.findIndex((s) => s.t >= t);
      const a = stops[Math.max(0, hi - 1)]!;
      const b = stops[hi]!;
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      worst = Math.max(worst, Math.abs(a.v + (b.v - a.v) * k - ref(strength, t)));
    }
    expect(worst).toBeLessThanOrEqual(1);
    pass.dispose();
  });

  it('is centred on the pixel-centre midpoint and reaches a corner at its outer radius', () => {
    const r = rig(640, 360);
    const pass = createVignettePass({ strength: 0.55, canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    const [cx, cy, r0, cx2, cy2, r1] = r.baked.canvases[0]!.ctx.gradients[0]!.coords;
    expect([cx, cy, r0, cx2, cy2]).toEqual([319.5, 179.5, 0, 319.5, 179.5]);
    expect(r1).toBeCloseTo(Math.hypot(319.5, 179.5), 10);
    // Painted once into the overlay; per frame it is one multiply blit.
    expect(r.target.ctx.only('fillRect')).toHaveLength(0);
    const blits = r.target.ctx.only('drawImage');
    expect(blits).toHaveLength(1);
    expect(blits[0]!.composite).toBe('multiply');
    pass.dispose();
  });
});

describe('filmGrain', () => {
  it('bakes eight 256² seeded tiles once, with values inside 128 ± amount', () => {
    const r = rig();
    const pass = createFilmGrainPass({ seed: 5, amount: 9, canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    // Eight tiles, then one field a tile larger than the frame that they are laid out into.
    expect(r.baked.canvases).toHaveLength(GRAIN_TILE_COUNT + 1);
    const tiles = r.baked.canvases.slice(0, GRAIN_TILE_COUNT);
    for (const c of tiles) expect([c.width, c.height]).toEqual([GRAIN_TILE_SIZE, GRAIN_TILE_SIZE]);
    const field = r.baked.canvases[GRAIN_TILE_COUNT]!;
    expect([field.width, field.height]).toEqual([640 + GRAIN_TILE_SIZE, 360 + GRAIN_TILE_SIZE]);
    const bytes = tiles.map((c) => c.ctx.imageData[0]!);
    // Aggregate in a plain loop: half a million per-texel expect() calls is slow and, under a
    // loaded runner, a wall-clock hazard — the class of flake P3-E-8 exists to remove.
    let maxDeviation = 0;
    let opaque = true;
    for (const data of bytes) {
      for (let i = 0; i < data.length; i += 4) {
        maxDeviation = Math.max(maxDeviation, Math.abs(data[i]! - 128));
        if (data[i + 3] !== 255) opaque = false;
      }
    }
    expect(maxDeviation).toBeLessThanOrEqual(9);
    expect(maxDeviation).toBeGreaterThan(4); // it is actually noise, not a flat grey
    expect(opaque).toBe(true);
    expect(new Set(bytes.map((d) => d.join(','))).size).toBe(GRAIN_TILE_COUNT); // tiles differ
    pass.dispose();
  });

  it('is deterministic per seed and differs between seeds', () => {
    const bake = (seed: number): string => {
      const r = rig();
      const pass = createFilmGrainPass({ seed, amount: 9, canvasFactory: r.baked.factory });
      pass.render(r.ctx());
      pass.dispose();
      return r.baked.canvases[0]!.ctx.imageData[0]!.join(',');
    };
    expect(bake(1)).toBe(bake(1));
    expect(bake(1)).not.toBe(bake(2));
  });

  it('selects tile and offset from the tick alone, and reaches every tile', () => {
    expect(grainFrameFor(9)).toEqual(grainFrameFor(9));
    expect(grainFrameFor(1)).not.toEqual(grainFrameFor(2));
    const seen = new Set<number>();
    for (let t = 0; t < 256; t++) seen.add(grainFrameFor(t).tile);
    expect(seen.size).toBe(GRAIN_TILE_COUNT);
    expect(grainFrameFor(0)).toEqual({ tile: 0, dx: 0, dy: 0 });
  });

  it('fills with overlay, and reduced motion pins the tick-0 frame', () => {
    const drawFor = (over: Partial<EffectCtx>): string => {
      const r = rig();
      const pass = createFilmGrainPass({ seed: 5, amount: 9, canvasFactory: r.baked.factory });
      pass.render(r.ctx(over));
      pass.dispose();
      // One cropped overlay blit: source offset (dx, dy), 640 × 360 → the whole frame.
      expect(r.target.ctx.only('fillRect')).toHaveLength(0);
      const blit = r.target.ctx.only('drawImage')[0]!;
      expect(blit.composite).toBe('overlay');
      return JSON.stringify(blit.args);
    };
    expect(drawFor({ tick: 5 })).not.toBe(drawFor({ tick: 6 }));
    expect(drawFor({ tick: 5, reducedMotion: true })).toBe(drawFor({ tick: 99, reducedMotion: true }));
    expect(drawFor({ tick: 5, reducedMotion: true })).toBe(drawFor({ tick: 0 }));
  });
});

describe('chromatic aberration (labelled substitute, ADR-012 D3)', () => {
  it('says what it is instead of passing as the real effect', () => {
    const pass = createChromaticAberrationPass();
    expect(pass.approximation).toMatch(/edge/);
    expect(pass.approximation).toMatch(/not a radial/);
    pass.dispose();
  });

  it('touches only the left and right bands, with opposed red and blue offsets', () => {
    const r = rig(1000, 500);
    const pass = createChromaticAberrationPass({ amount: 3, edgeBias: 0.8, canvasFactory: r.baked.factory });
    pass.resize?.(1000, 500, 1);
    pass.render(r.ctx());
    const bandW = Math.round(1000 * (1 - 0.8) * 0.5);
    expect(r.baked.canvases.map((c) => c.width)).toEqual([bandW, bandW]);
    expect((2 * bandW) / 1000).toBeLessThanOrEqual(0.5); // a fraction of the frame, not all of it

    const blits = r.target.ctx.only('drawImage');
    expect(blits).toHaveLength(4);
    for (const b of blits) expect(b.composite).toBe('lighter');
    const [leftRed, leftBlue, rightRed, rightBlue] = blits.map((b) => b.args![0]!);
    expect(leftRed).toBe(-3); // red pushed outward on the left, blue inward
    expect(leftBlue).toBe(3);
    expect(rightRed).toBe(1000 - bandW + 3);
    expect(rightBlue).toBe(1000 - bandW - 3);
    pass.dispose();
  });

  it('strips red and blue from each band before re-adding them, so it shifts channels and adds no light', () => {
    const r = rig(1000, 500);
    const pass = createChromaticAberrationPass({ amount: 3, edgeBias: 0.8, canvasFactory: r.baked.factory });
    pass.resize?.(1000, 500, 1);
    pass.render(r.ctx());
    const ops = r.target.ctx.ops.filter((o) => (o.kind === 'fillRect' || o.kind === 'drawImage') && o.composite !== 'source-over');
    // Per side: one 'multiply' strip, then the two 'lighter' blits. The strip has to come first.
    expect(ops.map((o) => `${o.kind}:${o.composite}`)).toEqual([
      'fillRect:multiply',
      'drawImage:lighter',
      'drawImage:lighter',
      'fillRect:multiply',
      'drawImage:lighter',
      'drawImage:lighter',
    ]);
    pass.dispose();
  });
});

describe('CRT curvature (labelled substitute, ADR-012 D3)', () => {
  it('says what it is instead of passing as a barrel warp', () => {
    const pass = createCrtCurvaturePass();
    expect(pass.approximation).toMatch(/not a true barrel warp/);
    pass.dispose();
  });

  it('draws nothing at quality ≤ 1', () => {
    const r = rig();
    const pass = createCrtCurvaturePass({ amount: 0.2 });
    pass.render(r.ctx({ quality: 1 }));
    expect(r.target.ctx.ops).toHaveLength(0);
    pass.dispose();
  });

  it('multiplies an edge-weighted falloff, then blacks out the corners', () => {
    const r = rig();
    const pass = createCrtCurvaturePass({ amount: 0.08, canvasFactory: r.baked.factory });
    pass.render(r.ctx());
    // Both are painted once into one overlay; per frame it is a single multiply blit.
    const overlay = r.baked.canvases[0]!.ctx;
    const blits = r.target.ctx.only('drawImage');
    expect(blits).toHaveLength(1);
    expect(blits[0]!.composite).toBe('multiply');
    const v = overlay.gradients[0]!.stops.map((s) => Number(/rgb\((\d+),/.exec(s.color)![1]));
    expect(v[0]).toBe(255); // centre untouched
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThanOrEqual(v[i - 1]!); // darker outward
    expect(v.at(-1)!).toBeLessThan(255);
    expect(overlay.only('fill')).toHaveLength(1);
    pass.dispose();
  });
});

describe('the quality indicator never presents an approximation as exact', () => {
  it('names the approximating passes at full quality', () => {
    const stack = createFlatlinePassStack();
    const text = describeQualityIndicator(3, stack);
    expect(text).toMatch(/^effects at full quality — approximated:/);
    expect(text).toMatch(/crtCurvature: CRT corners drawn as a mask/);
    for (const p of stack) p.dispose();
  });

  it('names the fringe for Chiba-City and keeps the exact string for a theme with no substitute', () => {
    const chiba = createChibaCityPassStack();
    expect(describeQualityIndicator(3, chiba)).toMatch(/chromaticAberration: colour fringe/);
    for (const p of chiba) p.dispose();
    expect(describeQualityIndicator(3, [])).toBe('effects at full quality');
  });
});
