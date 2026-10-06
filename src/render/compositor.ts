/**
 * P3-A-1 / P3-A-3 — layered compositor (PHASE_3 §2.1, ADR-005/008).
 *
 * Owns the L0–L3 offscreen stack, drives Phase 0's `Canvas2DRenderer` into L1 without forcing
 * full cell-layer repaints, runs the effect-pass registry onto L0 / L2 / L3, and blits in one
 * pass. With effects disabled the composite is two `drawImage`s (L0 + L1) — nearly free.
 *
 * L4 overlay stays *above* this composite (never owned here).
 */
import { Canvas2DRenderer } from './canvas2d';
import { EMPTY_CHANGES, stagesForQuality, type ChangeSummary, type EffectQuality } from './effects/ctx';
import type { EffectPass } from './effects/pass';
import { EffectRegistry } from './effects/registry';
import {
  defaultCanvasFactory,
  LayerStack,
  type CanvasFactory,
  type CanvasLike,
  type Canvas2DContext,
  type CompositorLayerId,
} from './layers';
import type { QualityGovernor } from './quality-governor';
import type { CompiledTheme, RenderFrame, Renderer, RenderStats, Viewport } from './types';

/**
 * Wall ms the last `draw` spent in each effect stage (P3-E-1). `background` is 0 on frames where L0
 * was not repainted. Measured around `EffectRegistry.renderStage`, so it is the number the
 * browser-floor liveness and ratio gates reason about — never a declared cost (ADR-011/012).
 */
export interface StageTimings {
  background: number;
  effects: number;
  post: number;
}

/** How L0 decides whether a camera move forces a background repaint. */
export type BackgroundMode = 'static' | 'parallax';

/**
 * Optional theme hook for L0 (ADR-008 `drawBackground`). When absent the compositor fills L0
 * with `CompiledTheme.background` — enough for Default / effects-off.
 */
export type BackgroundPainter = (ctx: Canvas2DContext, vp: Viewport, tick: number) => void;

export interface CompositorOptions {
  /** Injected layer canvases for headless tests. Defaults to `OffscreenCanvas` / DOM canvas. */
  readonly canvasFactory?: CanvasFactory;
  /** Cell-layer renderer. Defaults to a fresh `Canvas2DRenderer`. */
  readonly cellRenderer?: Renderer;
  /** Effect-pass registry. Defaults to a fresh empty registry. */
  readonly effects?: EffectRegistry;
  /**
   * Optional degrade governor (P3-A-4). When set, each `draw` feeds the previous frame's
   * `frameMs` into `observeFrame` before painting so quality can drop before the expensive work.
   */
  readonly qualityGovernor?: QualityGovernor;
}

type DisplayCanvas = HTMLCanvasElement | OffscreenCanvas;

/** `drawImage` calls that fill L3 with L0+L1+L2 before the post passes run. */
const POST_STACK_COPIES = 3;

function isStyleable(canvas: DisplayCanvas): canvas is HTMLCanvasElement {
  return 'style' in canvas;
}

function cameraKey(vp: Viewport): string {
  return `${vp.originX}|${vp.originY}|${vp.cellSize}`;
}

/**
 * `Renderer` that composites L0–L3. Cell dirty-rects flow straight into the Phase 0 Canvas2D
 * path on L1 — the compositor never rewrites `frame.dirty` to `null`.
 */
export class Compositor implements Renderer {
  readonly kind = 'canvas2d' as const;

  private readonly layers: LayerStack;
  private readonly cellRenderer: Renderer;
  private readonly effects: EffectRegistry;
  private qualityGovernor: QualityGovernor | null;
  private display: DisplayCanvas | null = null;
  private displayCtx: Canvas2DContext | null = null;
  private viewport: Viewport | null = null;
  private theme: CompiledTheme | null = null;
  private backgroundMode: BackgroundMode = 'static';
  private backgroundPainter: BackgroundPainter | null = null;
  private effectsEnabled = false;
  private l0Dirty = true;
  /** Quality L0 was last painted at; a mismatch means a background pass appeared or vanished. */
  private paintedQuality: EffectQuality | null = null;
  private lastCameraKey: string | null = null;
  private frameTimeOrigin = 0;
  private changes: ChangeSummary = EMPTY_CHANGES;
  private readonly stats = { frameMs: 0, drawCalls: 0, tilesRepainted: 0 };
  private compositeDrawCalls = 0;
  private readonly stageMs: StageTimings = { background: 0, effects: 0, post: 0 };
  /** True when L3 holds the whole L0+L1+L2 stack, so the display needs only L3 (P3-E-2). */
  private postCoversStack = false;

