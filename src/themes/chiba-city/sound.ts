/**
 * Chiba-City sound pack (P3-C-2): filtered square-wave blips, a low modem-hum
 * ambient bed, a mechanical click on tool change. Zero audio assets.
 */
import type { SoundPack, UiCue } from '@audio/types';

const SQUARE_BLIP = {
  waveform: 'square' as const,
  filter: 1600,
  duration: 0.04,
  gain: 0.18,
};

export const CHIBA_SOUND_PACK: SoundPack = {
  ambient: {
    kind: 'drone',
    params: { pitch: 52, filter: 240, gain: 0.07, duration: 12, loop: true, waveform: 'sawtooth' },
  },
  ui: {
    'tool-select': { kind: 'click', params: { pitch: 900, duration: 0.038, gain: 0.32, filter: 1400 } },
    'panel-open': { kind: 'blip', params: { ...SQUARE_BLIP, pitch: 880, duration: 0.05 } },
    'panel-close': { kind: 'blip', params: { ...SQUARE_BLIP, pitch: 420, filter: 1100 } },
    error: { kind: 'noiseBurst', params: { filter: 700, duration: 0.12, gain: 0.28 } },
    confirm: { kind: 'blip', params: { ...SQUARE_BLIP, pitch: 1320, duration: 0.055 } },
  },
  sim: {
    birth: { kind: 'blip', params: { ...SQUARE_BLIP, pitch: 660, duration: 0.045 } },
  },
};

export const CHIBA_UI_CUES: readonly UiCue[] = [
  'tool-select',
  'panel-open',
  'panel-close',
  'error',
  'confirm',
];
