/**
 * P3-B-3 — map simulation + UI events onto voices with rate aggregation.
 *
 * Births collapse into one voice per 50 ms window (pitch/gain ← count, pan ← centroid).
 * Above {@link TEXTURE_RATE_PER_SEC}, discrete ticks cross-fade into a looping noise texture
 * so 10 000 births/sec never becomes a machine-gun. UI cues always play discretely.
 */
import type { AudioPolicy } from './policy';
import type { Scheduler } from './scheduler';
import {
  AGGREGATION_WINDOW_MS,
  TEXTURE_RATE_PER_SEC,
  type AudioContextLike,
  type SoundPack,
  type StereoPannerNodeLike,
  type UiCue,
  type VoiceKind,
  type VoiceParams,
} from './types';
import { getOrCreateNoiseBuffer, spawnVoice, type VoiceHandle } from './voices';
import type { Mixer } from './mixer';

export type { UiCue } from './types';

export interface BirthSample {
  /** Number of births in this sample (may be 1). */
  readonly count: number;
  /** Activity centroid in screen pixels (origin top-left). */
  readonly centroidX: number;
  readonly centroidY: number;
  /** Viewport width used to map centroid → stereo pan. */
  readonly screenWidth: number;
  /** Optional wall-clock stamp; defaults to the mapper clock. */
  readonly atMs?: number;
}

export interface GenerationSample {
  /** Births this generation (glider ≈ a handful). */
  readonly births: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly screenWidth: number;
  readonly atMs?: number;
}

export interface EventMapperClock {
  nowMs(): number;
}

export interface EventMapperOptions {
  readonly context: AudioContextLike;
  readonly mixer: Mixer;
  readonly scheduler: Scheduler;
  readonly policy: AudioPolicy;
  readonly clock?: EventMapperClock;
  readonly windowMs?: number;
  readonly textureRatePerSec?: number;
  /** When set, UI cues and sim enablement come from the pack. Unset keeps P3-B-3 defaults. */
  readonly pack?: SoundPack;
}

const UI_VOICES: Record<UiCue, { kind: VoiceKind; params: VoiceParams }> = {
  'tool-select': { kind: 'click', params: { pitch: 1200, duration: 0.04, gain: 0.3 } },
  'panel-open': { kind: 'sweep', params: { pitch: 300, pitchEnd: 600, duration: 0.12, gain: 0.25 } },
  'panel-close': { kind: 'sweep', params: { pitch: 500, pitchEnd: 220, duration: 0.1, gain: 0.22 } },
  error: { kind: 'noiseBurst', params: { filter: 600, duration: 0.15, gain: 0.35 } },
  confirm: { kind: 'blip', params: { pitch: 660, duration: 0.07, gain: 0.3 } },
};

export class EventMapper {
  private readonly ctx: AudioContextLike;
  private readonly mixer: Mixer;
  private readonly scheduler: Scheduler;
  private readonly policy: AudioPolicy;
  private readonly clock: EventMapperClock;
  private readonly windowMs: number;
  private readonly textureRate: number;

  private windowStartMs = 0;
  private birthCount = 0;
  private weightedX = 0;
  private screenWidth = 1;
  private generationTicks = 0;

  private texture: VoiceHandle | null = null;
  private texturePanner: StereoPannerNodeLike | null = null;
  private textureGain = 0;
  private disposed = false;

  /** Sim voices scheduled (discrete ticks + texture starts). For AC metering. */
  readonly simVoiceTimesMs: number[] = [];
  /** Last pan value applied to a sim voice (−1…1). */
  lastSimPan: number | null = null;
  /** Last discrete sim voice kind (null while texture-only). */
  lastDiscreteKind: VoiceKind | null = null;

  private pack: SoundPack | undefined;

