/**
 * Chiba-City motion (P3-C-2): fast, mechanical, one-frame overshoot — a terminal
 * answering, not a bouncing card. Distinct from Default's 90/180/280 no-bounce.
 */
import type { Choreography, MotionSignature } from '@themes/types';
import { PRESET_EASINGS } from '@themes/motion/easing';

/** ~1 frame at 60 fps, as a fraction of the 70 ms `fast` duration. */
const ONE_FRAME = 16 / 70;

export const CHIBA_ENTER: Choreography = {
  durationKey: 'fast',
  easingKey: 'decelerate',
  delayStepMs: 12,
  keyframes: [
    { offset: 0, opacity: 0, transform: 'translateY(6px) scale(0.98)' },
    { offset: ONE_FRAME, opacity: 1, transform: 'translateY(-1px) scale(1.01)' },
    { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1)' },
  ],
};

export const CHIBA_EXIT: Choreography = {
  durationKey: 'fast',
  easingKey: 'accelerate',
  keyframes: [
    { offset: 0, opacity: 1, transform: 'translateY(0px)' },
    { offset: 1, opacity: 0, transform: 'translateY(-3px)' },
  ],
};

export const CHIBA_EMPHASIS: Choreography = {
  durationKey: 'fast',
  easingKey: 'bounce',
  keyframes: [
    { offset: 0, transform: 'scale(1)' },
    { offset: ONE_FRAME, transform: 'scale(1.04)' },
    { offset: 1, transform: 'scale(1)' },
  ],
};

export function chibaMotionSignature(): MotionSignature {
  return {
    durationMs: { instant: 0, fast: 70, slow: 120, slower: 200 },
    easings: { ...PRESET_EASINGS },
    enter: CHIBA_ENTER,
    exit: CHIBA_EXIT,
    emphasis: CHIBA_EMPHASIS,
  };
}
