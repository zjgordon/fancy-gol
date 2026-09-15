/**
 * P3-B-1 — public audio types (ADR-009: `themes/` may import `audio/types` only).
 *
 * Narrow surfaces so unit tests can inject graph doubles without a real AudioContext.
 */

export type AudioContextState = 'suspended' | 'running' | 'closed';

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

export interface AudioNodeLike {
  connect(dest: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

export interface AudioContextLike {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike;

export type AudioBusId = 'master' | 'ambient' | 'event';

export interface AudioPrefs {
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly ambientVolume: number;
  readonly eventVolume: number;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  muted: true,
  masterVolume: 0.7,
  ambientVolume: 0.5,
  eventVolume: 0.8,
};

/** Hard cap for concurrent voices (P3-B-2 / §2.5). Enforced here as policy constant. */
export const VOICE_CAP = 24;

/** Short mute ramp — short enough to feel instant, long enough to avoid a click. */
export const MUTE_RAMP_SEC = 0.012;