  constructor(options: EventMapperOptions) {
    this.ctx = options.context;
    this.mixer = options.mixer;
    this.scheduler = options.scheduler;
    this.policy = options.policy;
    this.clock = options.clock ?? { nowMs: () => Date.now() };
    this.windowMs = options.windowMs ?? AGGREGATION_WINDOW_MS;
    this.textureRate = options.textureRatePerSec ?? TEXTURE_RATE_PER_SEC;
    this.pack = options.pack;
    this.windowStartMs = this.clock.nowMs();
  }

  /** Hot-swap the active theme's pack. A UI-only pack silences sim voices on the next flush. */
  setPack(pack: SoundPack | undefined): void {
    this.pack = pack;
    if (pack && pack.sim === undefined) this.stopTexture();
  }

  /**
   * Stream raw birth samples. Collapsed on {@link flush} / window rollover.
   */
  noteBirths(sample: BirthSample): void {
    this.ensureAlive();
    if (this.policy.isFullySilent() || !this.simEnabled()) return;
    const at = sample.atMs ?? this.clock.nowMs();
    this.rollWindow(at);
    if (sample.count <= 0) return;
    this.birthCount += sample.count;
    this.weightedX += sample.centroidX * sample.count;
    this.screenWidth = Math.max(1, sample.screenWidth);
  }

  /**
   * One simulation generation. A solitary glider step becomes one clean tick
   * (still coalesced if many gens fall inside the same aggregation window).
   */
  noteGeneration(sample: GenerationSample): void {
    this.ensureAlive();
    if (this.policy.isFullySilent() || !this.simEnabled()) return;
    if (sample.births <= 0) return;
    this.generationTicks += 1;
    this.noteBirths({
      count: sample.births,
      centroidX: sample.centroidX,
      centroidY: sample.centroidY,
      screenWidth: sample.screenWidth,
      ...(sample.atMs !== undefined ? { atMs: sample.atMs } : {}),
    });
  }

  /** UI cues always schedule discretely (still subject to mute / reduced-motion). */
  noteUi(cue: UiCue): void {
    this.ensureAlive();
    if (this.policy.isFullySilent()) return;
    const mapping = this.pack?.ui[cue] ?? UI_VOICES[cue];
    if (!mapping) return;
    this.scheduler.schedule({
      when: this.ctx.currentTime,
      kind: mapping.kind,
      bus: 'event',
      ...(mapping.params ? { params: mapping.params } : {}),
    });
  }

  /**
   * Close the current aggregation window and emit at most one sim voice
   * (or update the texture bed). Safe to call every frame.
   */
  flush(atMs: number = this.clock.nowMs()): void {
    this.ensureAlive();
    if (this.policy.isFullySilent()) {
      this.stopTexture();
      this.resetWindow(atMs);
      return;
    }
    this.rollWindow(atMs, true);
  }

  /** Voices scheduled for sim in the last `durationMs` wall-clock window. */
  simVoicesPerSec(durationMs: number, nowMs: number = this.clock.nowMs()): number {
    const from = nowMs - durationMs;
    const n = this.simVoiceTimesMs.filter((t) => t >= from && t <= nowMs).length;
    return durationMs <= 0 ? 0 : (n * 1000) / durationMs;
  }

  get textureActive(): boolean {
    return this.texture !== null && !this.texture.stopped;
  }

  get texturePanNode(): StereoPannerNodeLike | null {
    return this.texturePanner;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTexture();
    this.resetWindow(this.clock.nowMs());
  }

  private simEnabled(): boolean {
    return this.pack === undefined || this.pack.sim !== undefined;
  }

  private rollWindow(atMs: number, force = false): void {
    if (!force && atMs - this.windowStartMs < this.windowMs) return;
    if (this.birthCount > 0 || this.textureActive) {
      this.emitWindow(atMs);
    }
    this.resetWindow(atMs);
  }

