import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '@engine/clock';
import { BRIANS_BRAIN, CONWAY } from '@engine/rules/builtin';
import type { Event } from '@shared/protocol';
import { createHandler, REAL_SCHEDULER, type Scheduler, type WorkerHandler } from '@worker/handler';

const CAPS = { sharedArrayBuffer: false, offscreenCanvas: false };

/**
 * Fully in-memory: `setInterval`/`clearInterval` are never called, and nothing here is a real
 * `Worker` or touches `postMessage`. `tick(n)` fires every scheduled job `n` times synchronously
 * — this is what lets the `run`/free-run tests advance virtual time instantly (P0-G-2's third
 * acceptance criterion) instead of waiting on real wall-clock ticks.
 */
class FakeScheduler implements Scheduler {
  private nextId = 1;
  readonly jobs = new Map<number, { readonly fn: () => void; readonly ms: number }>();

  setInterval(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.jobs.set(id, { fn, ms });
    return id;
  }

  clearInterval(id: number): void {
    this.jobs.delete(id);
  }

  tick(times = 1): void {
    for (let i = 0; i < times; i++) {
      for (const job of this.jobs.values()) job.fn();
    }
  }
}

interface Posted {
  readonly event: Event;
  readonly transfer: readonly Transferable[] | undefined;
}

/** The "in-memory port pair": a handler on one side, a plain array standing in for the other end of the wire on the other — no `Worker`, no jsdom, no real `postMessage`. */
function createPort(
  scheduler: Scheduler = new FakeScheduler(),
  clock?: Clock,
): {
  readonly handler: WorkerHandler;
  readonly scheduler: Scheduler;
  readonly posted: Posted[];
  readonly events: Event[];
  send(raw: unknown): void;
} {
  const posted: Posted[] = [];
  const handler = createHandler({
    post: (event, transfer) => posted.push({ event, transfer }),
    scheduler,
    capabilities: CAPS,
    ...(clock ? { clock } : {}),
  });
  return {
    handler,
    scheduler,
    posted,
    get events() {
      return posted.map((p) => p.event);
    },
    send: (raw) => handler.handle(raw),
  };
}

function findByType<T extends Event['type']>(events: readonly Event[], type: T): Extract<Event, { type: T }> | undefined {
  return events.find((e): e is Extract<Event, { type: T }> => e.type === type);
}

function lastByType<T extends Event['type']>(events: readonly Event[], type: T): Extract<Event, { type: T }> | undefined {
  return events.filter((e): e is Extract<Event, { type: T }> => e.type === type).at(-1);
}

/** The `{ id, type: 'ok' }`/`{ id, type: 'error' }` reply correlated to one command's id — order-independent, since a mutating command also pushes an untagged `frame` after its reply. */
function replyTo(events: readonly Event[], id: number): Extract<Event, { type: 'ok' | 'error' }> | undefined {
  return events.find(
    (e): e is Extract<Event, { type: 'ok' | 'error' }> => (e.type === 'ok' || e.type === 'error') && e.id === id,
  );
}

