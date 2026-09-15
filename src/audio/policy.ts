/**
 * P3-B-1 — audio policy: mute/volume prefs, reduced-motion ambient silence, voice cap.
 *
 * Starts muted by default. Persistence degrades when storage is unavailable (never throws).
 */
import {
  DEFAULT_AUDIO_PREFS,
  VOICE_CAP,
  type AudioPrefs,
} from './types';

export interface AudioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ReducedMotionQuery = () => boolean;

export interface AudioPolicyOptions {
  readonly storage?: AudioStorage | null;
  readonly reducedMotion?: ReducedMotionQuery;
  readonly prefs?: Partial<AudioPrefs>;
}

const STORAGE_KEY = 'gol.audio';

export function realAudioStorage(): AudioStorage | null {
  try {
    const store = (globalThis as { localStorage?: AudioStorage }).localStorage;
    if (!store) return null;
    const probe = '__gol_audio_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

const SYSTEM_REDUCED_MOTION: ReducedMotionQuery = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class AudioPolicy {
  private readonly storage: AudioStorage | null;
  private readonly reducedMotion: ReducedMotionQuery;
  private prefs: AudioPrefs;
  /** Generation counter for oldest-first voice stealing (P3-B-2 consumes this). */
  private nextVoiceId = 1;
  private readonly liveVoices = new Map<number, number>(); // id → bornAtMs

  constructor(options: AudioPolicyOptions = {}) {
    this.storage = options.storage === undefined ? realAudioStorage() : options.storage;
    this.reducedMotion = options.reducedMotion ?? SYSTEM_REDUCED_MOTION;
    this.prefs = {
      ...DEFAULT_AUDIO_PREFS,
      ...loadPrefs(this.storage),
      ...options.prefs,
    };
  }

  getPrefs(): AudioPrefs {
    return this.prefs;
  }

  isMuted(): boolean {
    return this.prefs.muted;
  }

  /** Ambient bed is silent when muted or when reduced motion is preferred. */
  canPlayAmbient(): boolean {
    return !this.prefs.muted && !this.reducedMotion();
  }

  /** Discrete UI / event cues — silenced only by mute (reduced motion still allows them). */
  canPlayEvent(): boolean {
    return !this.prefs.muted;
  }

  setMuted(muted: boolean): void {
    this.prefs = { ...this.prefs, muted };
    this.persist();
  }

  setMasterVolume(volume: number): void {
    this.prefs = { ...this.prefs, masterVolume: clamp01(volume) };
    this.persist();
  }

  setAmbientVolume(volume: number): void {
    this.prefs = { ...this.prefs, ambientVolume: clamp01(volume) };
    this.persist();
  }

  setEventVolume(volume: number): void {
    this.prefs = { ...this.prefs, eventVolume: clamp01(volume) };
    this.persist();
  }

  get voiceCap(): number {
    return VOICE_CAP;
  }

  get liveVoiceCount(): number {
    return this.liveVoices.size;
  }

  /**
   * Register a voice. When at capacity, returns the oldest voice id to steal (caller stops it),
   * then registers the new id. Returns `{ id, stealId? }`.
   */
  allocateVoice(nowMs: number = Date.now()): { readonly id: number; readonly stealId?: number } {
    let stealId: number | undefined;
    if (this.liveVoices.size >= VOICE_CAP) {
      let oldestId = -1;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [id, born] of this.liveVoices) {
        if (born < oldestAt) {
          oldestAt = born;
          oldestId = id;
        }
      }
      if (oldestId >= 0) {
        this.liveVoices.delete(oldestId);
        stealId = oldestId;
      }
    }
    const id = this.nextVoiceId++;
    this.liveVoices.set(id, nowMs);
    return stealId === undefined ? { id } : { id, stealId };
  }

  releaseVoice(id: number): void {
    this.liveVoices.delete(id);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* quota / private mode — degrade silently */
    }
  }
}

function loadPrefs(storage: AudioStorage | null): Partial<AudioPrefs> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      ...(typeof parsed.muted === 'boolean' ? { muted: parsed.muted } : {}),
      ...(typeof parsed.masterVolume === 'number' ? { masterVolume: clamp01(parsed.masterVolume) } : {}),
      ...(typeof parsed.ambientVolume === 'number' ? { ambientVolume: clamp01(parsed.ambientVolume) } : {}),
      ...(typeof parsed.eventVolume === 'number' ? { eventVolume: clamp01(parsed.eventVolume) } : {}),
    };
  } catch {
    return {};
  }
}

function clamp01(v: number): number {
  if (!(v >= 0)) return 0;
  if (v > 1) return 1;
  return v;
}
