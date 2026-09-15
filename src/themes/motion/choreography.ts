/**
 * P3-A-6 — choreography shapes: how a panel arrives, leaves, or acknowledges a value change.
 */
import type { DurationKey, EasingKey, MotionSignature } from '../types';
import { PRESET_EASINGS } from './easing';

export type ChoreographyKind = 'enter' | 'exit' | 'emphasis';

/** How chrome text arrives, leaves, or acknowledges — Flatline's star move. */
export type TextReveal = 'typewriter' | 'scramble' | 'fall';

export interface MotionKeyframe {
  readonly offset: number;
  readonly opacity?: number;
  readonly transform?: string;
}

export interface Choreography {
  readonly durationKey: DurationKey;
  readonly easingKey: EasingKey;
  readonly keyframes: readonly MotionKeyframe[];
  /** Stagger between siblings on multi-element enters (shell intro). */
  readonly delayStepMs?: number;
  /**
   * Character animation on text nodes (no layout reads). `animate()` restores
   * the original text when the choreography settles.
   */
  readonly textReveal?: TextReveal;
  /** Hard cap on duration — Flatline type-in never exceeds 400 ms. */
  readonly maxDurationMs?: number;
}

export interface TrailSpec {
  readonly length: number;
  readonly fadeMs: number;
}

/** Default choreography — crisp, short, no bounce (P3-C-1). Also the motion-runtime fallback. */
export const DEFAULT_ENTER: Choreography = {
  durationKey: 'slow',
  easingKey: 'decelerate',
  delayStepMs: 24,
  keyframes: [
    { offset: 0, opacity: 0, transform: 'translateY(4px)' },
    { offset: 1, opacity: 1, transform: 'translateY(0px)' },
  ],
};

export const DEFAULT_EXIT: Choreography = {
  durationKey: 'fast',
  easingKey: 'accelerate',
  keyframes: [
    { offset: 0, opacity: 1, transform: 'translateY(0px)' },
    { offset: 1, opacity: 0, transform: 'translateY(2px)' },
  ],
};

export const DEFAULT_EMPHASIS: Choreography = {
  durationKey: 'fast',
  easingKey: 'standard',
  keyframes: [
    { offset: 0, transform: 'scale(1)' },
    { offset: 0.4, transform: 'scale(1.02)' },
    { offset: 1, transform: 'scale(1)' },
  ],
};

export function defaultMotionSignature(): MotionSignature {
  return {
    durationMs: { instant: 0, fast: 90, slow: 180, slower: 280 },
    easings: { ...PRESET_EASINGS },
    enter: DEFAULT_ENTER,
    exit: DEFAULT_EXIT,
    emphasis: DEFAULT_EMPHASIS,
  };
}