describe('worker-protocol: the full Phase 0 command set, through an in-memory port', () => {
  it('init replies "ready" with the injected capabilities', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 7 });
    expect(port.events).toEqual([{ id: 1, type: 'ready', capabilities: CAPS }]);
  });

  it('commands sent before init fail structurally, not with a crash', () => {
    const port = createPort();
    expect(() => port.send({ id: 1, cmd: 'step', n: 1 })).not.toThrow();
    const [event] = port.events;
    expect(event?.type).toBe('error');
    if (event?.type === 'error') expect(event.id).toBe(1);
  });

  it('setRuleset acknowledges a same-palette switch', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'setRuleset', ruleset: { ...CONWAY, id: 'highlife' } });
    const reply = port.events[1];
    expect(reply).toEqual({ id: 2, type: 'ok' });
  });

  it('setRuleset to an incompatible palette without a migration fails structurally, naming both palettes', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    expect(() => port.send({ id: 2, cmd: 'setRuleset', ruleset: BRIANS_BRAIN })).not.toThrow();
    const reply = port.events[1];
    expect(reply?.type).toBe('error');
    if (reply?.type === 'error') {
      expect(reply.message).toContain(CONWAY.name);
      expect(reply.message).toContain(BRIANS_BRAIN.name);
    }
  });

  it('setRuleset with a migration (P1-D-4) remaps live cells and pushes a full frame reflecting it', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 8, height: 8, seed: 1 });
    port.send({ id: 2, cmd: 'paint', ops: [{ x: 2, y: 2, state: 1 }] }); // Conway "alive"

    // Conway: [dead=0, alive=1]. Brian's Brain: [dead=0, firing=1, refractory=2] -- map
    // Conway's alive to Brian's Brain's "firing", the "sensible default" P1-D-4's picker
    // itself would also pick (same-kind: both are the rule's live state).
    port.send({ id: 3, cmd: 'setRuleset', ruleset: BRIANS_BRAIN, migration: [0, 1] });
    expect(replyTo(port.events, 3)).toEqual({ id: 3, type: 'ok' });

    const frame = lastByType(port.events, 'frame');
    expect(frame).toBeDefined();
    // (2, 2) is local index (2 & 31) + ((2 & 31) << 5) within its chunk's 1024-byte page.
    expect(frame?.chunks.data[2 + (2 << 5)]).toBe(1); // now Brian's Brain state 1 ("firing")
    expect(frame?.stats.population).toBe(1);
  });

  it('setRuleset with a migration shorter than the old palette falls back to dead for any unmapped old state', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: BRIANS_BRAIN, width: 8, height: 8, seed: 1 });
    // Brian's Brain "refractory" (state 2) painted directly -- a real Simulation would only ever
    // reach it via evolution, but painting it is the simplest way to prove an *old state id with
    // no entry in `migration`* falls back to dead rather than an out-of-bounds `undefined` byte.
    port.send({ id: 2, cmd: 'paint', ops: [{ x: 1, y: 1, state: 2 }] });

    // Only entries for old states 0 and 1 -- state 2 ("refractory") has no entry at all.
    port.send({ id: 3, cmd: 'setRuleset', ruleset: CONWAY, migration: [0, 1] });
    expect(replyTo(port.events, 3)).toEqual({ id: 3, type: 'ok' });

    const frame = lastByType(port.events, 'frame');
    expect(frame?.stats.population).toBe(0); // the unmapped cell fell back to dead, not garbage
  });

  it('step replies "ok" and pushes a frame reflecting the change', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    // A block (still life) so the outcome is deterministic and non-empty.
    port.send({
      id: 2,
      cmd: 'paint',
      ops: [
        { x: 4, y: 4, state: 1 },
        { x: 5, y: 4, state: 1 },
        { x: 4, y: 5, state: 1 },
        { x: 5, y: 5, state: 1 },
      ],
    });
    port.send({ id: 3, cmd: 'step', n: 1 });

    expect(replyTo(port.events, 3)).toEqual({ id: 3, type: 'ok' });
    const frame = lastByType(port.events, 'frame');
    expect(frame).toBeDefined();
    expect(frame?.tick).toBe(1);
    expect(frame?.stats.population).toBe(4); // the block survives one generation unchanged
  });

  it("paint replies ok and its frame's chunk data reflects the painted cell", () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'paint', ops: [{ x: 3, y: 3, state: 1 }] });

    expect(replyTo(port.events, 2)).toEqual({ id: 2, type: 'ok' });
    const frame = findByType(port.events, 'frame');
    expect(frame?.chunks.keys.length).toBe(1);
    // (3, 3) is local index (3 & 31) + ((3 & 31) << 5) within its chunk's 1024-byte page.
    expect(frame?.chunks.data[3 + (3 << 5)]).toBe(1);
    expect(frame?.dirty).toEqual([{ x: 0, y: 0, width: 32, height: 32 }]);
    expect(frame?.stats.population).toBe(1);
  });

  it('clear replies ok and pushes a full frame with zero population', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'paint', ops: [{ x: 1, y: 1, state: 1 }] });
    port.send({ id: 3, cmd: 'clear' });

    expect(replyTo(port.events, 3)).toEqual({ id: 3, type: 'ok' });
    const lastFrame = lastByType(port.events, 'frame');
    expect(lastFrame?.stats.population).toBe(0);
  });

  it('seedRandom replies ok and pushes a full frame with cells at the requested density', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: { ...CONWAY, boundary: 'bounded' }, width: 64, height: 64, seed: 1 });
    port.send({ id: 2, cmd: 'seedRandom', density: 0.4, seed: 99 });

    expect(port.events[1]).toEqual({ id: 2, type: 'ok' });
    const frame = findByType(port.events, 'frame');
    const density = (frame?.stats.population ?? 0) / (64 * 64);
    expect(density).toBeGreaterThan(0.3);
    expect(density).toBeLessThan(0.5);
  });

  it('run is driven by the injected scheduler: pushes frames only when the test advances virtual time', () => {
    const scheduler = new FakeScheduler();
    const port = createPort(scheduler);
    port.send({ id: 1, cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'run', tps: 30 });

    expect(port.events[1]).toEqual({ id: 2, type: 'ok' });
    expect(scheduler.jobs.size).toBe(1);
    expect([...scheduler.jobs.values()][0]?.ms).toBeCloseTo(1000 / 30, 5);

    const framesBefore = port.events.filter((e) => e.type === 'frame').length;
    expect(framesBefore).toBe(0); // no real time passed; run() alone pushes nothing

    scheduler.tick(3);
    const framesAfter = port.events.filter((e) => e.type === 'frame').length;
    expect(framesAfter).toBe(3);
    expect(findByType(port.events, 'frame')?.tick).toBeGreaterThanOrEqual(1);
  });

  it('pause stops the free run: no further frames after the next tick', () => {
    const scheduler = new FakeScheduler();
    const port = createPort(scheduler);
    port.send({ id: 1, cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'run', tps: 30 });
    scheduler.tick(1);
    port.send({ id: 3, cmd: 'pause' });
    expect(port.events.at(-1)).toEqual({ id: 3, type: 'ok' });

    const framesBeforePause = port.events.filter((e) => e.type === 'frame').length;
    scheduler.tick(5);
    const framesAfterPause = port.events.filter((e) => e.type === 'frame').length;
    expect(framesAfterPause).toBe(framesBeforePause);
    expect(scheduler.jobs.size).toBe(0);
  });

  it('run rejects a non-positive tps with a structured error, not a crash', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    expect(() => port.send({ id: 2, cmd: 'run', tps: 0 })).not.toThrow();
    expect(port.events[1]?.type).toBe('error');
  });

  it('run accepts tps === Infinity — the "unbounded" mode (P1-D-2) — and schedules at the shortest interval', () => {
    const scheduler = new FakeScheduler();
    const port = createPort(scheduler);
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    expect(() => port.send({ id: 2, cmd: 'run', tps: Infinity })).not.toThrow();
    expect(replyTo(port.events, 2)).toEqual({ id: 2, type: 'ok' });
    const [job] = scheduler.jobs.values();
    expect(job?.ms).toBe(0); // 1000 / Infinity — "as fast as the scheduler allows"

    scheduler.tick(3);
    expect(lastByType(port.events, 'frame')?.tick).toBe(3);
  });

  it('loadPattern is not yet implemented (Phase 2) and rejects structurally', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'loadPattern', rle: 'bo$2bo$3o!', x: 0, y: 0 });
    expect(port.events[1]?.type).toBe('error');
  });

  it('seek without history enabled rejects structurally rather than crashing', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'seek', tick: 0 });
    const event = port.events[1];
    expect(event?.type).toBe('error');
    if (event?.type === 'error') expect(event.message).toMatch(/history/i);
  });

  it('snapshot replies ok with the Snapshot payload, transferred', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'paint', ops: [{ x: 0, y: 0, state: 1 }] });
    port.send({ id: 3, cmd: 'snapshot' });

    const reply = port.posted.find((p) => p.event.type === 'ok' && p.event.id === 3);
    expect(reply).toBeDefined();
    const result = reply?.event.type === 'ok' ? reply.event.result : undefined;
    expect(result).toBeDefined();
    expect(reply?.transfer?.length).toBe(2);
  });

  it('restore replies ok and pushes a full frame that reproduces the snapshotted state (P0-G-3: recovering a killed-and-restarted worker)', () => {
    // The scenario this exists for: a worker dies mid-run, the client spins up a fresh one,
    // and pushes back the last snapshot it cached — rather than restarting from the seed.
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({
      id: 2,
      cmd: 'paint',
      ops: [
        { x: 4, y: 4, state: 1 },
        { x: 5, y: 4, state: 1 },
        { x: 4, y: 5, state: 1 },
        { x: 5, y: 5, state: 1 },
      ],
    });
    port.send({ id: 3, cmd: 'snapshot' });
    const snapshotReply = replyTo(port.events, 3);
    const snapshot = snapshotReply?.type === 'ok' ? snapshotReply.result : undefined;

    // A brand-new worker (fresh port) that never saw the painted cells.
    const freshPort = createPort();
    freshPort.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    freshPort.send({ id: 2, cmd: 'restore', snapshot });

    expect(replyTo(freshPort.events, 2)).toEqual({ id: 2, type: 'ok' });
    const frame = lastByType(freshPort.events, 'frame');
    expect(frame?.stats.population).toBe(4);
    expect(frame?.chunks.data[4 + (4 << 5)]).toBe(1);
  });

  it('setViewport is acknowledged', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({
      id: 2,
      cmd: 'setViewport',
      viewport: { rect: { x: 0, y: 0, width: 16, height: 16 }, scale: 1 },
    });
    expect(port.events[1]).toEqual({ id: 2, type: 'ok' });
  });

  it('dispose acknowledges, and every command after it fails structurally without crashing', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'dispose' });
    expect(port.events[1]).toEqual({ id: 2, type: 'ok' });

    expect(() => port.send({ id: 3, cmd: 'step', n: 1 })).not.toThrow();
    const event = port.events[2];
    expect(event?.type).toBe('error');
    if (event?.type === 'error') expect(event.code).toBe('E_DISPOSED');
  });
});

