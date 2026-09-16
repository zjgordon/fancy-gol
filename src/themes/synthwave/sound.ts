/**
 * Synthwave sound pack (P3-C-6): analog saw plucks with detune, gated-reverb
 * hits on major UI events, and an arpeggiated ambient bed whose tempo tracks
 * simulation TPS. Zero audio assets.
 */
import type { ArpeggioSpec, SoundPack, UiCue } from '@audio/types';

const SAW_PLUCK = {
  waveform: 'sawtooth' as const,
  duration: 0.22,
  gain: 0.2,
  filter: 2800,
  detune: 12,
  envelope: { attack: 0.004, decay: 0.12, sustain: 0.05, release: 0.1 },
};

/** A minor pentatonic loop in Hz — classic outrun bass climb. */
export const SYNTH_ARP_NOTES: readonly number[] = [110, 131, 147, 165, 196, 165, 147, 131];

export const SYNTH_ARPEGGIO: ArpeggioSpec = {
  notes: SYNTH_ARP_NOTES,
  notesPerSecAt60: 4,
  waveform: 'sawtooth',
  gain: 0.055,
  filter: 900,
  detune: 8,
};

export const SYNTHWAVE_SOUND_PACK: SoundPack = {
  ambient: null,
  arpeggio: SYNTH_ARPEGGIO,
  ui: {
    'tool-select': { kind: 'pluck', params: { ...SAW_PLUCK, pitch: 440 } },
    'panel-open': { kind: 'pluck', params: { ...SAW_PLUCK, pitch: 330, reverb: true } },
    'panel-close': { kind: 'pluck', params: { ...SAW_PLUCK, pitch: 220, filter: 1600 } },
    error: { kind: 'noiseBurst', params: { filter: 700, duration: 0.14, gain: 0.26, reverb: true } },
    confirm: { kind: 'pluck', params: { ...SAW_PLUCK, pitch: 523, duration: 0.35, reverb: true } },
  },
  sim: {
    birth: { kind: 'pluck', params: { ...SAW_PLUCK, pitch: 294, duration: 0.16, gain: 0.14 } },
  },
};

export const SYNTH_UI_CUES: readonly UiCue[] = [
  'tool-select',
  'panel-open',
  'panel-close',
  'error',
  'confirm',
];
