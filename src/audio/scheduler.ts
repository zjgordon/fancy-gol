/**
 * P3-B-2 — look-ahead voice scheduler.
 *
 * Arms voices against the AudioContext clock on a 25 ms tick with a 100 ms horizon.
 * Never calls `source.start()` from a bare `setTimeout` — that jitter is audible.
 */
import type { AudioPolicy } from './policy';
import {
  SCHEDULER_HORIZON_SEC,
  SCHEDULER_INTERVAL_MS,
  type AudioBusId,
  type AudioContextLike,
  type VoiceKind,
  type VoiceParams,
} from './types';
import { getOrCreateNoiseBuffer, spawnVoice, type VoiceHandle } from './voices';
import type { Mixer } from './mixer';

export interface ScheduleRequest {
  /** Absolute AudioContext time. */
  readonly when: number;
  readonly kind: VoiceKind;
  readonly bus?: Exclude<AudioBusId, 'master'>;
  readonly params?: VoiceParams;
}

export interface SchedulerClock {
  /** Wall-clock ms (for voice-age / steal ordering). */
  nowMs(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface SchedulerOptions {
  readonly context: AudioContextLike;
  readonly mixer: Mixer;
  readonly policy: AudioPolicy;
  readonly clock?: SchedulerClock;
  readonly intervalMs?: number;
  readonly horizonSec?: number;
}

const DEFAULT_CLOCK: SchedulerClock = {
  nowMs: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export class Scheduler {
  private readonly ctx: AudioContextLike;
  private readonly mixer: Mixer;
  private readonly policy: AudioPolicy;
  private readonly clock: SchedulerClock;
  private readonly intervalMs: number;
  private readonly horizonSec: number;
  private readonly queue: ScheduleRequest[] = [];
  private readonly live = new Map<number, VoiceHandle>();
  private timer: unknown = null;
  private disposed = false;
  /** Absolute audio times at which voices actually started (for timing ACs). */
  readonly startedAt: number[] = [];

  constructor(options: SchedulerOptions) {
    this.ctx = options.context;
    this.mixer = options.mixer;
    this.policy = options.policy;
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.intervalMs = options.intervalMs ?? SCHEDULER_INTERVAL_MS;
    this.horizonSec = options.horizonSec ?? SCHEDULER_HORIZON_SEC;
  }

  get liveCount(): number {
    return this.live.size;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  /** Enqueue a voice at an absolute AudioContext time. */
  schedule(request: ScheduleRequest): void {
    this.ensureAlive();
    this.queue.push(request);
    // Keep soonest-first so the tick can bail early.
    this.queue.sort((a, b) => a.when - b.when);
  }

  /** Convenience: schedule relative to the current playhead. */
  scheduleIn(
    delaySec: number,
    kind: VoiceKind,
    params?: VoiceParams,
    bus?: Exclude<AudioBusId, 'master'>,
  ): void {
    const request: ScheduleRequest = {
      when: this.ctx.currentTime + Math.max(0, delaySec),
      kind,
      ...(params !== undefined ? { params } : {}),
      ...(bus !== undefined ? { bus } : {}),
    };
    this.schedule(request);
  }

  start(): void {
    this.ensureAlive();
    if (this.timer !== null) return;
    this.timer = this.clock.setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      this.clock.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Arm every queued event whose `when` falls inside `[now, now + horizon]`.
   * Safe to call from tests without starting the interval.
   */
  tick(): void {
    this.ensureAlive();
    this.reapFinished();
    const now = this.ctx.currentTime;
    const horizon = now + this.horizonSec;

    while (this.queue.length > 0) {
      const next = this.queue[0]!;
      if (next.when > horizon) break;
      this.queue.shift();
      this.arm(next);
    }
  }

  /** Stop a live voice by id (steal / external cancel). */
  stopVoice(id: number): void {
    const handle = this.live.get(id);
    if (!handle) return;
    handle.stop();
    this.live.delete(id);
    this.policy.releaseVoice(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.queue.length = 0;
    for (const handle of this.live.values()) handle.stop();
    this.live.clear();
  }

  private arm(request: ScheduleRequest): void {
    if (this.policy.isMuted()) return;

    const busId = request.bus ?? defaultBus(request.kind);
    if (busId === 'ambient' && !this.policy.canPlayAmbient()) return;
    // Event bus is gated by mute (and future policy); keep the check for symmetry with ambient.
    if (busId === 'event' && !this.policy.canPlayEvent()) return;

    const alloc = this.policy.allocateVoice(this.clock.nowMs());
    if (alloc.stealId !== undefined) this.stopVoice(alloc.stealId);

    const handle = spawnVoice({
      context: this.ctx,
      destination: this.mixer.bus(busId),
      kind: request.kind,
      id: alloc.id,
      when: request.when,
      ...(request.params !== undefined ? { params: request.params } : {}),
      ...(needsNoise(request.kind)
        ? {
            noiseBuffer: getOrCreateNoiseBuffer(
              this.ctx,
              request.kind === 'click' ? 0.02 : 0.25,
            ),
          }
        : {}),
    });
    this.live.set(handle.id, handle);
    this.startedAt.push(handle.startTime);
  }

  private reapFinished(): void {
    const now = this.ctx.currentTime;
    for (const [id, handle] of this.live) {
      if (handle.stopped || now >= handle.stopTime) {
        if (!handle.stopped) handle.stop();
        this.live.delete(id);
        this.policy.releaseVoice(id);
      }
    }
  }

  private ensureAlive(): void {
    if (this.disposed) throw new Error('audio: Scheduler disposed');
  }
}

function defaultBus(kind: VoiceKind): Exclude<AudioBusId, 'master'> {
  return kind === 'pad' || kind === 'drone' ? 'ambient' : 'event';
}

function needsNoise(kind: VoiceKind): boolean {
  return kind === 'click' || kind === 'noiseBurst';
}
