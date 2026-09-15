/**
 * Sids-Place sound pack (P3-C-4): paper rustle, a wooden clunk on tool change,
 * a low woodwind drone. Zero audio assets.
 */
import type { SoundPack, UiCue } from '@audio/types';

export const SIDS_SOUND_PACK: SoundPack = {
  ambient: {
    kind: 'pad',
    params: { pitch: 174, filter: 420, gain: 0.06, duration: 16, loop: true, waveform: 'sine' },
  },
  ui: {
    'tool-select': { kind: 'click', params: { pitch: 180, duration: 0.055, gain: 0.28, filter: 900 } },
    'panel-open': { kind: 'noiseBurst', params: { filter: 1800, duration: 0.08, gain: 0.16 } },
    'panel-close': { kind: 'noiseBurst', params: { filter: 1100, duration: 0.07, gain: 0.14 } },
    error: { kind: 'noiseBurst', params: { filter: 500, duration: 0.14, gain: 0.26 } },
    confirm: { kind: 'pluck', params: { pitch: 330, duration: 0.18, gain: 0.22, filter: 1200 } },
  },
  sim: {
    birth: { kind: 'pluck', params: { pitch: 220, duration: 0.12, gain: 0.1, filter: 800 } },
  },
};

export const SIDS_UI_CUES: readonly UiCue[] = [
  'tool-select',
  'panel-open',
  'panel-close',
  'error',
  'confirm',
];