describe('worker-protocol: an unknown command returns a structured error and does not kill the handler', () => {
  it('rejects an unrecognised cmd, then keeps working for the next, valid command', () => {
    const port = createPort();
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });

    expect(() => port.send({ id: 2, cmd: 'flarp' })).not.toThrow();
    const errorEvent = port.events[1];
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.id).toBe(2);
      expect(typeof errorEvent.code).toBe('string');
      expect(errorEvent.code.length).toBeGreaterThan(0);
    }

    // The handler survives: a well-formed command right after still works.
    port.send({ id: 3, cmd: 'step', n: 1 });
    expect(port.events[2]).toEqual({ id: 3, type: 'ok' });
  });

  it('rejects a completely malformed message (not even an object) without throwing', () => {
    const port = createPort();
    for (const raw of [undefined, null, 42, 'nope', []]) {
      expect(() => port.send(raw)).not.toThrow();
    }
    expect(port.events.every((e) => e.type === 'error')).toBe(true);
  });
});

describe('worker-protocol: injected clock and defensive edge cases', () => {
  it('uses the injected clock for TickStats.stepMicros', () => {
    let now = 0;
    const clock: Clock = { now: () => (now += 250) };
    const port = createPort(new FakeScheduler(), clock);
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'paint', ops: [{ x: 0, y: 0, state: 1 }] });
    port.send({ id: 3, cmd: 'step', n: 1 });

    const frame = lastByType(port.events, 'frame');
    expect(frame?.stats.stepMicros).toBe(250);
  });

  it('a run tick that fires after the simulation is gone is a no-op, not a crash', () => {
    const scheduler = new FakeScheduler();
    const port = createPort(scheduler);
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'run', tps: 30 });
    const [job] = [...scheduler.jobs.values()];
    port.send({ id: 3, cmd: 'dispose' });

    const framesBefore = port.events.filter((e) => e.type === 'frame').length;
    // Simulates the real-world race a `clearInterval` can lose: the browser's timer had
    // already queued this callback before `dispose` cancelled it.
    expect(() => job?.fn()).not.toThrow();
    expect(port.events.filter((e) => e.type === 'frame').length).toBe(framesBefore);
  });

  it('a Scheduler that throws a non-Error value still yields a structured error event', () => {
    // A real (misbehaving) Scheduler could throw anything, not just an Error — cast so this
    // deliberately non-Error throw doesn't trip the "only throw Error" lint rule; the handler
    // must still cope with it at runtime, which is exactly what this test checks.
    const NON_ERROR_THROW = 'scheduler is on fire' as unknown as Error;
    const brokenScheduler: Scheduler = {
      setInterval: () => {
        throw NON_ERROR_THROW;
      },
      clearInterval: () => {},
    };
    const port = createPort(brokenScheduler);
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'run', tps: 30 });

    const event = replyTo(port.events, 2);
    expect(event).toEqual({ id: 2, type: 'error', message: 'scheduler is on fire', code: 'E_UNKNOWN' });
  });
});