  constructor(options: CompositorOptions = {}) {
    this.layers = new LayerStack(options.canvasFactory ?? defaultCanvasFactory);
    this.cellRenderer = options.cellRenderer ?? new Canvas2DRenderer();
    this.effects = options.effects ?? new EffectRegistry();
    this.qualityGovernor = options.qualityGovernor ?? null;
    if (this.qualityGovernor) {
      this.effects.setQuality(this.qualityGovernor.getQuality());
    }
  }

  /** Expose a layer surface for tests (e.g. attach `CanvasRecorder` to L1). */
  layer(id: CompositorLayerId): { canvas: CanvasLike; ctx: Canvas2DContext } {
    return this.layers.get(id);
  }

  /** Canvas objects created for L0–L3. Stable across frames and theme pass swaps. */
  get layerAllocationCount(): number {
    return this.layers.allocationCount;
  }

  /** The live effect-pass registry (hot-swapped on theme change). */
  get effectRegistry(): EffectRegistry {
    return this.effects;
  }

  /**
   * Hot-swap passes for a theme. Disposes the previous set; does **not** reallocate L0–L3.
   * Marks L0 dirty so background-stage passes repaint without a flash of the old theme.
   */
  setEffectPasses(passes: readonly EffectPass[]): void {
    this.effects.setPasses(passes);
    this.l0Dirty = true;
    // Enabling the pipeline when passes arrive keeps Default (empty registry) on the cheap path.
    this.effectsEnabled = passes.length > 0;
  }

  /** Drop phosphor ghosts and other transient pass state (grid clear). */
  resetEffects(): void {
    this.effects.resetTransient();
  }

  /**
   * When false, L2/L3 are skipped and no passes run — frame cost stays within 5% of bare
   * Canvas2D (P3-A-1). `setEffectPasses` turns this on when the list is non-empty.
   */
  setEffectsEnabled(enabled: boolean): void {
    this.effectsEnabled = enabled;
  }

  getEffectsEnabled(): boolean {
    return this.effectsEnabled;
  }

  setEffectQuality(q: EffectQuality): void {
    this.effects.setQuality(q);
    // Manual override without a governor (tests); with a governor, prefer pin()/unpin().
    this.l0Dirty = true;
  }

  /** Attach or replace the degrade governor. Syncs registry quality from the governor. */
  setQualityGovernor(governor: QualityGovernor | null): void {
    this.qualityGovernor = governor;
    if (governor) this.effects.setQuality(governor.getQuality());
    this.l0Dirty = true;
  }

  getQualityGovernor(): QualityGovernor | null {
    return this.qualityGovernor;
  }

  /** Plain-language status copy when quality &lt; 3; empty string at full quality. */
  qualityIndicatorText(): string {
    if (!this.qualityGovernor) return '';
    const text = this.qualityGovernor.indicatorText();
    return text === 'effects at full quality' ? '' : text;
  }

  /**
   * Whether effects should hold still (`prefers-reduced-motion`, and `?test=1`). Reactive particle
   * passes spawn nothing and falling text freezes; L0 repaints so the frozen frame is the new one.
   */
  setReducedMotion(reduced: boolean): void {
    this.effects.setReducedMotion(reduced);
    this.l0Dirty = true;
  }

  /**
   * True while the active theme has a background that moves on its own (Flatline's falling text).
   * A paused scene still needs a redraw each frame then; nothing else does.
   */
  hasAnimatedBackground(): boolean {
    return this.effects.hasAnimatedBackground();
  }

  /**
   * Births/deaths/transitions for reactive passes (from the worker stats). Consumed by the next
   * `draw`: it applies to that one frame only.
   */
  setChangeSummary(changes: ChangeSummary): void {
    this.changes = changes;
  }

  /**
   * `static` — L0 repaints only on theme / resize / pass swap.
   * `parallax` — L0 also repaints when the camera pans or zooms.
   */
  setBackgroundMode(mode: BackgroundMode): void {
    if (mode === this.backgroundMode) return;
    this.backgroundMode = mode;
    this.l0Dirty = true;
  }

  setBackgroundPainter(painter: BackgroundPainter | null): void {
    this.backgroundPainter = painter;
    this.l0Dirty = true;
  }

