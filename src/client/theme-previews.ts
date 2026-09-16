/**
 * Live theme-picker previews (P3-D-1). Each card runs a tiny Conway soup with that
 * theme's palette/background only — full effect stacks are far too heavy for the
 * < 3 ms combined budget. Lives in `client/` because `ui/` cannot import the engine
 * (same split as `ruleset-thumbnails.ts`).
 */
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { Canvas2DRenderer } from '@render/canvas2d';
import type { CompiledTheme, Viewport as RenderViewport } from '@render/types';
import {
  THUMBNAIL_BATCH_SIZE,
  THUMBNAIL_CANVAS_PX,
  THUMBNAIL_SEED_DENSITY,
  THUMBNAIL_STEP_EVERY_N_FRAMES,
  THUMBNAIL_WORLD_SIZE,
  shouldStepThumbnails,
  thumbnailBatch,
} from './thumbnail-batch';
import type { ThumbnailScheduler } from './ruleset-thumbnails';
import { RAF_THUMBNAIL_SCHEDULER } from './ruleset-thumbnails';

/** Combined preview tick budget (P3-D-1 AC). */
export const THEME_PREVIEW_BUDGET_MS = 3;

interface Preview {
  readonly sim: Simulation;
  readonly renderer: Canvas2DRenderer;
}

export interface ThemePreviewLoopOptions {
  readonly themeFor: (id: string) => CompiledTheme | undefined;
  readonly scheduler?: ThumbnailScheduler;
  readonly now?: () => number;
}

function previewViewport(): RenderViewport {
  const cellSize = THUMBNAIL_CANVAS_PX / THUMBNAIL_WORLD_SIZE;
  return {
    originX: 0,
    originY: 0,
    cellSize,
    widthPx: THUMBNAIL_CANVAS_PX,
    heightPx: THUMBNAIL_CANVAS_PX,
    dpr: 1,
  };
}

export class ThemePreviewLoop {
  private readonly canvases = new Map<string, HTMLCanvasElement>();
  private readonly themeFor: (id: string) => CompiledTheme | undefined;
  private readonly scheduler: ThumbnailScheduler;
  private readonly now: () => number;
  private bundles: Map<string, Preview> | null = null;
  private frame = 0;
  private offset = 0;
  private handle: number | null = null;
  private lastTickMs = 0;

  constructor(opts: ThemePreviewLoopOptions) {
    this.themeFor = opts.themeFor;
    this.scheduler = opts.scheduler ?? RAF_THUMBNAIL_SCHEDULER;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Most recent `tick()` wall time in ms — for the < 3 ms budget gate. */
  get lastTickCostMs(): number {
    return this.lastTickMs;
  }

  get running(): boolean {
    return this.bundles !== null;
  }

  register(id: string, canvas: HTMLCanvasElement): void {
    this.canvases.set(id, canvas);
  }

  clear(): void {
    this.stop();
    this.canvases.clear();
  }

  start(): void {
    this.stop();
    const bundles = new Map<string, Preview>();
    this.bundles = bundles;
    let seed = 0xdecafbad >>> 0;
    for (const [id, canvas] of this.canvases) {
      const theme = this.themeFor(id);
      if (!theme) continue;
      const sim = new Simulation({
        ruleset: CONWAY,
        width: THUMBNAIL_WORLD_SIZE,
        height: THUMBNAIL_WORLD_SIZE,
        seed,
      });
      sim.seedRandom(THUMBNAIL_SEED_DENSITY, seed);
      seed = (seed + 0x9e3779b9) >>> 0;
      const renderer = new Canvas2DRenderer();
      void renderer.init(canvas).then(() => {
        if (this.bundles !== bundles) return;
        renderer.setTheme(theme);
        renderer.resize(THUMBNAIL_CANVAS_PX, THUMBNAIL_CANVAS_PX, 1);
        renderer.setViewport(previewViewport());
        renderer.draw({ cells: sim.view(), dirty: null, tick: sim.tick });
      });
      bundles.set(id, { sim, renderer });
    }
    this.frame = 0;
    this.offset = 0;
    this.arm();
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    if (this.bundles) for (const { renderer } of this.bundles.values()) renderer.dispose();
    this.bundles = null;
    this.lastTickMs = 0;
  }

  /** Advance one loop tick without the scheduler (tests + budget measurement). */
  tick(): void {
    if (!this.bundles) return;
    const t0 = this.now();
    this.frame += 1;
    if (!shouldStepThumbnails(this.frame, THUMBNAIL_STEP_EVERY_N_FRAMES)) {
      this.lastTickMs = this.now() - t0;
      return;
    }
    const list = [...this.bundles.values()];
    const { indices, nextOffset } = thumbnailBatch(list.length, this.offset, THUMBNAIL_BATCH_SIZE);
    for (const i of indices) {
      const bundle = list[i];
      if (!bundle) continue;
      bundle.sim.step();
      bundle.renderer.draw({ cells: bundle.sim.view(), dirty: null, tick: bundle.sim.tick });
    }
    this.offset = nextOffset;
    this.lastTickMs = this.now() - t0;
  }

  private arm(): void {
    if (this.handle !== null || !this.bundles) return;
    let sync = true;
    this.handle = this.scheduler.request(() => {
      this.handle = null;
      this.tick();
      if (!sync && this.bundles) this.arm();
    });
    sync = false;
  }
}
