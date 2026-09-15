/**
 * P3-A-3 — one effect pass (PHASE_3 §2.3).
 *
 * A pass is a named, staged, disposable unit of work. The registry owns the list; the compositor
 * owns the L0–L3 canvases. Passes may allocate their own offscreen buffers or WebAudio nodes —
 * `dispose()` must release every one (leak-tested over theme switches).
 */
import type { EffectCtx } from './ctx';

/** Where in the layered pipeline this pass draws. */
export type EffectStage = 'background' | 'effects' | 'post';

export interface EffectPass {
  readonly id: string;
  /**
   * Declared / EWMA-smoothed cost in milliseconds. The degrade governor (P3-A-4) sums these;
   * a no-op must stay well under 0.1 ms measured.
   */
  readonly cost: number;
  readonly stage: EffectStage;
  render(ctx: EffectCtx): void;
  resize?(widthPx: number, heightPx: number, dpr: number): void;
  dispose(): void;
}

/** A pass that draws nothing — the overhead floor for the registry/compositor path. */
export function createNoOpPass(id = 'noop', stage: EffectStage = 'effects'): EffectPass {
  return {
    id,
    cost: 0,
    stage,
    render(): void {},
    dispose(): void {},
  };
}
