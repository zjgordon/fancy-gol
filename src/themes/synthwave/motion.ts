/**
 * Synthwave motion (P3-C-6): snappy with a slight elastic overshoot — a cassette
 * deck button, not a terminal or a floating panel. Distinct from every prior
 * theme's durations.
 */
import type { Choreography, MotionSignature } from '@themes/types';
import { PRESET_EASINGS } from '@themes/motion/easing';

export const SYNTH_ENTER: Choreography = {
  durationKey: 'fast',
  easingKey: 'bounce',
  delayStepMs: 10,
  keyframes: [
    { offset: 0, opacity: 0, transform: 'translateY(8px) scale(0.94)' },
    { offset: 0.55, opacity: 1, transform: 'translateY(-2px) scale(1.03)' },
    { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1)' },
  ],
};

export const SYNTH_EXIT: Choreography = {
  durationKey: 'fast',
  easingKey: 'accelerate',
  keyframes: [
    { offset: 0, opacity: 1, transform: 'translateY(0px) scale(1)' },
    { offset: 1, opacity: 0, transform: 'translateY(4px) scale(0.96)' },
  ],
};

export const SYNTH_EMPHASIS: Choreography = {
  durationKey: 'fast',
  easingKey: 'bounce',
  keyframes: [
    { offset: 0, transform: 'scale(1)' },
    { offset: 0.4, transform: 'scale(1.06)' },
    { offset: 1, transform: 'scale(1)' },
  ],
};

export function synthMotionSignature(): MotionSignature {
  return {
    durationMs: { instant: 0, fast: 60, slow: 110, slower: 180 },
    easings: { ...PRESET_EASINGS },
    enter: SYNTH_ENTER,
    exit: SYNTH_EXIT,
    emphasis: SYNTH_EMPHASIS,
  };
}
