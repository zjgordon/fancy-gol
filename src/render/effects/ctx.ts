/**
 * P3-A-3 — effect-pass context (PHASE_3 §2.3).
 *
 * Pure data shapes handed to every `EffectPass.render`. The degrade governor (P3-A-4) sets
 * `quality`; reactive passes (birth flashes, death particles) read `changes`.
 */
import type { Canvas2DContext } from '../layers';
import type { Viewport } from '../types';
import type { EffectStage } from './pass';

/** Births / deaths / other state flips this frame — enough for reactive effects without a full ChangeSet. */
export interface ChangeSummary {
  readonly births: number;
  readonly deaths: number;
  readonly transitions: number;
}

export const EMPTY_CHANGES: ChangeSummary = { births: 0, deaths: 0, transitions: 0 };

/** Quality ladder from the degrade governor (P3-A-4). 0 = tokens + palette only. */
export type EffectQuality = 0 | 1 | 2 | 3;

/** Stages still active at this quality — post drops first, then effects, then background. */
export function stagesForQuality(quality: EffectQuality): readonly EffectStage[] {
  if (quality >= 3) return ['background', 'effects', 'post'];
  if (quality === 2) return ['background', 'effects'];
  if (quality === 1) return ['background'];
  return [];
}

/**
 * Everything a pass may read while drawing. `target` is the layer canvas for this stage;
 * `source` is the composited image of layers below (so post can sample cells + effects).
 */
export interface EffectCtx {
  readonly target: Canvas2DContext;
  readonly source: CanvasImageSource;
  readonly viewport: Viewport;
  readonly tick: number;
  /** Seconds since an arbitrary origin — for time-based animation, not wall-clock UI. */
  readonly frameTime: number;
  readonly changes: ChangeSummary;
  readonly quality: EffectQuality;
  readonly reducedMotion: boolean;
}
