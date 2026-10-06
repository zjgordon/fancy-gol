/**
 * P3-E-3 — the composited background passes (ADR-012), proven as structure.
 *
 * L0 repaints are rare, but they still must not allocate or loop over texels: parchment used to
 * allocate an 8 MB buffer and walk 2 M texels every repaint. What the passes look like is the
 * browser's job (`tests/perf/themes-liveness.spec.ts`).
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_CHANGES, type EffectCtx } from '@render/effects/ctx';
import {
  createParchmentTexturePass,
  createStarfieldPass,
  createSunGradientPass,
  createTextRainPass,
  starScreenPosition,
  starScreenX,
  starScreenY,
} from '@render/effects/background-passes';
import { RecordingCanvas, recordingFactory } from './recording-canvas';

function rig(w = 640, h = 360) {
  const target = new RecordingCanvas(w, h);
  const baked = recordingFactory();
  const ctx = (over: Partial<EffectCtx> = {}): EffectCtx => ({
    target: target.ctx as unknown as CanvasRenderingContext2D,
    source: target as unknown as CanvasImageSource,
    cells: target as unknown as CanvasImageSource,
    viewport: { originX: 0, originY: 0, cellSize: 4.55, widthPx: w, heightPx: h, dpr: 1 },
    tick: 1,
    frameTime: 1 / 60,
    changes: EMPTY_CHANGES,
    quality: 3,
    reducedMotion: false,
    ...over,
  });
  return { target, baked, ctx };
}

describe('parchmentTexture', () => {
  it('bakes a seeded 256² texture once, and repaints with one scaled nearest-neighbour blit', () => {
    const r = rig(1920, 1080);
    const pass = createParchmentTexturePass({ seed: 7, width: 256, height: 256, canvasFactory: r.baked.factory });
    pass.generate();
    expect(pass.generated).toBe(true);
    expect(r.baked.canvases).toHaveLength(1);
    expect([r.baked.canvases[0]!.width, r.baked.canvases[0]!.height]).toEqual([256, 256]);
    expect(r.baked.canvases[0]!.ctx.imageData).toHaveLength(1);

    for (let repaint = 0; repaint < 20; repaint++) pass.render(r.ctx());
    const blits = r.target.ctx.only('drawImage');
    expect(blits).toHaveLength(20); // one per repaint, nothing else drawn
    expect(blits[0]!.args).toEqual([0, 0, 256, 256, 0, 0, 1920, 1080]);
    expect(r.target.ctx.only('putImageData')).toHaveLength(0);
    expect(r.target.ctx.imageDataAllocations).toBe(0);
    expect(r.baked.canvases).toHaveLength(1); // no new canvas after the bake
    pass.dispose();
  });

  it('is deterministic per seed, and generate() is idempotent', () => {
    const bake = (seed: number): string => {
      const r = rig();
      const pass = createParchmentTexturePass({ seed, width: 32, height: 32, canvasFactory: r.baked.factory });
      pass.generate();
      const ms = pass.generationMs;
      pass.generate();
      expect(pass.generationMs).toBe(ms);
      expect(r.baked.canvases[0]!.ctx.imageData).toHaveLength(1);
      const bytes = r.baked.canvases[0]!.ctx.imageData[0]!.join(',');
      pass.dispose();
      return bytes;
    };
    expect(bake(7)).toBe(bake(7));
    expect(bake(7)).not.toBe(bake(8));
  });

  it('bakes lazily on first render, and releases the texture on dispose', () => {
    const r = rig();
    const pass = createParchmentTexturePass({ canvasFactory: r.baked.factory });
    expect(pass.generated).toBe(false);
    pass.render(r.ctx());
    expect(pass.generated).toBe(true);
    pass.dispose();
    expect(r.baked.live()).toBe(0);
    expect(pass.generated).toBe(false);
  });
});

describe('sunGradient', () => {
  it('draws a gradient and a disc: two fills, however large the viewport', () => {
    for (const [w, h] of [[640, 360], [3840, 2160]] as const) {
      const r = rig(w, h);
      const pass = createSunGradientPass({ top: '#12001f', bottom: '#ff2a6d', sunColor: '#ffcc66' });
      pass.render(r.ctx());
      expect(r.target.ctx.only('fillRect')).toHaveLength(1);
      expect(r.target.ctx.only('fillRect')[0]!.detail).toBe('gradient:linear');
      expect(r.target.ctx.only('fill')).toHaveLength(1); // the sun
      pass.dispose();
    }
  });

  it('builds its gradient from the theme colours, and caches it until the height changes', () => {
    const r = rig(640, 360);
    const pass = createSunGradientPass({ top: '#12001f', bottom: '#ff2a6d' });
    pass.render(r.ctx());
    pass.render(r.ctx());
    pass.render(r.ctx());
    expect(r.target.ctx.gradients).toHaveLength(1);
    expect(r.target.ctx.gradients[0]!.stops).toEqual([
      { offset: 0, color: '#12001f' },
      { offset: 1, color: '#ff2a6d' },
    ]);
    pass.render(r.ctx({ viewport: { ...r.ctx().viewport, heightPx: 720 } }));
    expect(r.target.ctx.gradients).toHaveLength(2);
    pass.dispose();
  });
});

describe('textRain', () => {
  it('declares itself animated, so the compositor repaints L0 for it every frame', () => {
    const pass = createTextRainPass();
    expect(pass.animated).toBe(true);
    pass.dispose();
  });

  it('paints its own base colour, then all glyphs as one path and one fill', () => {
    const r = rig();
    const pass = createTextRainPass({ columns: 24, background: '#0a0804', color: '#ffb000', opacity: 0.05 });
    pass.render(r.ctx());
    const rects = r.target.ctx.only('fillRect');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.detail).toBe('#0a0804');
    expect(rects[0]!.args).toEqual([0, 0, 640, 360]);
    expect(r.target.ctx.only('fill')).toHaveLength(1);
    pass.dispose();
  });

  it('falls: the same pass at a later frameTime draws a different path', () => {
    const draw = (frameTime: number): string => {
      const r = rig();
      const pass = createTextRainPass({ seed: 3, columns: 8 });
      pass.render(r.ctx({ frameTime }));
      pass.dispose();
      return JSON.stringify(r.target.ctx.ops);
    };
    expect(draw(0)).toBe(draw(0));
    expect(draw(0.5)).not.toBe(draw(0));
  });

  it('freezes under reduced motion: the frame time stops mattering', () => {
    const draw = (frameTime: number): string => {
      const r = rig();
      const pass = createTextRainPass({ seed: 3, columns: 8 });
      pass.render(r.ctx({ frameTime, reducedMotion: true }));
      pass.dispose();
      return JSON.stringify(r.target.ctx.ops);
    };
    expect(draw(0)).toBe(draw(7.3));
  });

  it('does no pixel I/O', () => {
    const r = rig();
    const pass = createTextRainPass();
    for (let i = 0; i < 30; i++) pass.render(r.ctx({ frameTime: i / 60 }));
    expect(r.target.ctx.only('putImageData')).toHaveLength(0);
    expect(r.target.ctx.imageDataAllocations).toBe(0);
    pass.dispose();
  });
});

describe('starfield', () => {
  it('computes each star position without a per-star object, and agrees with starScreenPosition', () => {
    const vp = { originX: 37.5, originY: -12.25, cellSize: 4.55, widthPx: 1920, heightPx: 1080 };
    for (const [wx, wy, parallax] of [[100, 200, 0.15], [4000, 17, 0.4], [-5, 999, 0.65]] as const) {
      const both = starScreenPosition(wx, wy, vp, parallax);
      expect(starScreenX(wx, vp, parallax)).toBe(both.x);
      expect(starScreenY(wy, vp, parallax)).toBe(both.y);
    }
  });

  it('draws the base and one rect per star, deterministically, without pixel I/O', () => {
    const draw = (): { rects: number; json: string; pixelIo: number } => {
      const r = rig();
      const pass = createStarfieldPass({ seed: 42, layers: 3, starsPerLayer: 24 });
      pass.render(r.ctx());
      pass.dispose();
      return {
        rects: r.target.ctx.only('fillRect').length,
        json: JSON.stringify(r.target.ctx.ops),
        pixelIo: r.target.ctx.only('putImageData').length + r.target.ctx.imageDataAllocations,
      };
    };
    const a = draw();
    expect(a.rects).toBe(1 + 3 * 24);
    expect(a.json).toBe(draw().json);
    expect(a.pixelIo).toBe(0);
  });
});
