import { describe, expect, it, vi } from 'vitest';
import { Simulation } from '@engine/simulation';
import { CONWAY } from '@engine/rules/builtin/life';
import type { LiveDeltaMessage, LiveKeyframeMessage } from '@shared/live-protocol';
import { LiveHub, REAL_TIMERS, type LiveSocket, type Timers } from '@server/live-hub';

const OPEN = 1;
const CLOSED = 3;

/** Declared with arrow-typed (not method-shorthand) properties for `ping`/`terminate`/`close` —
 * a purely stylistic difference to `LiveSocket`'s own declarations, but it's what lets a test
 * write `expect(socket.ping).toHaveBeenCalled()` without tripping
 * `@typescript-eslint/unbound-method` (which only flags shorthand method syntax, not an
 * explicitly-typed function-valued property). */
interface FakeLiveSocket extends Omit<LiveSocket, 'ping' | 'terminate' | 'close'> {
  readonly sent: unknown[];
  readonly pongHandlers: Array<() => void>;
  readonly ping: () => void;
  readonly terminate: () => void;
  readonly close: () => void;
}

function fakeSocket(overrides: Partial<LiveSocket> = {}): FakeLiveSocket {
  const sent: unknown[] = [];
  const pongHandlers: Array<() => void> = [];
  return {
    sent,
    pongHandlers,
    readyState: OPEN,
    bufferedAmount: 0,
    send: (data: string) => sent.push(JSON.parse(data)),
    ping: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
    on: (event, listener) => {
      if (event === 'pong') pongHandlers.push(listener);
    },
    ...overrides,
  };
}

function fakeTimers(): Timers & { fireInterval(ms: number): void; intervalCount: number } {
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let handle = 0;
  return {
    get intervalCount() {
      return intervals.size;
    },
    setInterval: (fn, ms) => {
      const id = ++handle;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => void intervals.delete(id),
    // Fires every registered interval whose period matches `ms` once — the hub registers exactly
    // one broadcast interval and one heartbeat interval, always at different periods in these
    // tests, so this is an unambiguous way to drive just one of them from a test.
    fireInterval: (ms) => {
      for (const { fn, ms: intervalMs } of intervals.values()) {
        if (intervalMs === ms) fn();
      }
    },
  };
}

const TICK_MS = 100;
const HEARTBEAT_MS = 30_000;

function makeHub(overrides: Partial<ConstructorParameters<typeof LiveHub>[0]> = {}, timers = fakeTimers()) {
  const hub = new LiveHub({
    width: 16,
    height: 16,
    seedDensity: 0.3,
    seed: 1,
    tickIntervalMs: TICK_MS,
    heartbeatIntervalMs: HEARTBEAT_MS,
    timers,
    ...overrides,
  });
  return { hub, timers };
}

describe('LiveHub — construction', () => {
  it('defaults to CONWAY (already toroidal) so the exhibition wraps forever', () => {
    const { hub } = makeHub();
    expect(hub.tick).toBe(0);
    expect(hub.clientCount).toBe(0);
  });
});

describe('LiveHub — addClient / removeClient', () => {
  it('sends a keyframe immediately on join', () => {
    const { hub } = makeHub();
    const socket = fakeSocket();
    expect(hub.addClient(socket)).toBe(true);
    expect(socket.sent).toHaveLength(1);
    const msg = socket.sent[0] as LiveKeyframeMessage;
    expect(msg.type).toBe('keyframe');
    expect(msg.tick).toBe(0);
    expect(hub.clientCount).toBe(1);
  });

  it('the keyframe lists every live cell within bounds, none dead', () => {
    const { hub } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    const msg = socket.sent[0] as LiveKeyframeMessage;
    expect(msg.cells.length).toBeGreaterThan(0);
    for (const [, , state] of msg.cells) expect(state).not.toBe(0);
  });

  it('rejects a new connection once maxClients is reached', () => {
    const { hub } = makeHub({ maxClients: 2 });
    expect(hub.addClient(fakeSocket())).toBe(true);
    expect(hub.addClient(fakeSocket())).toBe(true);
    expect(hub.addClient(fakeSocket())).toBe(false);
    expect(hub.clientCount).toBe(2);
  });

  it('removeClient stops future broadcasts from reaching it', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    hub.removeClient(socket);
    expect(hub.clientCount).toBe(0);
    hub.start();
    timers.fireInterval(TICK_MS);
    expect(socket.sent).toHaveLength(1); // only the original join keyframe
  });
});

