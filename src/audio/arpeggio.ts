/**
 * P3-C-6 — arpeggiated ambient bed whose tempo tracks simulation TPS.
 *
 * Interval changes take effect on the *next* note only — already-armed notes
 * keep their schedule, so a speed-slider move never clicks or restarts the loop.
 */
import type { AudioPolicy } from './policy';
import type { Scheduler } from './scheduler';
import type { ArpeggioSpec, AudioContextLike } from './types';

export interface ArpeggioBedOptions {
  readonly context: AudioContextLike;
  readonly scheduler: Scheduler;
  readonly policy: AudioPolicy;
  readonly spec: ArpeggioSpec;
  /** Horizon (sec) to keep armed ahead of the playhead. */
  readonly horizonSec?: number;
}

/** Notes/sec at `tps`, floored so silence never becomes a machine-gun. */
export function arpeggioNotesPerSec(tps: number, notesPerSecAt60: number): number {
  const rate = notesPerSecAt60 * (Math.max(tps, 0) / 60);
  return Math.min(Math.max(rate, 0.5), 16);
}

export function arpeggioIntervalSec(tps: number, notesPerSecAt60: number): number {
  return 1 / arpeggioNotesPerSec(tps, notesPerSecAt60);
}

export class ArpeggioBed {
  private readonly ctx: AudioContextLike;
  private readonly scheduler: Scheduler;
  private readonly policy: AudioPolicy;
  private readonly spec: ArpeggioSpec;
  private readonly horizonSec: number;

  private tps = 60;
  private intervalSec: number;
  private nextNoteAt: number;
  private noteIndex = 0;
  private disposed = false;
  /** Absolute audio times of notes that were armed (for AC metering). */
  readonly scheduledAt: number[] = [];

  constructor(options: ArpeggioBedOptions) {
    this.ctx = options.context;
    this.scheduler = options.scheduler;
    this.policy = options.policy;
    this.spec = options.spec;
    this.horizonSec = options.horizonSec ?? 0.25;
    this.intervalSec = arpeggioIntervalSec(this.tps, this.spec.notesPerSecAt60);
    this.nextNoteAt = this.ctx.currentTime + 0.02;
  }

  get currentIntervalSec(): number {
    return this.intervalSec;
  }

  get currentNoteIndex(): number {
    return this.noteIndex;
  }

  get currentTps(): number {
    return this.tps;
  }

  /**
   * Update tempo from the simulation speed slider. Does not cancel notes already
   * in the scheduler queue — the new interval applies from the next arm onward.
   */
  setTps(tps: number): void {
    if (this.disposed) return;
    const next = Number.isFinite(tps) ? Math.max(0, tps) : 60;
    if (next === this.tps) return;
    this.tps = next;
    this.intervalSec = arpeggioIntervalSec(this.tps, this.spec.notesPerSecAt60);
  }

  /** Arm notes into the look-ahead horizon. Safe to call every flush / tick. */
  pump(): void {
    if (this.disposed) return;
    if (this.policy.isFullySilent() || !this.policy.canPlayAmbient()) return;
    const notes = this.spec.notes;
    if (notes.length === 0) return;

    const horizon = this.ctx.currentTime + this.horizonSec;
    // Catch up if we fell behind (tab backgrounded) without stacking a burst.
    if (this.nextNoteAt < this.ctx.currentTime - this.intervalSec) {
      this.nextNoteAt = this.ctx.currentTime + 0.01;
    }

    while (this.nextNoteAt <= horizon) {
      const pitch = notes[this.noteIndex % notes.length]!;
      this.scheduler.schedule({
        when: this.nextNoteAt,
        kind: 'pluck',
        bus: 'ambient',
        params: {
          pitch,
          duration: Math.min(this.intervalSec * 0.85, 0.28),
          gain: this.spec.gain ?? 0.05,
          filter: this.spec.filter ?? 1000,
          waveform: this.spec.waveform ?? 'sawtooth',
          ...(this.spec.detune !== undefined ? { detune: this.spec.detune } : {}),
          envelope: { attack: 0.004, decay: 0.08, sustain: 0.02, release: 0.06 },
        },
      });
      this.scheduledAt.push(this.nextNoteAt);
      this.noteIndex += 1;
      this.nextNoteAt += this.intervalSec;
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
