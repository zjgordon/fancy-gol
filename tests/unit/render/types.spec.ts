import { describe, expectTypeOf, it } from 'vitest';
import type { GridView, Rect, StateId } from '@shared/types';
import type { CellPalette, CompiledTheme, RenderFrame, Renderer, RenderStats, Viewport } from '@render/types';

describe('Viewport shape (ADR-005)', () => {
  it('pins the camera contract', () => {
    expectTypeOf<Viewport>().toHaveProperty('originX').toEqualTypeOf<number>();
    expectTypeOf<Viewport>().toHaveProperty('originY').toEqualTypeOf<number>();
    expectTypeOf<Viewport>().toHaveProperty('cellSize').toEqualTypeOf<number>();
    expectTypeOf<Viewport>().toHaveProperty('widthPx').toEqualTypeOf<number>();
    expectTypeOf<Viewport>().toHaveProperty('heightPx').toEqualTypeOf<number>();
    expectTypeOf<Viewport>().toHaveProperty('dpr').toEqualTypeOf<number>();
  });
});

describe('RenderFrame shape (ADR-005)', () => {
  it('pins the frame contract', () => {
    expectTypeOf<RenderFrame>().toHaveProperty('cells').toEqualTypeOf<GridView>();
    expectTypeOf<RenderFrame>().toHaveProperty('dirty').toEqualTypeOf<readonly Rect[] | null>();
    expectTypeOf<RenderFrame>().toHaveProperty('tick').toEqualTypeOf<number>();
    expectTypeOf<RenderFrame>().toHaveProperty('ageBuffer').toEqualTypeOf<Uint16Array | undefined>();
  });
});

describe('CompiledTheme / CellPalette (ADR-008, minimal Phase 0 slice)', () => {
  it('a palette maps a state and its age to a paint string', () => {
    expectTypeOf<CellPalette>().toEqualTypeOf<(state: StateId, age: number) => string>();
    expectTypeOf<CompiledTheme>().toHaveProperty('palette').toEqualTypeOf<CellPalette>();
    expectTypeOf<CompiledTheme>().toHaveProperty('background').toEqualTypeOf<string>();
  });
});

describe('RenderStats shape (ADR-005)', () => {
  it('pins the readStats contract', () => {
    expectTypeOf<RenderStats>().toHaveProperty('frameMs').toEqualTypeOf<number>();
    expectTypeOf<RenderStats>().toHaveProperty('drawCalls').toEqualTypeOf<number>();
    expectTypeOf<RenderStats>().toHaveProperty('tilesRepainted').toEqualTypeOf<number>();
  });
});

describe('Renderer shape (ADR-005)', () => {
  it('pins the interface every renderer (Canvas2D now, WebGL2 in Phase 5) must implement', () => {
    expectTypeOf<Renderer>().toHaveProperty('kind').toEqualTypeOf<'canvas2d' | 'webgl2'>();
    expectTypeOf<Renderer['init']>().toEqualTypeOf<(canvas: HTMLCanvasElement | OffscreenCanvas) => Promise<void>>();
    expectTypeOf<Renderer['resize']>().toEqualTypeOf<(widthPx: number, heightPx: number, dpr: number) => void>();
    expectTypeOf<Renderer['setTheme']>().toEqualTypeOf<(theme: CompiledTheme) => void>();
    expectTypeOf<Renderer['setViewport']>().toEqualTypeOf<(vp: Viewport) => void>();
    expectTypeOf<Renderer['draw']>().toEqualTypeOf<(frame: RenderFrame) => void>();
    expectTypeOf<Renderer['readStats']>().toEqualTypeOf<() => RenderStats>();
    expectTypeOf<Renderer['dispose']>().toEqualTypeOf<() => void>();
  });
});
