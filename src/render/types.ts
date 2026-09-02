/**
 * The renderer contract (ADR-005): Canvas2D now, WebGL2 in Phase 5, both behind this one
 * interface. No UI, theme, or engine code may depend on which renderer is active.
 *
 * Pure data shapes only, same discipline as `shared/types.ts` — `render/` may import `shared/`
 * (ADR-009's boundary matrix), never `engine/`, so nothing here reaches for engine internals;
 * a frame's `cells` is the read-only `GridView` façade `engine/` already hands to any consumer.
 */
import type { GridView, Rect, StateId } from '@shared/types';

/**
 * The camera: what part of the world is visible and at what scale. Distinct from
 * `shared/protocol.ts`'s `Viewport` (the coarser `{rect, scale}` the worker uses to cull
 * off-screen chunks before transfer) — this one is the renderer's own precise, fractional
 * pixel-space transform.
 */
export interface Viewport {
  /** World coordinates of the top-left visible point. Fractional — panning isn't cell-quantised. */
  readonly originX: number;
  readonly originY: number;
  /** Device pixels per cell. Fractional; `< 1` is the density-LOD regime (Phase 5). */
  readonly cellSize: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpr: number;
}

/**
 * A cell's fill, as a function of its state and how long it's been in that state — `age` lets a
 * theme fade/ramp a colour rather than snap it (ADR-008: "colour ramp by age"). Phase 0 always
 * calls with `age` 0 (no age tracking yet); the `ageBuffer` on `RenderFrame` is what feeds it
 * once decay/glow effects exist.
 */
export type CellPalette = (state: StateId, age: number) => string;

/**
 * The renderer-relevant slice of a theme (ADR-008's full `ThemeModule` — tokens, motion, sound,
 * render hooks). Minimal by design for Phase 0: just enough to paint cells without a hardcoded
 * grey. Phase 3 adds `src/themes/types.ts` with the complete `ThemeModule`; `CompiledTheme` there
 * is that module's *compiled*, renderer-ready projection — an extension of this shape, not a
 * replacement for it.
 */
export interface CompiledTheme {
  readonly id: string;
  readonly palette: CellPalette;
  readonly background: string;
}

/** One frame's worth of state for a renderer to draw. */
export interface RenderFrame {
  /** Read-only, no-copy chunked view. */
  readonly cells: GridView;
  /** Regions that changed since the last draw, in world (cell) coordinates. `null` means "repaint everything" — a full redraw is honestly cheaper than describing every change. */
  readonly dirty: readonly Rect[] | null;
  readonly tick: number;
  /** Ticks-since-change per cell, for decay/glow effects. Absent until a theme asks for it. */
  readonly ageBuffer?: Uint16Array;
}

/** Last frame's cost, for the auto-degrade governor (ADR-008) and any on-screen readout. */
export interface RenderStats {
  readonly frameMs: number;
  readonly drawCalls: number;
  readonly tilesRepainted: number;
}

export interface Renderer {
  readonly kind: 'canvas2d' | 'webgl2';
  init(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  resize(widthPx: number, heightPx: number, dpr: number): void;
  setTheme(theme: CompiledTheme): void;
  setViewport(vp: Viewport): void;
  draw(frame: RenderFrame): void;
  readStats(): RenderStats;
  dispose(): void;
}
