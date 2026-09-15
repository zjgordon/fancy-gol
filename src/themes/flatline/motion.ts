/**
 * Flatline motion (P3-C-3): the star of the theme. Panels type themselves in
 * (never more than 400 ms), values scramble to new digits, exits fall into
 * characters. Reduced motion is instant text — `animate()` zeros duration.
 */
import type { Choreography, MotionSignature } from '@themes/types';
import { PRESET_EASINGS } from '@themes/motion/easing';

/** Hard cap — a large panel never types longer than this (P3-C-3 AC). */
export const FLATLINE_TYPE_CAP_MS = 400;

export const FLATLINE_ENTER: Choreography = {
  durationKey: 'slower',
  easingKey: 'linear',
  delayStepMs: 0,
  maxDurationMs: FLATLINE_TYPE_CAP_MS,
  textReveal: 'typewriter',
  keyframes: [
    { offset: 0, opacity: 0, transform: 'translateY(0px)' },
    { offset: 0.12, opacity: 1, transform: 'translateY(0px)' },
    { offset: 1, opacity: 1, transform: 'translateY(0px)' },
  ],
};

export const FLATLINE_EXIT: Choreography = {
  durationKey: 'slow',
  easingKey: 'accelerate',
  textReveal: 'fall',
  keyframes: [
    { offset: 0, opacity: 1, transform: 'translateY(0px)' },
    { offset: 1, opacity: 0, transform: 'translateY(10px)' },
  ],
};

export const FLATLINE_EMPHASIS: Choreography = {
  durationKey: 'slow',
  easingKey: 'linear',
  textReveal: 'scramble',
  keyframes: [
    { offset: 0, transform: 'scale(1)' },
    { offset: 1, transform: 'scale(1)' },
  ],
};

export function flatlineMotionSignature(): MotionSignature {
  return {
    durationMs: { instant: 0, fast: 80, slow: 220, slower: FLATLINE_TYPE_CAP_MS },
    easings: { ...PRESET_EASINGS },
    enter: FLATLINE_ENTER,
    exit: FLATLINE_EXIT,
    emphasis: FLATLINE_EMPHASIS,
  };
}
