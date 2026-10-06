/**
 * P3-E-8 — `ArpeggioBed` on its own (P3-C-6 only exercised it through Synthwave).
 *
 * Branch coverage of `src/audio/**` had been under its 90% bar all phase, hidden behind failing
 * wall-clock tests; most of the gap was this module's guards and spec defaults.
 */
import { describe, expect, it } from 'vitest';
import { ArpeggioBed, arpeggioIntervalSec, arpeggioNotesPerSec } from '@audio/arpeggio';
import type { AudioPolicy } from '@audio/policy';
import type { Scheduler } from '@audio/scheduler';
import type { ArpeggioSpec } from '@audio/types';
import { FakeAudioContext } from './fakes';

interface Scheduled {
  readonly when: number;
  readonly kind: string;
  readonly bus: string;
  readonly params: Record<string, unknown>;
}

function rig(opts: { silent?: boolean; canAmbient?: boolean; spec?: Partial<ArpeggioSpec> } = {}) {
  const ctx = new FakeAudioContext();
  const events: Scheduled[] = [];
  const scheduler = { schedule: (e: Scheduled) => void events.push(e) } as unknown as Scheduler;
  const state = { silent: opts.silent ?? false, canAmbient: opts.canAmbient ?? true };
  const policy = {
    isFullySilent: () => state.silent,
    canPlayAmbient: () => state.canAmbient,
  } as unknown as AudioPolicy;
  const spec = { notes: [110, 165, 220], notesPerSecAt60: 4, ...opts.spec } as ArpeggioSpec;
  const bed = new ArpeggioBed({ context: ctx, scheduler, policy, spec, horizonSec: 1 });
  return { ctx, events, state, bed };
}

describe('arpeggio tempo maths', () => {
  it('clamps the note rate to 0.5–16 per second so silence is never a machine-gun', () => {
    expect(arpeggioNotesPerSec(0, 4)).toBe(0.5);
    expect(arpeggioNotesPerSec(-30, 4)).toBe(0.5);
    expect(arpeggioNotesPerSec(60, 4)).toBe(4);
    expect(arpeggioNotesPerSec(100_000, 4)).toBe(16);
    expect(arpeggioIntervalSec(0, 4)).toBe(2);
  });
});

describe('ArpeggioBed.setTps', () => {
  it('ignores a repeat of the current tempo, and treats non-finite input as 60', () => {
    const { bed } = rig();
    const interval = bed.currentIntervalSec;
    bed.setTps(60);
    expect(bed.currentIntervalSec).toBe(interval);
    bed.setTps(120);
    expect(bed.currentTps).toBe(120);
    bed.setTps(Number.NaN);
    expect(bed.currentTps).toBe(60);
    bed.setTps(Number.POSITIVE_INFINITY);
    expect(bed.currentTps).toBe(60);
  });

  it('floors a negative tempo at zero (the slowest bed, not a negative interval)', () => {
    const { bed } = rig();
    bed.setTps(-5);
    expect(bed.currentTps).toBe(0);
    expect(bed.currentIntervalSec).toBe(arpeggioIntervalSec(0, 4));
  });

  it('does nothing once disposed', () => {
    const { bed } = rig();
    bed.dispose();
    bed.setTps(240);
    expect(bed.currentTps).toBe(60);
  });
});

describe('ArpeggioBed.pump guards', () => {
  it('arms nothing when disposed, silenced, ambient-blocked, or given no notes', () => {
    const disposed = rig();
    disposed.bed.dispose();
    disposed.bed.pump();
    expect(disposed.events).toHaveLength(0);

    const silent = rig({ silent: true });
    silent.bed.pump();
    expect(silent.events).toHaveLength(0);

    const blocked = rig({ canAmbient: false });
    blocked.bed.pump();
    expect(blocked.events).toHaveLength(0);

    const empty = rig({ spec: { notes: [] } });
    empty.bed.pump();
    expect(empty.events).toHaveLength(0);
  });

  it('resumes arming when the policy allows it again', () => {
    const r = rig({ silent: true });
    r.bed.pump();
    expect(r.events).toHaveLength(0);
    r.state.silent = false;
    r.bed.pump();
    expect(r.events.length).toBeGreaterThan(0);
  });
});

describe('ArpeggioBed.pump scheduling', () => {
  it('catches up after falling behind without stacking a burst of past notes', () => {
    const r = rig();
    r.bed.pump();
    const armed = r.events.length;
    // The tab was backgrounded for ten seconds: the play-head is far past the last armed note.
    r.ctx.currentTime += 10;
    r.bed.pump();
    const resumed = r.events.slice(armed);
    expect(resumed.length).toBeGreaterThan(0);
    expect(resumed[0]!.when).toBeGreaterThanOrEqual(r.ctx.currentTime); // nothing in the past
    expect(resumed.length).toBeLessThanOrEqual(Math.ceil(1 / r.bed.currentIntervalSec) + 1); // one horizon's worth
  });

  it('cycles through the notes in order and wraps', () => {
    const r = rig();
    r.bed.pump();
    const pitches = r.events.map((e) => e.params['pitch']);
    expect(pitches.slice(0, 4)).toEqual([110, 165, 220, 110]);
  });

  it('applies the defaults for an under-specified spec, and omits detune', () => {
    const r = rig();
    r.bed.pump();
    const p = r.events[0]!.params;
    expect(r.events[0]!.kind).toBe('pluck');
    expect(r.events[0]!.bus).toBe('ambient');
    expect(p['gain']).toBe(0.05);
    expect(p['filter']).toBe(1000);
    expect(p['waveform']).toBe('sawtooth');
    expect('detune' in p).toBe(false);
  });

  it('passes through an explicit gain, filter, waveform and detune', () => {
    const r = rig({ spec: { gain: 0.2, filter: 2400, waveform: 'square', detune: 7 } });
    r.bed.pump();
    const p = r.events[0]!.params;
    expect(p['gain']).toBe(0.2);
    expect(p['filter']).toBe(2400);
    expect(p['waveform']).toBe('square');
    expect(p['detune']).toBe(7);
  });

  it('caps a note at 0.28 s however slow the tempo', () => {
    const slow = rig();
    slow.bed.setTps(0); // 2 s interval
    slow.bed.pump();
    expect(slow.events[0]!.params['duration']).toBe(0.28);
    const fast = rig();
    fast.bed.setTps(240); // 0.0625 s interval
    fast.bed.pump();
    expect(fast.events[0]!.params['duration'] as number).toBeCloseTo(0.0625 * 0.85, 6);
  });
});
