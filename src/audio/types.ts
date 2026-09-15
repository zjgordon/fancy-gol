/**
 * P3-B-1 / P3-B-2 — public audio types (ADR-009: `themes/` may import `audio/types` only).
 *
 * Narrow surfaces so unit tests can inject graph doubles without a real AudioContext.
 */

export type AudioContextState = 'suspended' | 'running' | 'closed';

export type OscillatorTypeName = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type BiquadFilterTypeName =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'notch'
  | 'allpass'
  | 'peaking'
  | 'lowshelf'
  | 'highshelf';

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
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

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorTypeName;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterTypeName;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
  readonly gain: AudioParamLike;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

export interface AudioContextLike {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike;

export type AudioBusId = 'master' | 'ambient' | 'event';

export type VoiceKind =
  | 'blip'
  | 'click'
  | 'sweep'
  | 'noiseBurst'
  | 'pluck'
  | 'pad'
  | 'drone';

/** Discrete UI cues a theme's sound pack may map. Shared with `events.ts`. */
export type UiCue = 'tool-select' | 'panel-open' | 'panel-close' | 'error' | 'confirm';

/** One synthesised cue: a voice kind plus optional overrides. */
export interface SoundCue {
  readonly kind: VoiceKind;
  readonly params?: VoiceParams;
}

/**
 * A theme's synthesised sound pack (ADR-008, P3-C-*). Zero audio assets — every cue is a
 * `VoiceKind`. `ambient: null` is an explicit "no bed" (Default), not an omitted field.
 * `sim` omitted means the pack is UI-only; EventMapper then skips birth ticks / texture.
 */
export interface SoundPack {
  readonly ambient: SoundCue | null;
  readonly ui: Partial<Record<UiCue, SoundCue>>;
  readonly sim?: {
    readonly birth?: SoundCue;
    readonly generation?: SoundCue;
  };
}

export interface VoiceEnvelope {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

export interface VoiceParams {
  readonly pitch?: number;
  readonly duration?: number;
  readonly filter?: number;
  readonly gain?: number;
  readonly envelope?: Partial<VoiceEnvelope>;
  /** Sweep end pitch (Hz). Only used by `sweep`. */
  readonly pitchEnd?: number;
  /** Loop buffer sources (texture beds). */
  readonly loop?: boolean;
  /** Oscillator waveform override (Chiba square-wave blips). */
  readonly waveform?: OscillatorTypeName;
}

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

/** Look-ahead scheduler tick (P3-B-2). */
export const SCHEDULER_INTERVAL_MS = 25;

/** How far ahead of the playhead voices are armed (P3-B-2). */
export const SCHEDULER_HORIZON_SEC = 0.1;

/** Birth aggregation window (P3-B-3). */
export const AGGREGATION_WINDOW_MS = 50;

/**
 * Births/sec at or above this → continuous texture instead of discrete ticks (P3-B-3).
 * 10 000 births/sec collapses to ≤ 20 voices/sec (one texture update per window).
 */
export const TEXTURE_RATE_PER_SEC = 400;

/** Hard ceiling on sim voice emission rate (P3-B-3 AC). */
export const MAX_SIM_VOICES_PER_SEC = 20;