  init(canvas: DisplayCanvas): Promise<void> {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('compositor: display getContext("2d") returned null');
      this.display = canvas;
      this.displayCtx = ctx;
      this.layers.init();
      this.frameTimeOrigin = performance.now();
      const cells = this.layers.get('cells');
      return this.cellRenderer.init(cells.canvas).then(() => undefined);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  resize(widthPx: number, heightPx: number, dpr: number): void {
    const display = this.requireDisplay();
    display.width = widthPx;
    display.height = heightPx;
    if (isStyleable(display)) {
      display.style.width = `${widthPx / dpr}px`;
      display.style.height = `${heightPx / dpr}px`;
    }

    const sizeChanged = this.layers.resize(widthPx, heightPx);
    if (sizeChanged) this.l0Dirty = true;

    this.cellRenderer.resize(widthPx, heightPx, dpr);
    this.effects.resize(widthPx, heightPx, dpr);
    this.qualityGovernor?.clearCostMemory();

    this.viewport = {
      ...(this.viewport ?? { originX: 0, originY: 0, cellSize: 16 }),
      widthPx,
      heightPx,
      dpr,
    };
  }

  setTheme(theme: CompiledTheme): void {
    this.theme = theme;
    this.cellRenderer.setTheme(theme);
    this.l0Dirty = true;
  }

  setViewport(vp: Viewport): void {
    const prevKey = this.lastCameraKey;
    const nextKey = cameraKey(vp);
    this.viewport = vp;
    this.cellRenderer.setViewport(vp);
    this.lastCameraKey = nextKey;
    if (this.backgroundMode === 'parallax' && prevKey !== null && prevKey !== nextKey) {
      this.l0Dirty = true;
    }
  }

  draw(frame: RenderFrame): void {
    const displayCtx = this.requireDisplayCtx();
    const viewport = this.requireViewport();
    const theme = this.requireTheme();

    // Apply last frame's cost before painting so a downgrade skips this frame's expensive stages.
    this.qualityGovernor?.observeFrame(this.stats.frameMs);
    // Compare against what L0 was *painted* at, not against what this call changed: a manual
    // `pin()` writes straight to the registry between frames, so a before/after check inside
    // `draw` never sees it and L0 kept the previous quality's background until something else
    // dirtied it (found by the P3-E-1 liveness spec).
    if (this.effects.getQuality() !== this.paintedQuality) this.l0Dirty = true;

    const t0 = performance.now();
    const frameTime = (t0 - this.frameTimeOrigin) / 1000;
    this.stageMs.background = 0;
    this.stageMs.effects = 0;
    this.stageMs.post = 0;

    this.paintBackgroundIfNeeded(theme, viewport, frame.tick, frameTime);

    // Dirty-rect behaviour is entirely the cell renderer's — never coerce to a full repaint.
    this.cellRenderer.draw(frame);

    if (this.effectsEnabled) {
      this.runEffectStages(viewport, frame.tick, frameTime);
    }

    this.compositeDrawCalls = this.blitToDisplay(displayCtx);
    const cellStats = this.cellRenderer.readStats();
    this.stats.frameMs = performance.now() - t0;
    this.stats.drawCalls = cellStats.drawCalls + this.compositeDrawCalls;
    this.stats.tilesRepainted = cellStats.tilesRepainted;
    // Births and deaths belong to the frame that reported them. Left in place, a camera-only redraw
    // (which draws with no new simulation frame) would see the same births again and spawn the same
    // particles every time the user pans (P3-E-3).
    this.changes = EMPTY_CHANGES;
  }

  readStats(): RenderStats {
    return this.stats;
  }

  /** Per-stage wall ms of the most recent `draw` (see {@link StageTimings}). Stable object, live values. */
  readStageMs(): Readonly<StageTimings> {
    return this.stageMs;
  }

  /** Cell-layer stats alone — what P0-H-3 / dirty-rect ACs compare against. */
  readCellStats(): RenderStats {
    return this.cellRenderer.readStats();
  }

  /** `drawImage` count from the most recent composite pass (2 with effects off, 4 with on). */
  readCompositeDrawCalls(): number {
    return this.compositeDrawCalls;
  }

  /** Test seam: whether L0 will repaint on the next `draw`. */
  isBackgroundDirty(): boolean {
    return this.l0Dirty;
  }

  dispose(): void {
    this.effects.dispose();
    this.cellRenderer.dispose();
    this.layers.dispose();
    this.display = null;
    this.displayCtx = null;
    this.viewport = null;
    this.theme = null;
    this.backgroundPainter = null;
    this.lastCameraKey = null;
  }

  private paintBackgroundIfNeeded(
    theme: CompiledTheme,
    viewport: Viewport,
    tick: number,
    frameTime: number,
  ): void {
    // An `animated` background pass (Flatline's falling text) repaints L0 every frame; everything
    // else repaints only when something it depends on changed.
    if (!this.l0Dirty && !this.effects.hasAnimatedBackground()) return;
    const { ctx, canvas } = this.layers.get('background');
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.backgroundPainter) {
      this.backgroundPainter(ctx, viewport, tick);
    } else {
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.effectsEnabled) {
      const s0 = performance.now();
      this.effects.renderStage('background', {
        target: ctx,
        source: canvas,
        cells: this.layers.get('cells').canvas,
        viewport,
        tick,
        frameTime,
        changes: this.changes,
      });
      this.stageMs.background = performance.now() - s0;
    }
    this.l0Dirty = false;
    this.paintedQuality = this.effects.getQuality();
  }

