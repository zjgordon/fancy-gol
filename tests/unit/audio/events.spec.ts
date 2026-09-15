import { describe, expect, it } from 'vitest';
import { EventMapper } from '../../../src/audio/events';
import { Mixer } from '../../../src/audio/mixer';
import { AudioPolicy } from '../../../src/audio/policy';
import { Scheduler } from '../../../src/audio/scheduler';
import {
  AGGREGATION_WINDOW_MS,
  MAX_SIM_VOICES_PER_SEC,
  TEXTURE_RATE_PER_SEC,
  VOICE_CAP,
} from '../../../src/audio/types';
import { FakeAudioContext, FakeStereoPanner, ManualClock, MemoryStorage } from './fakes';

function harness(opts: { muted?: boolean; reducedMotion?: boolean } = {}) {
  const ctx = new FakeAudioContext();
  const mixer = new Mixer({ context: ctx });
  const policy = new AudioPolicy({
    storage: new MemoryStorage(),
    reducedMotion: () => opts.reducedMotion ?? false,
    prefs: { muted: opts.muted ?? false },
  });
  const clock = new ManualClock();
  const scheduler = new Scheduler({ context: ctx, mixer, policy, clock });
  const mapper = new EventMapper({
    context: ctx,
    mixer,
    scheduler,
    policy,
    clock,
  });
  return { ctx, mixer, policy, clock, scheduler, mapper };
}

