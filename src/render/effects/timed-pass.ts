/**
 * P3-A-5 — shared timing wrapper: each pass declares a cost and updates an EWMA of measured ms.
 */
import type { EffectCtx } from './ctx';
import type { EffectPass, EffectStage } from './pass';

const EWMA_ALPHA = 0.2;

export abstract class TimedPass implements EffectPass {
  abstract readonly id: string;
  abstract readonly stage: EffectStage;
  /** Mid-range 1080p budget estimate — governor input before the first measurement. */
  abstract readonly declaredCost: number;

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

  render(ctx: EffectCtx): void {
    this.ensureAlive();
    const t0 = performance.now();
    this.renderTimed(ctx);
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