  private runEffectStages(viewport: Viewport, tick: number, frameTime: number): void {
    const effects = this.layers.get('effects');
    const post = this.layers.get('post');
    const cells = this.layers.get('cells');

    effects.ctx.setTransform(1, 0, 0, 1, 0, 0);
    effects.ctx.clearRect(0, 0, effects.canvas.width, effects.canvas.height);
    const e0 = performance.now();
    this.effects.renderStage('effects', {
      target: effects.ctx,
      source: cells.canvas,
      cells: cells.canvas,
      viewport,
      tick,
      frameTime,
      changes: this.changes,
    });
    this.stageMs.effects = performance.now() - e0;

    // Timed from here so the three L0+L1+L2 → L3 copies count as post cost, not as free setup.
    const p0 = performance.now();
    post.ctx.setTransform(1, 0, 0, 1, 0, 0);
    post.ctx.clearRect(0, 0, post.canvas.width, post.canvas.height);
    // Post must sample the stack below (L0+L1+L2) so bloom/scanlines hit live cells,
    // not an empty effects layer. L4 overlay is drawn after compositor.draw().
    const postLive =
      stagesForQuality(this.effects.getQuality()).includes('post') &&
      this.effects.listStage('post').length > 0;
    if (postLive) {
      post.ctx.drawImage(this.layers.get('background').canvas, 0, 0);
      post.ctx.drawImage(cells.canvas, 0, 0);
      post.ctx.drawImage(effects.canvas, 0, 0);
    }
    this.postCoversStack = postLive;
    this.effects.renderStage('post', {
      target: post.ctx,
      source: postLive ? post.canvas : effects.canvas,
      cells: cells.canvas,
      viewport,
      tick,
      frameTime,
      changes: this.changes,
    });
    this.stageMs.post = performance.now() - p0;
  }

  private blitToDisplay(displayCtx: Canvas2DContext): number {
    const w = this.layers.width;
    const h = this.layers.height;
    displayCtx.setTransform(1, 0, 0, 1, 0, 0);
    displayCtx.clearRect(0, 0, w, h);

    // With a live post stage, L3 already holds L0+L1+L2 (copied in `runEffectStages` so the post
    // passes can sample the stack). Blitting those three layers to the display again would repeat
    // three full-frame operations every frame for pixels L3 is about to cover. The three L3 copies
    // are counted here so draw-call accounting stays honest.
    if (this.effectsEnabled && this.postCoversStack) {
      displayCtx.drawImage(this.layers.get('post').canvas, 0, 0);
      return 1 + POST_STACK_COPIES;
    }

    let calls = 0;
    displayCtx.drawImage(this.layers.get('background').canvas, 0, 0);
    calls += 1;
    displayCtx.drawImage(this.layers.get('cells').canvas, 0, 0);
    calls += 1;

    if (this.effectsEnabled) {
      displayCtx.drawImage(this.layers.get('effects').canvas, 0, 0);
      calls += 1;
      displayCtx.drawImage(this.layers.get('post').canvas, 0, 0);
      calls += 1;
    }
    return calls;
  }

  private requireDisplay(): DisplayCanvas {
    if (!this.display) throw new Error('compositor: init() must be called first');
    return this.display;
  }

  private requireDisplayCtx(): Canvas2DContext {
    if (!this.displayCtx) throw new Error('compositor: init() must be called first');
    return this.displayCtx;
  }

  private requireTheme(): CompiledTheme {
    if (!this.theme) throw new Error('compositor: setTheme() must be called before draw()');
    return this.theme;
  }

  private requireViewport(): Viewport {
    if (!this.viewport) throw new Error('compositor: setViewport() must be called before draw()');
    return this.viewport;
  }
}
