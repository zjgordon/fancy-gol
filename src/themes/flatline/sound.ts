/**
 * Flatline sound pack (P3-C-3): teletype clatter for UI, a soft phosphor hum,
 * a discrete click per generation at low speeds. Zero audio assets.
 */
import type { SoundPack, UiCue } from '@audio/types';

const TELETYPE = {
  waveform: 'square' as const,
  filter: 2200,
  duration: 0.022,
  gain: 0.16,
};

export const FLATLINE_SOUND_PACK: SoundPack = {
  ambient: {
    kind: 'drone',
    params: { pitch: 58, filter: 180, gain: 0.05, duration: 14, loop: true, waveform: 'sine' },
  },
  ui: {
    'tool-select': { kind: 'click', params: { pitch: 1680, duration: 0.02, gain: 0.22, filter: 2600 } },
    'panel-open': { kind: 'blip', params: { ...TELETYPE, pitch: 1240 } },
    'panel-close': { kind: 'blip', params: { ...TELETYPE, pitch: 620, filter: 1600 } },
    error: { kind: 'noiseBurst', params: { filter: 900, duration: 0.09, gain: 0.22 } },
    confirm: { kind: 'blip', params: { ...TELETYPE, pitch: 1480, duration: 0.03 } },
  },
  sim: {
    birth: { kind: 'click', params: { pitch: 1900, duration: 0.016, gain: 0.12, filter: 2800 } },
    generation: { kind: 'click', params: { pitch: 1900, duration: 0.016, gain: 0.12, filter: 2800 } },
  },
};

export const FLATLINE_UI_CUES: readonly UiCue[] = [
  'tool-select',
  'panel-open',
  'panel-close',
  'error',
  'confirm',
];
