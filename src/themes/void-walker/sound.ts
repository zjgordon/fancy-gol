/**
 * Void-Walker sound pack (P3-C-5): bell-like plucks with long convolution tails
 * (impulse generated at runtime — zero audio assets), a deep evolving pad.
 */
import type { SoundPack, UiCue } from '@audio/types';

const BELL_PLUCK = {
  duration: 0.85,
  gain: 0.22,
  filter: 3200,
  reverb: true,
  envelope: { attack: 0.002, decay: 0.28, sustain: 0.08, release: 0.55 },
};

export const VOID_SOUND_PACK: SoundPack = {
  ambient: {
    kind: 'pad',
    params: {
      pitch: 46,
      filter: 220,
      gain: 0.07,
      duration: 16,
      loop: true,
      waveform: 'sine',
    },
  },
  ui: {
    'tool-select': { kind: 'pluck', params: { ...BELL_PLUCK, pitch: 660 } },
    'panel-open': { kind: 'pluck', params: { ...BELL_PLUCK, pitch: 528 } },
    'panel-close': { kind: 'pluck', params: { ...BELL_PLUCK, pitch: 330, filter: 1800 } },
    error: { kind: 'noiseBurst', params: { filter: 480, duration: 0.16, gain: 0.2 } },
    confirm: { kind: 'pluck', params: { ...BELL_PLUCK, pitch: 880, duration: 1.0 } },
  },
  sim: {
    birth: { kind: 'pluck', params: { ...BELL_PLUCK, pitch: 784, duration: 0.7, gain: 0.16 } },
  },
};

export const VOID_UI_CUES: readonly UiCue[] = [
  'tool-select',
  'panel-open',
  'panel-close',
  'error',
  'confirm',
];

/** Seed for the synthesised convolution impulse (must match `audio/impulse.ts` default). */
export const VOID_REVERB_IMPULSE_SEED = 0x501d;
