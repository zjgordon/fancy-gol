/**
 * P3-A-5 — shared timing wrapper: each pass declares a cost and updates an EWMA of measured ms.
 */
import type { EffectCtx } from './ctx';
import type { EffectPass, EffectStage } from './pass';

const EWMA_ALPHA = 0.2;

/**
 * Measurement switch (P3-E-9). A Canvas2D call returns long before the browser has rasterised it,
 * so a pass's own EWMA charges it for the *previous* work that its first readback forces. With
 * `sync` on, a 1×1 read before and after each pass drains the queue so the EWMA is that pass's own
 * cost. Off in the app; the harness flips it for `perf/measure-pass-costs.spec.ts`.
 */
export const passTiming = { sync: false };

function drain(ctx: EffectCtx): void {
  (ctx.target as unknown as { getImageData(x: number, y: number, w: number, h: number): unknown }).getImageData(0, 0, 1, 1);
}

export abstract class TimedPass implements EffectPass {
  abstract readonly id: string;
  abstract readonly stage: EffectStage;
  /** Mid-range 1080p budget estimate — governor input before the first measurement. */
  abstract readonly declaredCost: number;
  /** Set by passes that draw a labelled stand-in (ADR-012 D3). See `EffectPass.approximation`. */
  readonly approximation?: string;
  /** Set by background passes that animate every frame. See `EffectPass.animated`. */
  readonly animated?: boolean;

  private ewmaMs = 0;
  private samples = 0;
  private disposed = false;

  get cost(): number {
    return this.samples === 0 ? this.declaredCost : this.ewmaMs;
  }

  /** How many times `render` has run (tests). */
  get sampleCount(): number {
    return this.samples;
  }

  /** Subclasses override to drop ghosts / pools. Default is a no-op. */
  reset(): void {}

  render(ctx: EffectCtx): void {
    this.ensureAlive();
    if (passTiming.sync) drain(ctx);
    const t0 = performance.now();
    this.renderTimed(ctx);
    if (passTiming.sync) drain(ctx);
    const dt = performance.now() - t0;
    if (this.samples === 0) this.ewmaMs = dt;
    else this.ewmaMs = EWMA_ALPHA * dt + (1 - EWMA_ALPHA) * this.ewmaMs;
    this.samples += 1;
  }

  resize?(widthPx: number, heightPx: number, dpr: number): void;

  dispose(): void {
    this.disposed = true;
    this.onDispose();
  }

  protected abstract renderTimed(ctx: EffectCtx): void;

  protected onDispose(): void {}

  protected ensureAlive(): void {
    if (this.disposed) throw new Error(`${this.id}: disposed`);
  }
}