describe('LiveHub — broadcast', () => {
  it('broadcasts a delta to every connected client on each tick', () => {
    const { hub, timers } = makeHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.addClient(a);
    hub.addClient(b);
    hub.start();

    timers.fireInterval(TICK_MS);

    expect(a.sent).toHaveLength(2); // keyframe + one delta
    expect(b.sent).toHaveLength(2);
    const deltaA = a.sent[1] as LiveDeltaMessage;
    expect(deltaA.type).toBe('delta');
    expect(deltaA.tick).toBe(1);
    expect(hub.tick).toBe(1);
  });

  it('advances the tick and the delta content on every subsequent broadcast', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    hub.start();

    timers.fireInterval(TICK_MS);
    timers.fireInterval(TICK_MS);
    timers.fireInterval(TICK_MS);

    expect(hub.tick).toBe(3);
    const ticks = socket.sent.slice(1).map((m) => (m as LiveDeltaMessage).tick);
    expect(ticks).toEqual([1, 2, 3]);
  });

  it('never sends to a socket that is not OPEN', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket({ readyState: CLOSED });
    hub.addClient(socket); // the join keyframe is still sent regardless of readyState today
    hub.start();
    timers.fireInterval(TICK_MS);
    expect(socket.sent).toHaveLength(1); // join keyframe only, no delta
  });

  it('stop() halts broadcasting and heartbeats', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    hub.start();
    hub.stop();
    timers.fireInterval(TICK_MS);
    timers.fireInterval(HEARTBEAT_MS);
    expect(socket.sent).toHaveLength(1); // join keyframe only
  });

  it('start() is idempotent: calling it twice does not double the broadcast rate', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    hub.start();
    hub.start();
    timers.fireInterval(TICK_MS);
    expect(socket.sent).toHaveLength(2); // keyframe + exactly one delta, not two
  });
});

