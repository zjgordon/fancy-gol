/**
 * Live ruleset-picker thumbnails (P2-G-1). Owns the per-entry Simulation/renderer
 * pair and the round-robin step loop. `ui/` cannot import the engine, so this stays
 * in the composition-root layer.
 */
import { Simulation } from '@engine/simulation';
import { Canvas2DRenderer } from '@render/canvas2d';
import type { CompiledTheme, Viewport as RenderViewport } from '@render/types';
import type { RuleSet } from '@shared/types';
import {
  THUMBNAIL_BATCH_SIZE,
  THUMBNAIL_CANVAS_PX,
  THUMBNAIL_SEED_DENSITY,
  THUMBNAIL_STEP_EVERY_N_FRAMES,
  THUMBNAIL_WORLD_SIZE,
  shouldStepThumbnails,
  thumbnailBatch,
} from './thumbnail-batch';

export interface ThumbnailScheduler {
  request(fn: () => void): number;
  cancel(handle: number): void;
}

export const RAF_THUMBNAIL_SCHEDULER: ThumbnailScheduler = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (handle) => cancelAnimationFrame(handle),
};

interface Thumbnail {
  readonly sim: Simulation;
  readonly renderer: Canvas2DRenderer;
}

export interface RulesetThumbnailLoopOptions {
  readonly getRuleset: (id: string) => RuleSet | undefined;
  readonly themeFor: (id: string) => CompiledTheme;
  readonly scheduler?: ThumbnailScheduler;
}

function thumbnailViewport(): RenderViewport {
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

export class RulesetThumbnailLoop {
  private readonly canvases = new Map<string, HTMLCanvasElement>();
  private readonly getRuleset: (id: string) => RuleSet | undefined;
  private readonly themeFor: (id: string) => CompiledTheme;
  private readonly scheduler: ThumbnailScheduler;
  private bundles: Map<string, Thumbnail> | null = null;
  private frame = 0;
  private offset = 0;
  private handle: number | null = null;

  constructor(opts: RulesetThumbnailLoopOptions) {
    this.getRuleset = opts.getRuleset;
    this.themeFor = opts.themeFor;
    this.scheduler = opts.scheduler ?? RAF_THUMBNAIL_SCHEDULER;
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
    const bundles = new Map<string, Thumbnail>();
    this.bundles = bundles;
    let seed = Date.now() >>> 0;
    for (const [id, canvas] of this.canvases) {
      const ruleset = this.getRuleset(id);
      if (!ruleset) continue;
      const sim = new Simulation({
        ruleset,
        width: THUMBNAIL_WORLD_SIZE,
        height: THUMBNAIL_WORLD_SIZE,
        seed,
      });
      sim.seedRandom(THUMBNAIL_SEED_DENSITY, seed);
      seed = (seed + 0x9e3779b9) >>> 0;
      const renderer = new Canvas2DRenderer();
      void renderer.init(canvas).then(() => {
        if (this.bundles !== bundles) return;
        renderer.setTheme(this.themeFor(id));
        renderer.resize(THUMBNAIL_CANVAS_PX, THUMBNAIL_CANVAS_PX, 1);
        renderer.setViewport(thumbnailViewport());
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
  }

  /** Test helper: advance one loop tick without the scheduler. */
  tick(): void {
    if (!this.bundles) return;
    this.frame += 1;
    if (!shouldStepThumbnails(this.frame, THUMBNAIL_STEP_EVERY_N_FRAMES)) return;
    const list = [...this.bundles.values()];
    const { indices, nextOffset } = thumbnailBatch(list.length, this.offset, THUMBNAIL_BATCH_SIZE);
    for (const i of indices) {
      const bundle = list[i];
      if (!bundle) continue;
      bundle.sim.step();
      bundle.renderer.draw({ cells: bundle.sim.view(), dirty: null, tick: bundle.sim.tick });
    }
    this.offset = nextOffset;
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