describe('EventMapper (P3-B-3)', () => {
  it('at 10,000 births/sec emits a stable texture with ≤ 20 voices/sec', () => {
    const { ctx, clock, scheduler, mapper } = harness();
    const birthsPerSec = 10_000;
    const perWindow = Math.round((birthsPerSec * AGGREGATION_WINDOW_MS) / 1000);

    for (let t = 0; t < 1000; t += AGGREGATION_WINDOW_MS) {
      clock.wallMs = t;
      ctx.currentTime = t / 1000;
      mapper.noteBirths({
        count: perWindow,
        centroidX: 100,
        centroidY: 50,
        screenWidth: 200,
        atMs: t,
      });
      mapper.flush(t + AGGREGATION_WINDOW_MS);
      scheduler.tick();
    }

    expect(mapper.textureActive).toBe(true);
    expect(perWindow / (AGGREGATION_WINDOW_MS / 1000)).toBeGreaterThanOrEqual(TEXTURE_RATE_PER_SEC);
    const rate = mapper.simVoicesPerSec(1000, 1000);
    expect(rate).toBeLessThanOrEqual(MAX_SIM_VOICES_PER_SEC);
    // Texture bed started once — not a machine-gun of discrete ticks.
    expect(mapper.simVoiceTimesMs.length).toBe(1);
    expect(scheduler.startedAt.length).toBe(0);
  });

  it('pans to track the on-screen centroid of activity', () => {
    const { ctx, scheduler, mapper } = harness();

    mapper.noteBirths({
      count: 4,
      centroidX: 0,
      centroidY: 10,
      screenWidth: 200,
      atMs: 0,
    });
    mapper.flush(AGGREGATION_WINDOW_MS);
    scheduler.tick();

    expect(mapper.lastSimPan).toBeCloseTo(-1, 5);
    const left = scheduler.armed[0]!;
    expect(left.graph.destination).toBeInstanceOf(FakeStereoPanner);
    expect((left.graph.destination as FakeStereoPanner).pan.value).toBeCloseTo(-1, 5);

    ctx.currentTime = 0.1;
    mapper.noteBirths({
      count: 4,
      centroidX: 200,
      centroidY: 10,
      screenWidth: 200,
      atMs: 100,
    });
    mapper.flush(100 + AGGREGATION_WINDOW_MS);
    scheduler.tick();
    expect(mapper.lastSimPan).toBeCloseTo(1, 5);
    const right = scheduler.armed[1]!;
    expect((right.graph.destination as FakeStereoPanner).pan.value).toBeCloseTo(1, 5);

    ctx.currentTime = 0.2;
    mapper.noteBirths({
      count: 4,
      centroidX: 100,
      centroidY: 10,
      screenWidth: 200,
      atMs: 200,
    });
    mapper.flush(200 + AGGREGATION_WINDOW_MS);
    scheduler.tick();
    expect(mapper.lastSimPan).toBeCloseTo(0, 5);
  });

  it('gives a single glider one clean blip per generation', () => {
    const { scheduler, mapper } = harness();

    // Classic glider step: a few births, one generation notification.
    mapper.noteGeneration({
      births: 2,
      centroidX: 80,
      centroidY: 40,
      screenWidth: 160,
      atMs: 0,
    });
    mapper.flush(AGGREGATION_WINDOW_MS);
    scheduler.tick();

    expect(scheduler.startedAt).toHaveLength(1);
    expect(mapper.lastDiscreteKind).toBe('blip');
    expect(mapper.textureActive).toBe(false);

    // Next generation, later window → second tick.
    mapper.noteGeneration({
      births: 2,
      centroidX: 82,
      centroidY: 41,
      screenWidth: 160,
      atMs: 120,
    });
    mapper.flush(120 + AGGREGATION_WINDOW_MS);
    scheduler.tick();
    expect(scheduler.startedAt).toHaveLength(2);
  });

  it('silences everything under mute (graph stays idle)', () => {
    const { scheduler, mapper } = harness({ muted: true });
    mapper.noteGeneration({
      births: 5,
      centroidX: 50,
      centroidY: 50,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.noteUi('tool-select');
    mapper.noteUi('error');
    mapper.flush(AGGREGATION_WINDOW_MS);
    scheduler.tick();

    expect(scheduler.startedAt).toHaveLength(0);
    expect(scheduler.armed).toHaveLength(0);
    expect(mapper.textureActive).toBe(false);
    expect(mapper.simVoiceTimesMs).toHaveLength(0);
  });

  it('silences everything under reduced motion (graph stays idle)', () => {
    const { scheduler, mapper, policy } = harness({ reducedMotion: true });
    expect(policy.isFullySilent()).toBe(true);

    mapper.noteBirths({
      count: 100,
      centroidX: 50,
      centroidY: 50,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.noteUi('panel-open');
    mapper.flush(AGGREGATION_WINDOW_MS);
    scheduler.tick();

    expect(scheduler.startedAt).toHaveLength(0);
    expect(scheduler.liveCount).toBe(0);
    expect(mapper.textureActive).toBe(false);
  });

  it('plays UI cues discretely when audio is allowed', () => {
    const { scheduler, mapper } = harness();
    mapper.noteUi('tool-select');
    mapper.noteUi('confirm');
    scheduler.tick();
    expect(scheduler.startedAt.length).toBe(2);
    expect(scheduler.armed.map((v) => v.kind)).toEqual(['click', 'blip']);
  });

  it('cross-fades back from texture to discrete when the rate drops', () => {
    const { ctx, scheduler, mapper } = harness();
    mapper.noteBirths({
      count: 50,
      centroidX: 100,
      centroidY: 50,
      screenWidth: 200,
      atMs: 0,
    });
    mapper.flush(AGGREGATION_WINDOW_MS);
    expect(mapper.textureActive).toBe(true);

    ctx.currentTime = 0.2;
    mapper.noteBirths({
      count: 2,
      centroidX: 100,
      centroidY: 50,
      screenWidth: 200,
      atMs: 200,
    });
    mapper.flush(200 + AGGREGATION_WINDOW_MS);
    scheduler.tick();
    expect(mapper.textureActive).toBe(false);
    expect(mapper.lastDiscreteKind).not.toBeNull();
  });

  it('dispose stops the texture bed', () => {
    const { mapper } = harness();
    mapper.noteBirths({
      count: 100,
      centroidX: 10,
      centroidY: 10,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.flush(AGGREGATION_WINDOW_MS);
    expect(mapper.textureActive).toBe(true);
    expect(mapper.texturePanNode).not.toBeNull();
    mapper.dispose();
    expect(mapper.textureActive).toBe(false);
    mapper.dispose(); // idempotent
    expect(() => mapper.noteUi('error')).toThrow(/disposed/);
  });

  it('aggregates many births into a click and covers policy helpers', () => {
    const { policy, scheduler, mapper } = harness();
    expect(policy.prefersReducedMotion()).toBe(false);
    expect(mapper.simVoicesPerSec(0)).toBe(0);

    mapper.noteBirths({
      count: 0,
      centroidX: 50,
      centroidY: 50,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.noteBirths({
      count: 12,
      centroidX: 50,
      centroidY: 50,
      screenWidth: 100,
      atMs: 10,
    });
    mapper.flush(AGGREGATION_WINDOW_MS);
    scheduler.tick();
    expect(mapper.lastDiscreteKind).toBe('click');

    mapper.noteUi('panel-close');
    mapper.noteUi('error');
    scheduler.tick();
    expect(scheduler.armed.length).toBeGreaterThanOrEqual(3);
  });

  it('steals a voice slot when starting the texture bed at capacity', () => {
    const { policy, mapper, scheduler } = harness();
    for (let i = 0; i < VOICE_CAP; i++) {
      policy.allocateVoice(i);
      // Park dummy live entries so stopVoice is a no-op miss — steal still frees the policy slot.
    }
    mapper.noteBirths({
      count: 100,
      centroidX: 10,
      centroidY: 10,
      screenWidth: 100,
      atMs: 0,
    });
    mapper.flush(AGGREGATION_WINDOW_MS);
    expect(mapper.textureActive).toBe(true);
    scheduler.tick();
  });
});
