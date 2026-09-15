/**
 * P3-A-3 — effect-pass registry.
 *
 * Hot-swaps the active pass list on theme change: old passes are `dispose()`d, new ones installed,
 * and optional `resize` is forwarded — the compositor's L0–L3 canvases are never reallocated here.
 * Stage order is always background → effects → post within each stage's registration order.
 */
import type { EffectCtx, EffectQuality } from './ctx';
import { stagesForQuality } from './ctx';
import type { EffectPass, EffectStage } from './pass';

const STAGES: readonly EffectStage[] = ['background', 'effects', 'post'];

export interface EffectRegistryOptions {
  /** Initial quality until the degrade governor (P3-A-4) takes over. */
  readonly quality?: EffectQuality;
  readonly reducedMotion?: boolean;
}

/**
 * Owns the live pass list. Does **not** own layer canvases — those stay on `LayerStack` so a
 * theme switch cannot flicker from canvas recreation.
 */
export class EffectRegistry {
  private passes: EffectPass[] = [];
  private readonly byStage: Record<EffectStage, EffectPass[]> = {
    background: [],
    effects: [],
    post: [],
  };
  private quality: EffectQuality;
  private reducedMotion: boolean;
  private widthPx = 0;
  private heightPx = 0;
  private dpr = 1;
  private disposed = false;
  /** Monotonic swap counter — tests assert hot-swap without layer realloc. */
  private _swapCount = 0;

  constructor(options: EffectRegistryOptions = {}) {
    this.quality = options.quality ?? 3;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  get swapCount(): number {
    return this._swapCount;
  }

  getQuality(): EffectQuality {
    return this.quality;
  }

  setQuality(q: EffectQuality): void {
    this.quality = q;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** All passes in pipeline order (background, then effects, then post). */
  list(): readonly EffectPass[] {
    return this.passes;
  }

  /** Passes for one stage, in registration order. */
  listStage(stage: EffectStage): readonly EffectPass[] {
    return this.byStage[stage];
  }

  /**
   * Replace the entire pass set. Disposes every previous pass (releasing offscreens / audio),
   * then installs `next` and resizes them to the current viewport — no layer canvas allocation.
   */
  setPasses(next: readonly EffectPass[]): void {
    this.ensureAlive();
    for (const pass of this.passes) pass.dispose();
    this.passes = [];
    for (const stage of STAGES) this.byStage[stage] = [];

    for (const pass of next) {
      this.passes.push(pass);
      this.byStage[pass.stage].push(pass);
    }
    this._swapCount += 1;

    if (this.widthPx > 0 && this.heightPx > 0) {
      for (const pass of this.passes) {
        pass.resize?.(this.widthPx, this.heightPx, this.dpr);
      }
    }
  }

  /**
   * Forward a viewport resize to every pass. Does not touch compositor layer canvases — the
   * caller (`Compositor.resize`) owns those.
   */
  resize(widthPx: number, heightPx: number, dpr: number): void {
    this.ensureAlive();
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.dpr = dpr;
    for (const pass of this.passes) {
      pass.resize?.(widthPx, heightPx, dpr);
    }
  }

  /**
   * Run every pass in `stage` against a shared context skeleton. The caller fills
   * `target` / `source` / viewport / tick / changes per stage.
   */
  renderStage(
    stage: EffectStage,
    base: Omit<EffectCtx, 'quality' | 'reducedMotion'>,
  ): void {
    this.ensureAlive();
    if (!stagesForQuality(this.quality).includes(stage)) return;
    const ctx: EffectCtx = {
      ...base,
      quality: this.quality,
      reducedMotion: this.reducedMotion,
    };
    for (const pass of this.byStage[stage]) {
      pass.render(ctx);
    }
  }

  /** Sum of declared `cost` values still active at the current quality (governor input). */
  totalDeclaredCost(): number {
    const active = new Set(stagesForQuality(this.quality));
    let sum = 0;
    for (const pass of this.passes) {
      if (active.has(pass.stage)) sum += pass.cost;
    }
    return sum;
  }

  /** Dispose every pass and clear the list. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    for (const pass of this.passes) pass.dispose();
    this.passes = [];
    for (const stage of STAGES) this.byStage[stage] = [];
    this.disposed = true;
  }

  private ensureAlive(): void {
    if (this.disposed) throw new Error('effects: EffectRegistry has been disposed');
  }
}
