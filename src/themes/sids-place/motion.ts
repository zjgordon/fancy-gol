/**
 * Sids-Place motion (P3-C-4): weighty, slightly slow, a settle — things have mass.
 * Distinct from Default's 90/180/280 snap, Chiba's 70 ms terminal, Flatline's type-in.
 */
import type { Choreography, MotionSignature } from '@themes/types';
import { PRESET_EASINGS } from '@themes/motion/easing';

export const SIDS_ENTER: Choreography = {
  durationKey: 'slow',
  easingKey: 'decelerate',
  delayStepMs: 36,
  keyframes: [
    { offset: 0, opacity: 0, transform: 'translateY(14px) scale(0.97)' },
    { offset: 0.72, opacity: 1, transform: 'translateY(-3px) scale(1.01)' },
    { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1)' },
  ],
};

export const SIDS_EXIT: Choreography = {
  durationKey: 'slow',
  easingKey: 'accelerate',
  keyframes: [
    { offset: 0, opacity: 1, transform: 'translateY(0px) scale(1)' },
    { offset: 1, opacity: 0, transform: 'translateY(8px) scale(0.98)' },
  ],
};

export const SIDS_EMPHASIS: Choreography = {
  durationKey: 'fast',
  easingKey: 'decelerate',
  keyframes: [
    { offset: 0, transform: 'scale(1)' },
    { offset: 0.45, transform: 'scale(1.03)' },
    { offset: 1, transform: 'scale(1)' },
  ],
};

export function sidsMotionSignature(): MotionSignature {
  return {
    durationMs: { instant: 0, fast: 140, slow: 320, slower: 520 },
    easings: { ...PRESET_EASINGS },
    enter: SIDS_ENTER,
    exit: SIDS_EXIT,
    emphasis: SIDS_EMPHASIS,
  };
}