describe('LiveHub — backpressure (P1-G-3 AC: stalled client resynchronised by keyframe, not disconnect)', () => {
  it('skips deltas once bufferedAmount exceeds the threshold, without closing the socket', () => {
    const { hub, timers } = makeHub({ bufferedAmountThreshold: 1000 });
    const socket = fakeSocket({ bufferedAmount: 5000 });
    hub.addClient(socket);
    hub.start();

    timers.fireInterval(TICK_MS);

    expect(socket.sent).toHaveLength(1); // join keyframe only; the delta was skipped
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('stays skipped across many ticks while still stalled — proxying "30 seconds" as 300 ticks at 10 Hz', () => {
    const { hub, timers } = makeHub({ bufferedAmountThreshold: 1000 });
    const socket = fakeSocket({ bufferedAmount: 5000 });
    hub.addClient(socket);
    hub.start();

    for (let i = 0; i < 300; i++) timers.fireInterval(TICK_MS);

    expect(socket.sent).toHaveLength(1); // still only the join keyframe
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(hub.clientCount).toBe(1); // never removed
  });

  it('sends a fresh keyframe (not a delta) once a stalled client fully drains', () => {
    const { hub, timers } = makeHub({ bufferedAmountThreshold: 1000 });
    const socket = fakeSocket({ bufferedAmount: 5000 });
    hub.addClient(socket);
    hub.start();

    timers.fireInterval(TICK_MS); // stalls
    (socket as { bufferedAmount: number }).bufferedAmount = 0; // drains
    timers.fireInterval(TICK_MS);

    expect(socket.sent).toHaveLength(2);
    expect((socket.sent[1] as LiveKeyframeMessage).type).toBe('keyframe');
  });

  it('resumes normal delta broadcasting on the tick after the resync keyframe', () => {
    const { hub, timers } = makeHub({ bufferedAmountThreshold: 1000 });
    const socket = fakeSocket({ bufferedAmount: 5000 });
    hub.addClient(socket);
    hub.start();

    timers.fireInterval(TICK_MS); // stalls
    (socket as { bufferedAmount: number }).bufferedAmount = 0;
    timers.fireInterval(TICK_MS); // resync keyframe
    timers.fireInterval(TICK_MS); // back to normal deltas

    expect(socket.sent).toHaveLength(3);
    expect((socket.sent[2] as LiveDeltaMessage).type).toBe('delta');
  });

  it('a client under the threshold the whole time is never marked stalled', () => {
    const { hub, timers } = makeHub({ bufferedAmountThreshold: 1_000_000 });
    const socket = fakeSocket({ bufferedAmount: 10 });
    hub.addClient(socket);
    hub.start();
    for (let i = 0; i < 5; i++) timers.fireInterval(TICK_MS);
    expect(socket.sent).toHaveLength(6); // keyframe + 5 deltas, no interruption
    for (let i = 1; i < 6; i++) expect((socket.sent[i] as LiveDeltaMessage).type).toBe('delta');
  });
});

describe('LiveHub — heartbeat (dead-socket reaping)', () => {
  it('pings every client on each heartbeat tick', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    hub.start();
    timers.fireInterval(HEARTBEAT_MS);
    expect(socket.ping).toHaveBeenCalledTimes(1);
  });

  it('keeps a client alive that responds with a pong before the next heartbeat', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    hub.start();

    timers.fireInterval(HEARTBEAT_MS); // ping sent
    for (const onPong of socket.pongHandlers) onPong(); // client responds
    timers.fireInterval(HEARTBEAT_MS); // still alive -> ping again, not terminated

    expect(socket.terminate).not.toHaveBeenCalled();
    expect(hub.clientCount).toBe(1);
    expect(socket.ping).toHaveBeenCalledTimes(2);
  });

  it('terminates and removes a client that never responds to a ping', () => {
    const { hub, timers } = makeHub();
    const socket = fakeSocket();
    hub.addClient(socket);
    hub.start();

    timers.fireInterval(HEARTBEAT_MS); // ping sent, isAlive set false pending a pong
    timers.fireInterval(HEARTBEAT_MS); // no pong arrived -> reaped

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(hub.clientCount).toBe(0);
  });
});

describe('LiveHub — isolation (P1-G-3 AC: never interferes with the viewer’s own local simulation)', () => {
  it('running a LiveHub for many ticks never affects an independently-created Simulation', () => {
    const independent = new Simulation({ ruleset: CONWAY, width: 32, height: 32 });
    independent.seedRandom(0.3, 1234);
    for (let i = 0; i < 20; i++) independent.step();
    const expectedTick = independent.tick;
    const expectedSnapshot = independent.snapshot();

    // A LiveHub now exists and runs concurrently, with its own entirely separate Simulation.
    const { hub, timers } = makeHub({ seed: 999 });
    hub.addClient(fakeSocket());
    hub.start();
    for (let i = 0; i < 50; i++) timers.fireInterval(TICK_MS);

    expect(independent.tick).toBe(expectedTick);
    expect(independent.snapshot()).toEqual(expectedSnapshot);
  });
});

describe('REAL_TIMERS', () => {
  it('schedules and cancels using the real setInterval/clearInterval', () => {
    return new Promise<void>((resolve) => {
      const handle = REAL_TIMERS.setInterval(() => {
        throw new Error('should have been cancelled');
      }, 10);
      REAL_TIMERS.clearInterval(handle);
      setTimeout(resolve, 15);
    });
  });
});