  private emitWindow(atMs: number): void {
    const elapsedSec = Math.max(this.windowMs / 1000, 0.001);
    const rate = this.birthCount / elapsedSec;
    const pan = this.computePan();
    this.lastSimPan = pan;

    if (rate >= this.textureRate) {
      this.lastDiscreteKind = null;
      this.ensureTexture(rate, pan, atMs);
      // Texture updates do not count as new voices after the first start —
      // one stable bed keeps us well under MAX_SIM_VOICES_PER_SEC.
      return;
    }

    this.stopTexture();
    if (this.birthCount <= 0) return;

    // Cap: at most one discrete voice per window ⇒ ≤ 1000/windowMs = 20/sec.
    const pitch = 220 + Math.min(this.birthCount, 64) * 12;
    const gain = Math.min(0.15 + Math.log2(1 + this.birthCount) * 0.05, 0.55);
    const kind: VoiceKind = this.generationTicks === 1 && this.birthCount <= 8 ? 'blip' : 'click';

    this.scheduler.schedule({
      when: this.ctx.currentTime,
      kind,
      bus: 'event',
      pan,
      params: {
        pitch,
        gain,
        duration: kind === 'blip' ? 0.06 : 0.04,
      },
    });
    this.lastDiscreteKind = kind;
    this.simVoiceTimesMs.push(atMs);
  }

  private ensureTexture(rate: number, pan: number, atMs: number): void {
    const now = this.ctx.currentTime;
    const targetGain = Math.min(0.12 + Math.log10(1 + rate / this.textureRate) * 0.15, 0.45);
    const filterHz = Math.min(800 + rate * 0.05, 4000);

    if (!this.texture || this.texture.stopped) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, now);
      panner.connect(this.mixer.bus('ambient'));
      this.texturePanner = panner;

      // Allocate a policy slot; stop any stolen voice through the scheduler.
      const alloc = this.policy.allocateVoice(atMs);
      if (alloc.stealId !== undefined) this.scheduler.stopVoice(alloc.stealId);

      this.texture = spawnVoice({
        context: this.ctx,
        destination: panner,
        kind: 'noiseBurst',
        id: alloc.id,
        when: now,
        params: {
          loop: true,
          duration: 60,
          gain: targetGain,
          filter: filterHz,
          envelope: { attack: 0.08, decay: 0.05, sustain: 1, release: 0.2 },
        },
        noiseBuffer: getOrCreateNoiseBuffer(this.ctx, 0.25),
      });
      this.textureGain = targetGain;
      this.simVoiceTimesMs.push(atMs);
      return;
    }

    // Modulate the live bed — no new voice.
    if (this.texturePanner) {
      this.texturePanner.pan.setValueAtTime(pan, now);
    }
    if (this.texture.graph.filter) {
      this.texture.graph.filter.frequency.setValueAtTime(filterHz, now);
    }
    const g = this.texture.graph.envelope.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(this.textureGain, 0.0001), now);
    g.linearRampToValueAtTime(Math.max(targetGain, 0.0001), now + 0.05);
    this.textureGain = targetGain;
  }

  private stopTexture(): void {
    if (!this.texture) return;
    const id = this.texture.id;
    this.texture.stop();
    this.policy.releaseVoice(id);
    this.texture = null;
    try {
      this.texturePanner?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.texturePanner = null;
    this.textureGain = 0;
  }

  private computePan(): number {
    if (this.birthCount <= 0) return 0;
    const x = this.weightedX / this.birthCount;
    // Map [0, screenWidth] → [-1, 1]
    return clampPan((x / this.screenWidth) * 2 - 1);
  }

  private resetWindow(atMs: number): void {
    this.windowStartMs = atMs;
    this.birthCount = 0;
    this.weightedX = 0;
    this.generationTicks = 0;
  }

  private ensureAlive(): void {
    if (this.disposed) throw new Error('audio: EventMapper disposed');
  }
}

function clampPan(v: number): number {
  if (!(v >= -1)) return -1;
  if (v > 1) return 1;
  return v;
}