describe('REAL_SCHEDULER', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delegates to the real setInterval/clearInterval', () => {
    let calls = 0;
    const id = REAL_SCHEDULER.setInterval(() => (calls += 1), 10);
    vi.advanceTimersByTime(35);
    expect(calls).toBe(3);
    REAL_SCHEDULER.clearInterval(id);
    vi.advanceTimersByTime(35);
    expect(calls).toBe(3); // no further ticks once cleared
  });

  /**
   * P1-D-2's "achieved TPS is within 5% of target ... verified by test" acceptance criterion,
   * proven at the level this codebase actually controls: `run`'s `1000 / tps` interval math,
   * driven through the *real* `setInterval`/`clearInterval` `REAL_SCHEDULER` wraps (not
   * `FakeScheduler`, whose `tick(n)` fires jobs immediately regardless of `ms` and so proves
   * nothing about real timing). `vi.useFakeTimers()` makes this exact and deterministic rather
   * than a flaky real-wall-clock wait — the "up to the machine's capability" half of the
   * criterion is a real-hardware claim no unit test can honestly assert on; `TpsMeter`'s own
   * tests (`speed.spec.ts`) separately prove the *actual-TPS measurement* is accurate for a rate
   * a real machine falls short at, which is the other half of "never silently lying" this
   * criterion cares about.
   */
  it.each([1, 20, 250])('run achieves target tps=%i to within 5%% over simulated wall-clock time', (targetTps) => {
    const port = createPort(REAL_SCHEDULER);
    port.send({ id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    port.send({ id: 2, cmd: 'run', tps: targetTps });

    const simulatedMs = 5000;
    vi.advanceTimersByTime(simulatedMs);

    const lastFrame = lastByType(port.events, 'frame');
    expect(lastFrame).toBeDefined();
    const achievedTps = (lastFrame!.tick / simulatedMs) * 1000;
    expect(achievedTps).toBeGreaterThan(targetTps * 0.95);
    expect(achievedTps).toBeLessThan(targetTps * 1.05);
  });
});
