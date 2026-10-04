/**
 * P3-D-4 — audio's cost on the main thread (PHASE_3 §4: "< 0.5 ms/frame").
 *
 * Audio is the one Phase 3 subsystem whose main-thread cost is fully measurable here, and the
 * number has room to spare: the event mapper's per-frame work is aggregation arithmetic, and
 * the only expensive moment is a 50 ms window closing and constructing one voice graph. Measured
 * with the Web Audio doubles the audio suite uses (`tests/unit/audio/fakes.ts`) rather than a real
 * `AudioContext`, which does not exist in Node — and the label matters:
 *
 *  - **What is measured:** the JS the browser also runs on its main thread — window
 *    aggregation, pan computation, policy voice allocation, and full oscillator/noise → filter →
 *    ADSR graph construction through `spawnVoice`.
 *  - **What is not:** actual sample rendering, which in a browser happens on the audio thread
 *    and never touches the frame budget.
 *
 * Two regimes, because they are different code paths and the wrong one is not the risk:
 *  - `audio-main-thread-frame` — *discrete* voices: births below the 400/sec texture threshold,
 *    so every 50 ms window builds a fresh voice graph. This is the worst case and the one the
 *    0.5 ms budget is about.
 *  - `audio-main-thread-texture-frame` — the aggregated noise bed: one looping voice, modulated
 *    in place. Cheaper, and the reason a 10 000 births/sec flood is not a machine-gun.
 */
import { EventMapper } from '../../src/audio/events.ts';
import { Mixer } from '../../src/audio/mixer.ts';
import { AudioPolicy } from '../../src/audio/policy.ts';
import { Scheduler } from '../../src/audio/scheduler.ts';
import { FakeAudioContext, ManualClock } from '../unit/audio/fakes.ts';
import type { BenchCase } from './types.ts';

const FRAME_MS = 1000 / 60;
/** Births per frame that keep the rate under the 400/sec texture threshold → discrete voices. */
const DISCRETE_BIRTHS_PER_FRAME = 7;
/** Births per frame well over the threshold → the aggregated texture bed. */
const TEXTURE_BIRTHS_PER_FRAME = 2_000;

interface Rig {
  readonly ctx: FakeAudioContext;
  readonly clock: ManualClock;
  readonly mapper: EventMapper;
  readonly scheduler: Scheduler;
}

function openRig(): Rig {
  const ctx = new FakeAudioContext();
  const clock = new ManualClock();
  const policy = new AudioPolicy({
    storage: null,
    reducedMotion: () => false,
    prefs: { muted: false },
  });
  const mixer = new Mixer({ context: ctx });
  const scheduler = new Scheduler({
    context: ctx,
    mixer,
    policy,
    clock: {
      nowMs: () => clock.nowMs(),
      setInterval: (fn, ms) => clock.setInterval(fn, ms),
      clearInterval: (id) => clock.clearInterval(id),
    },
  });
  const mapper = new EventMapper({
    context: ctx,
    mixer,
    scheduler,
    policy,
    clock: { nowMs: () => clock.nowMs() },
  });
  return { ctx, clock, mapper, scheduler };
}

/** Advance the graph by one 60 fps frame with audio enabled. */
function frame(rig: Rig, births: number): void {
  rig.ctx.currentTime += FRAME_MS / 1000;
  rig.clock.advance(FRAME_MS);
  rig.mapper.noteBirths({ count: births, centroidX: 960, centroidY: 540, screenWidth: 1920 });
  rig.mapper.flush();
  rig.scheduler.tick();
}

function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}

let rig: Rig | undefined;

function measure(births: number, frames: number): number {
  const r = rig!;
  const samples: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    frame(r, births);
    samples.push(performance.now() - t0);
  }
  return medianOf(samples);
}

function audioCase(id: string, name: string, births: number): BenchCase {
  return {
    id,
    name,
    unit: 'ms',
    budget: 0.5,
    higherIsBetter: false,
    class: 'browser',
    warmup: 20,
    setup() {
      rig?.mapper.dispose();
      rig?.scheduler.dispose();
      rig = openRig();
      // Warm the graph and the JIT the way a real session does: a second of playback.
      for (let i = 0; i < 60; i++) frame(rig, births);
    },
    run() {
      return measure(births, 30);
    },
    teardown() {
      rig?.mapper.dispose();
      rig?.scheduler.dispose();
      rig = undefined;
    },
  };
}

export const cases: BenchCase[] = [
  audioCase(
    'audio-main-thread-frame',
    'audio enabled, discrete voices — main-thread cost per frame (aggregation + voice-graph construction, Web Audio doubles; not sample rendering)',
    DISCRETE_BIRTHS_PER_FRAME,
  ),
  audioCase(
    'audio-main-thread-texture-frame',
    'audio enabled, aggregated noise bed at ~120k births/sec — main-thread cost per frame (one looping voice, modulated in place)',
    TEXTURE_BIRTHS_PER_FRAME,
  ),
];