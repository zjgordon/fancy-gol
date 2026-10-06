/**
 * P3-E-3 — a transparent cell layer is only safe if L0 paints a base.
 *
 * Chiba-City and Flatline drew their L0 (haze grid, falling text) under an opaque cell layer, so it
 * never showed (found by P3-E-1). Making L1 transparent fixes that, but moves a responsibility: the
 * compositor fills L0 with the theme's `background`, which is now transparent, so a background pass
 * has to paint the opaque base. This pins that for every theme that declares a transparent layer,
 * so a future theme (or a refactor of a pass) cannot ship a see-through scene.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_CHANGES, type EffectCtx } from '@render/effects/ctx';
import { THEME_MANIFEST, type ThemeBundle } from '@client/theme-bundles';
import { compileTheme } from '@themes/registry';
import { CHIBA_CITY_THEME } from '@themes/chiba-city/theme';
import { FLATLINE_THEME } from '@themes/flatline/theme';
import { SIDS_PLACE_THEME } from '@themes/sids-place/theme';
import { SYNTHWAVE_THEME } from '@themes/synthwave/theme';
import { VOID_WALKER_THEME } from '@themes/void-walker/theme';
import type { ThemeModule } from '@themes/types';
import { RecordingCanvas, stubOffscreenCanvas } from '../render/recording-canvas';

beforeAll(stubOffscreenCanvas);
afterAll(() => vi.unstubAllGlobals());

const BY_ID: Record<string, ThemeModule> = {
  'chiba-city': CHIBA_CITY_THEME,
  flatline: FLATLINE_THEME,
  'sids-place': SIDS_PLACE_THEME,
  'void-walker': VOID_WALKER_THEME,
  synthwave: SYNTHWAVE_THEME,
};

const W = 640;
const H = 360;

/** The bundle the app really loads for a theme: its tuned pass stack, not the catalogue defaults. */
async function loadBundle(id: string): Promise<ThemeBundle> {
  const entry = THEME_MANIFEST.find((e) => e.id === id);
  if (!entry) throw new Error(`no manifest entry for ${id}`);
  return (await entry.load()).bundle;
}

/** Render a theme's background-stage passes in order onto a recording canvas; return what was painted. */
async function paintBackground(id: string) {
  const target = new RecordingCanvas(W, H);
  const stack = (await loadBundle(id)).createPasses().filter((p) => p.stage === 'background');
  const ctx: EffectCtx = {
    target: target.ctx as unknown as CanvasRenderingContext2D,
    source: target as unknown as CanvasImageSource,
    cells: target as unknown as CanvasImageSource,
    viewport: { originX: 0, originY: 0, cellSize: 4.55, widthPx: W, heightPx: H, dpr: 1 },
    tick: 0,
    frameTime: 0,
    changes: EMPTY_CHANGES,
    quality: 3,
    reducedMotion: false,
  };
  for (const pass of stack) {
    pass.resize?.(W, H, 1);
    pass.render(ctx);
  }
  const ops = target.ctx.ops;
  for (const pass of stack) pass.dispose();
  return { stack, ops };
}

const TRANSPARENT = Object.entries(BY_ID).filter(([, theme]) => compileTheme(theme).background === 'rgba(0, 0, 0, 0)');

describe('themes with a transparent cell layer', () => {
  it('are exactly the five atmosphere themes', () => {
    expect(TRANSPARENT.map(([id]) => id).sort()).toEqual(['chiba-city', 'flatline', 'sids-place', 'synthwave', 'void-walker']);
  });

  it.each(TRANSPARENT)('%s: a background pass paints a base across the whole viewport', async (id) => {
    const { stack, ops } = await paintBackground(id);
    expect(stack.length, `${id} needs a background-stage pass`).toBeGreaterThan(0);
    const coversViewport = (op: { kind: string; args?: readonly number[] }): boolean => {
      const a = op.args ?? [];
      // A fill of the full viewport, or a blit scaled to it.
      if (op.kind === 'fillRect') return a[0] === 0 && a[1] === 0 && a[2] === W && a[3] === H;
      if (op.kind === 'drawImage') return a.length === 8 && a[4] === 0 && a[5] === 0 && a[6] === W && a[7] === H;
      return false;
    };
    expect(ops.some(coversViewport), `${id}: no op paints the whole of L0`).toBe(true);
  });
});
