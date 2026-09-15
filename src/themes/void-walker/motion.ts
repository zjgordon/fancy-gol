/**
 * Void-Walker motion (P3-C-5): slow, floating, ease-out-heavy — panels bloom
 * out of darkness. Nothing snaps. Distinct from Default's 90/180/280, Chiba's
 * 70 ms terminal, Flatline's type-in, and Sids-Place's settle.
 */
import type { Choreography, MotionSignature } from '@themes/types';
import { PRESET_EASINGS } from '@themes/motion/easing';

export const VOID_ENTER: Choreography = {
  durationKey: 'slower',
  easingKey: 'decelerate',
  delayStepMs: 48,
  keyframes: [
    { offset: 0, opacity: 0, transform: 'translateY(18px) scale(0.92)' },
    { offset: 0.58, opacity: 0.85, transform: 'translateY(4px) scale(0.98)' },
    { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1)' },
  ],
};

export const VOID_EXIT: Choreography = {
  durationKey: 'slow',
  easingKey: 'accelerate',
  keyframes: [
    { offset: 0, opacity: 1, transform: 'translateY(0px) scale(1)' },
    { offset: 1, opacity: 0, transform: 'translateY(-12px) scale(1.04)' },
  ],
};

export const VOID_EMPHASIS: Choreography = {
  durationKey: 'slow',
  easingKey: 'decelerate',
  keyframes: [
    { offset: 0, transform: 'scale(1)' },
    { offset: 0.45, transform: 'scale(1.045)' },
    { offset: 1, transform: 'scale(1)' },
  ],
};

export function voidMotionSignature(): MotionSignature {
  return {
    durationMs: { instant: 0, fast: 160, slow: 380, slower: 640 },
    easings: { ...PRESET_EASINGS },
    enter: VOID_ENTER,
    exit: VOID_EXIT,
    emphasis: VOID_EMPHASIS,
  };
}
