/**
 * P3-A-6 — choreography shapes: how a panel arrives, leaves, or acknowledges a value change.
 */
import type { DurationKey, EasingKey, MotionSignature } from '../types';
import { PRESET_EASINGS } from './easing';

export type ChoreographyKind = 'enter' | 'exit' | 'emphasis';

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
}

export interface TrailSpec {
  readonly length: number;
  readonly fadeMs: number;
}

/** Default (restrained) choreography — Default theme and the motion runtime fallback. */
export const DEFAULT_ENTER: Choreography = {
  durationKey: 'slow',
  easingKey: 'decelerate',
  delayStepMs: 40,
  keyframes: [
    { offset: 0, opacity: 0, transform: 'translateY(6px)' },
    { offset: 1, opacity: 1, transform: 'translateY(0px)' },
  ],
};

export const DEFAULT_EXIT: Choreography = {
  durationKey: 'fast',
  easingKey: 'accelerate',
  keyframes: [
    { offset: 0, opacity: 1, transform: 'translateY(0px)' },
    { offset: 1, opacity: 0, transform: 'translateY(4px)' },
  ],
};

export const DEFAULT_EMPHASIS: Choreography = {
  durationKey: 'fast',
  easingKey: 'bounce',
  keyframes: [
    { offset: 0, transform: 'scale(1)' },
    { offset: 0.45, transform: 'scale(1.04)' },
    { offset: 1, transform: 'scale(1)' },
  ],
};

export function defaultMotionSignature(): MotionSignature {
  return {
    durationMs: { instant: 0, fast: 150, slow: 600, slower: 900 },
    easings: { ...PRESET_EASINGS },
    enter: DEFAULT_ENTER,
    exit: DEFAULT_EXIT,
    emphasis: DEFAULT_EMPHASIS,
  };
}
