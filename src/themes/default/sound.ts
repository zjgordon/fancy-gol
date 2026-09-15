/**
 * Default sound pack (P3-C-1): tasteful UI clicks only. No ambient bed, no birth ticks,
 * no texture. A linux-desktop theme does not hum.
 */
import type { SoundPack, UiCue } from '@audio/types';

const CLICK = { duration: 0.032, gain: 0.2 } as const;

const UI: SoundPack['ui'] = {
  'tool-select': { kind: 'click', params: { ...CLICK, pitch: 1100 } },
  'panel-open': { kind: 'click', params: { ...CLICK, pitch: 1400, duration: 0.036 } },
  'panel-close': { kind: 'click', params: { ...CLICK, pitch: 780 } },
  error: { kind: 'click', params: { pitch: 220, duration: 0.05, gain: 0.24, filter: 900 } },
  confirm: { kind: 'blip', params: { pitch: 880, duration: 0.045, gain: 0.22 } },
};

export const DEFAULT_SOUND_PACK: SoundPack = {
  ambient: null,
  ui: UI,
};

export const DEFAULT_UI_CUES: readonly UiCue[] = [
  'tool-select',
  'panel-open',
  'panel-close',
  'error',
  'confirm',
];
