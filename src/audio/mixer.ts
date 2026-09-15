/**
 * P3-B-1 — mixer graph: ambient + event buses → master → limiter → destination.
 *
 * All gain changes use short linear ramps (never a raw `gain.value =` click).
 */
import type { AudioContextLike, AudioBusId, GainNodeLike, DynamicsCompressorNodeLike } from './types';
import { MUTE_RAMP_SEC } from './types';

export interface MixerOptions {
  readonly context: AudioContextLike;
  /** Master ceiling before the limiter. Default 0.7. */
  readonly masterGain?: number;
  readonly ambientGain?: number;
  readonly eventGain?: number;
}

export class Mixer {
  readonly master: GainNodeLike;
  readonly ambient: GainNodeLike;
  readonly event: GainNodeLike;
  readonly limiter: DynamicsCompressorNodeLike;
  private readonly ctx: AudioContextLike;
  private muted = false;
  private masterLevel: number;
  private ambientLevel: number;
  private eventLevel: number;
  private disposed = false;

  constructor(options: MixerOptions) {
    this.ctx = options.context;
    this.masterLevel = clamp01(options.masterGain ?? 0.7);
    this.ambientLevel = clamp01(options.ambientGain ?? 0.5);
    this.eventLevel = clamp01(options.eventGain ?? 0.8);

    this.master = this.ctx.createGain();
    this.ambient = this.ctx.createGain();
    this.event = this.ctx.createGain();
    this.limiter = this.ctx.createDynamicsCompressor();

    // Brick-wall-ish limiter so no theme can be painfully loud.
    const t = this.ctx.currentTime;
    this.limiter.threshold.setValueAtTime(-12, t);
    this.limiter.knee.setValueAtTime(6, t);
    this.limiter.ratio.setValueAtTime(12, t);
    this.limiter.attack.setValueAtTime(0.003, t);
    this.limiter.release.setValueAtTime(0.1, t);

    this.ambient.connect(this.master);
    this.event.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    this.applyGain('master', this.masterLevel, 0);
    this.applyGain('ambient', this.ambientLevel, 0);
    this.applyGain('event', this.eventLevel, 0);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  getMasterLevel(): number {
    return this.masterLevel;
  }

  getAmbientLevel(): number {
    return this.ambientLevel;
  }

  getEventLevel(): number {
    return this.eventLevel;
  }

  /**
   * Mute or unmute. Mute ramps master to 0 over {@link MUTE_RAMP_SEC}; unmute restores the
   * remembered master level with the same short ramp (never a hard click).
   */
  setMuted(muted: boolean): void {
    this.ensureAlive();
    if (muted === this.muted) return;
    this.muted = muted;
    this.applyGain('master', muted ? 0 : this.masterLevel, MUTE_RAMP_SEC);
  }

  setMasterLevel(level: number): void {
    this.ensureAlive();
    this.masterLevel = clamp01(level);
    if (!this.muted) this.applyGain('master', this.masterLevel, MUTE_RAMP_SEC);
  }

  setAmbientLevel(level: number): void {
    this.ensureAlive();
    this.ambientLevel = clamp01(level);
    this.applyGain('ambient', this.ambientLevel, MUTE_RAMP_SEC);
  }

  setEventLevel(level: number): void {
    this.ensureAlive();
    this.eventLevel = clamp01(level);
    this.applyGain('event', this.eventLevel, MUTE_RAMP_SEC);
  }

  bus(id: Exclude<AudioBusId, 'master'>): GainNodeLike {
    return id === 'ambient' ? this.ambient : this.event;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.ambient.disconnect();
      this.event.disconnect();
      this.master.disconnect();
      this.limiter.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private applyGain(bus: AudioBusId, level: number, rampSec: number): void {
    const node = bus === 'master' ? this.master : bus === 'ambient' ? this.ambient : this.event;
    const param = node.gain;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    if (rampSec <= 0) {
      param.setValueAtTime(level, now);
    } else {
      param.linearRampToValueAtTime(level, now + rampSec);
    }
  }

  private ensureAlive(): void {
    if (this.disposed) throw new Error('audio: Mixer disposed');
  }
}

function clamp01(v: number): number {
  if (!(v >= 0)) return 0;
  if (v > 1) return 1;
  return v;
}
