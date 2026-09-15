import { describe, expect, it, vi } from 'vitest';
import { Mixer } from '../../../src/audio/mixer';
import { AudioPolicy } from '../../../src/audio/policy';
import { Scheduler } from '../../../src/audio/scheduler';
import {
  SCHEDULER_HORIZON_SEC,
  SCHEDULER_INTERVAL_MS,
  VOICE_CAP,
  type VoiceKind,
} from '../../../src/audio/types';
import { spawnVoice } from '../../../src/audio/voices';
import {
  FakeAudioContext,
  ManualClock,
  MemoryStorage,
} from './fakes';
import type { FakeBufferSource, FakeOscillator } from './fakes';

const VOICE_KINDS: readonly VoiceKind[] = [
  'blip',
  'click',
  'sweep',
  'noiseBurst',
  'pluck',
  'pad',
  'drone',
];

describe('voices (P3-B-2)', () => {
  it.each(VOICE_KINDS)('%s builds an inspectable node graph and schedules start/stop', (kind) => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 1;
    const dest = ctx.createGain();
    const voice = spawnVoice({
      context: ctx,
      destination: dest,
      kind,
      id: 1,
      when: 1.05,
      params: { pitch: 440, duration: 0.2, filter: 1500, gain: 0.5, pitchEnd: 880 },
    });

    expect(voice.kind).toBe(kind);
    expect(voice.graph.kind).toBe(kind);
    expect(voice.graph.destination).toBe(dest);
    expect((voice.graph.envelope as unknown as { connections: unknown[] }).connections).toContain(
      dest,
    );
    expect(voice.startTime).toBeCloseTo(1.05, 5);

    const source = voice.graph.source as FakeOscillator | FakeBufferSource;
    expect(source.startedAt).toBeCloseTo(1.05, 5);
    expect(source.stoppedAt).not.toBeNull();
    expect(source.stoppedAt!).toBeGreaterThan(voice.startTime);

    if (kind === 'click' || kind === 'noiseBurst') {
      expect(voice.graph.filter).not.toBeNull();
      expect(ctx.createBufferSourceCount).toBeGreaterThanOrEqual(1);
      expect(source.connections.length).toBeGreaterThanOrEqual(1);
    } else {
      expect(ctx.createOscillatorCount).toBeGreaterThanOrEqual(1);
      if (kind === 'pluck' || kind === 'pad' || kind === 'drone') {
        expect(voice.graph.filter).not.toBeNull();
        expect(source.connections).toContain(voice.graph.filter);
      } else if (kind === 'blip' && voice.graph.filter) {
        expect(source.connections).toContain(voice.graph.filter);
      } else {
        // sweep (and unfiltered blip) go straight into the envelope
        expect(source.connections).toContain(voice.graph.envelope);
      }
    }

    if (kind === 'sweep') {
      const osc = source as FakeOscillator;
      const kinds = osc.frequency.events.map((e) => e.kind);
      expect(kinds).toContain('expo');
    }

    voice.stop();
    expect(voice.stopped).toBe(true);
    voice.stop(); // idempotent
  });

  it('clamps when into the future relative to currentTime', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 5;
    const dest = ctx.createGain();
    const voice = spawnVoice({
      context: ctx,
      destination: dest,
      kind: 'blip',
      id: 2,
      when: 1, // in the past
    });
    expect(voice.startTime).toBe(5);
  });

  it('uses defaults, caches noise buffers, and sustains fully when sustain ≈ 1', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const a = spawnVoice({ context: ctx, destination: dest, kind: 'click', id: 1, when: 0 });
    const buffersBefore = ctx.createBufferCount;
    const b = spawnVoice({ context: ctx, destination: dest, kind: 'click', id: 2, when: 0 });
    expect(ctx.createBufferCount).toBe(buffersBefore); // cached
    expect(a.graph.source).not.toBe(b.graph.source);

    const pad = spawnVoice({
      context: ctx,
      destination: dest,
      kind: 'pad',
      id: 3,
      when: 0,
      params: {
        pitch: 0,
        duration: -1,
        filter: Number.NaN,
        gain: 2,
        envelope: { attack: 0.01, decay: 0.01, sustain: 1, release: 0.05 },
      },
    });
    const gainEvents = (pad.graph.envelope.gain as unknown as { events: { kind: string }[] })
      .events;
    expect(gainEvents.some((e) => e.kind === 'expo')).toBe(true);
    a.stop();
    b.stop();
    pad.stop();
  });

  it('stop swallows source/param errors', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const voice = spawnVoice({
      context: ctx,
      destination: dest,
      kind: 'blip',
      id: 9,
      when: 0,
    });
    const source = voice.graph.source as FakeOscillator;
    source.stop = () => {
      throw new Error('already stopped');
    };
    source.disconnect = () => {
      throw new Error('gone');
    };
    voice.graph.envelope.gain.cancelScheduledValues = () => {
      throw new Error('cancel fail');
    };
    expect(() => voice.stop()).not.toThrow();
    expect(voice.stopped).toBe(true);
  });
});

describe('Scheduler (P3-B-2)', () => {
  function harness(unmuted = true) {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    const storage = new MemoryStorage();
    const policy = new AudioPolicy({
      storage,
      reducedMotion: () => false,
      prefs: { muted: !unmuted },
    });
    const clock = new ManualClock();
    const scheduler = new Scheduler({
      context: ctx,
      mixer,
      policy,
      clock,
      intervalMs: SCHEDULER_INTERVAL_MS,
      horizonSec: SCHEDULER_HORIZON_SEC,
    });
    return { ctx, mixer, policy, clock, scheduler };
  }

  it(`arms events within ${SCHEDULER_HORIZON_SEC * 1000} ms and lands within 5 ms under a 60 fps load`, () => {
    const { ctx, clock, scheduler } = harness();
    const intended: number[] = [];
    // Schedule a train of blips over 500 ms of audio time.
    for (let i = 0; i < 20; i++) {
      const when = 0.05 + i * 0.025;
      intended.push(when);
      scheduler.schedule({ when, kind: 'blip', params: { duration: 0.04 } });
    }

    scheduler.start();
    // Simulate ~60 fps main-thread work while audio time advances in lockstep with wall time.
    for (let frame = 0; frame < 40; frame++) {
      clock.advance(16.667);
      ctx.currentTime = clock.wallMs / 1000;
    }
    scheduler.stop();

    expect(scheduler.startedAt.length).toBe(intended.length);
    for (let i = 0; i < intended.length; i++) {
      const deltaMs = Math.abs(scheduler.startedAt[i]! - intended[i]!) * 1000;
      expect(deltaMs).toBeLessThanOrEqual(5);
    }
  });

  it('never exceeds the 24-voice cap under a 1,000 events/sec burst', () => {
    const { ctx, policy, scheduler } = harness();
    ctx.currentTime = 0;
    for (let i = 0; i < 1000; i++) {
      scheduler.schedule({
        when: i * 0.001, // 1 kHz event rate, all within the first second
        kind: 'blip',
        params: { duration: 0.5 }, // long enough that they would stack without a cap
      });
    }

    // Pull the whole second into the horizon in one go, then tick repeatedly as time advances.
    for (let t = 0; t <= 1; t += 0.025) {
      ctx.currentTime = t;
      scheduler.tick();
      expect(scheduler.liveCount).toBeLessThanOrEqual(VOICE_CAP);
      expect(policy.liveVoiceCount).toBeLessThanOrEqual(VOICE_CAP);
    }
    expect(Math.max(...[scheduler.liveCount])).toBeLessThanOrEqual(VOICE_CAP);
  });

  it('skips arming when muted', () => {
    const { scheduler } = harness(false);
    scheduler.schedule({ when: 0, kind: 'blip' });
    scheduler.tick();
    expect(scheduler.liveCount).toBe(0);
    expect(scheduler.startedAt).toHaveLength(0);
  });

  it('routes pad/drone to ambient and respects reduced-motion silence', () => {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    const policy = new AudioPolicy({
      storage: null,
      reducedMotion: () => true,
      prefs: { muted: false },
    });
    const scheduler = new Scheduler({ context: ctx, mixer, policy, clock: new ManualClock() });
    scheduler.schedule({ when: 0, kind: 'drone' });
    scheduler.tick();
    expect(scheduler.liveCount).toBe(0);

    scheduler.schedule({ when: 0, kind: 'blip' });
    scheduler.tick();
    expect(scheduler.liveCount).toBe(1);
    scheduler.dispose();
  });

  it('start is idempotent and dispose stops everything', () => {
    const { scheduler, ctx } = harness();
    scheduler.schedule({ when: 0, kind: 'blip' });
    scheduler.start();
    scheduler.start();
    ctx.currentTime = 0;
    scheduler.tick();
    expect(scheduler.liveCount).toBe(1);
    scheduler.dispose();
    expect(scheduler.liveCount).toBe(0);
    expect(() => scheduler.schedule({ when: 1, kind: 'blip' })).toThrow(/disposed/);
  });

  it('scheduleIn queues relative to the playhead and exposes queueLength', () => {
    const { ctx, scheduler } = harness();
    ctx.currentTime = 2;
    scheduler.scheduleIn(0.05, 'pluck', { pitch: 220 }, 'event');
    expect(scheduler.queueLength).toBe(1);
    ctx.currentTime = 2.04;
    scheduler.tick(); // still outside horizon end at 2.14 — when is 2.05, inside
    expect(scheduler.liveCount).toBe(1);
    expect(scheduler.queueLength).toBe(0);
    scheduler.dispose();
  });

  it('reaps finished voices and ignores stopVoice for unknown ids', () => {
    const { ctx, scheduler, policy } = harness();
    scheduler.schedule({ when: 0, kind: 'blip', params: { duration: 0.05 } });
    scheduler.tick();
    expect(scheduler.liveCount).toBe(1);
    ctx.currentTime = 1;
    scheduler.tick();
    expect(scheduler.liveCount).toBe(0);
    expect(policy.liveVoiceCount).toBe(0);
    scheduler.stopVoice(999);
    scheduler.dispose();
  });

  it('drives ticks through the default wall-clock interval', () => {
    vi.useFakeTimers();
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    const policy = new AudioPolicy({
      storage: null,
      reducedMotion: () => false,
      prefs: { muted: false },
    });
    const scheduler = new Scheduler({ context: ctx, mixer, policy });
    scheduler.schedule({ when: 0, kind: 'blip' });
    scheduler.start();
    expect(scheduler.liveCount).toBe(1);
    ctx.currentTime = 0.05;
    scheduler.schedule({ when: 0.08, kind: 'click' });
    vi.advanceTimersByTime(SCHEDULER_INTERVAL_MS);
    expect(scheduler.liveCount).toBeGreaterThanOrEqual(1);
    scheduler.dispose();
    scheduler.dispose(); // idempotent
    vi.useRealTimers();
  });

  it('skips the event bus when policy.canPlayEvent is false', () => {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    const policy = new AudioPolicy({
      storage: null,
      reducedMotion: () => false,
      prefs: { muted: false },
    });
    vi.spyOn(policy, 'canPlayEvent').mockReturnValue(false);
    const scheduler = new Scheduler({ context: ctx, mixer, policy, clock: new ManualClock() });
    scheduler.schedule({ when: 0, kind: 'blip' });
    scheduler.tick();
    expect(scheduler.liveCount).toBe(0);
    scheduler.dispose();
  });
});
