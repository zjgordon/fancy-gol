import { describe, expect, it, vi } from 'vitest';
import {
  connectLiveViewer,
  REAL_TIMERS,
  type LiveClientSocket,
  type LiveConnectionState,
  type LiveSocketFactory,
  type Timers,
} from '../../../src/client/live-client';

function fakeTimers(): Timers & { pendingCount: number; fire(): void } {
  let handle = 0;
  const pending = new Map<number, () => void>();
  return {
    get pendingCount() {
      return pending.size;
    },
    setTimeout: (fn) => {
      const id = ++handle;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (id) => void pending.delete(id),
    fire: () => {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
  };
}

interface FakeSocket extends LiveClientSocket {
  readonly closeCalls: number;
  triggerOpen(): void;
  triggerMessage(data: unknown): void;
  triggerClose(): void;
}

function fakeSocketFactory(): { factory: LiveSocketFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const factory: LiveSocketFactory = () => {
    let closeCalls = 0;
    const socket: FakeSocket = {
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      close: () => {
        closeCalls++;
      },
      get closeCalls() {
        return closeCalls;
      },
      triggerOpen: () => socket.onopen?.(),
      triggerMessage: (data) => socket.onmessage?.({ data }),
      triggerClose: () => socket.onclose?.(),
    };
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
}

const KEYFRAME = {
  type: 'keyframe',
  version: 1,
  tick: 0,
  ruleset: { id: 'conway', name: 'Conway', states: [], neighborhood: { kind: 'moore', radius: 1 }, transition: { kind: 'totalistic', born: [3], survive: [2, 3] }, boundary: 'toroidal' },
  bounds: { x: 0, y: 0, width: 4, height: 4 },
  cells: [],
};

describe('connectLiveViewer — connection lifecycle', () => {
  it('connects immediately and reports "open" once the socket opens', () => {
    const { factory, sockets } = fakeSocketFactory();
    const states: LiveConnectionState[] = [];
    connectLiveViewer({ url: 'wss://example.test/live', socketFactory: factory, timers: fakeTimers(), onStateChange: (s) => states.push(s) });

    expect(sockets).toHaveLength(1);
    sockets[0]!.triggerOpen();
    expect(states).toContain('open');
  });

  it('parses and forwards a valid keyframe message', () => {
    const { factory, sockets } = fakeSocketFactory();
    const onMessage = vi.fn();
    connectLiveViewer({ url: 'wss://x/live', socketFactory: factory, timers: fakeTimers(), onMessage });
    sockets[0]!.triggerOpen();
    sockets[0]!.triggerMessage(JSON.stringify(KEYFRAME));
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]?.[0]).toEqual(KEYFRAME);
  });

  it('silently ignores an unparseable or malformed message rather than crashing', () => {
    const { factory, sockets } = fakeSocketFactory();
    const onMessage = vi.fn();
    connectLiveViewer({ url: 'wss://x/live', socketFactory: factory, timers: fakeTimers(), onMessage });
    sockets[0]!.triggerOpen();
    expect(() => sockets[0]!.triggerMessage('not json')).not.toThrow();
    expect(() => sockets[0]!.triggerMessage(JSON.stringify({ nonsense: true }))).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('connectLiveViewer — reconnection with exponential backoff (P1-G-3 AC)', () => {
  it('schedules a reconnect after the socket closes, and it never wedges', () => {
    const { factory, sockets } = fakeSocketFactory();
    const timers = fakeTimers();
    const states: LiveConnectionState[] = [];
    connectLiveViewer({ url: 'wss://x/live', socketFactory: factory, timers, initialBackoffMs: 100, onStateChange: (s) => states.push(s) });

    sockets[0]!.triggerOpen();
    sockets[0]!.triggerClose();
    expect(states.at(-1)).toBe('reconnecting');
    expect(timers.pendingCount).toBe(1);

    timers.fire(); // the scheduled reconnect actually fires
    expect(sockets).toHaveLength(2); // a genuinely new socket was created, not a stuck retry
  });

  it('doubles the delay on each successive failure, capped at maxBackoffMs', () => {
    const { factory, sockets } = fakeSocketFactory();
    const timers = fakeTimers();
    const delays: number[] = [];
    const originalSetTimeout = timers.setTimeout.bind(timers);
    timers.setTimeout = (fn, ms) => {
      delays.push(ms);
      return originalSetTimeout(fn, ms);
    };

    connectLiveViewer({ url: 'wss://x/live', socketFactory: factory, timers, initialBackoffMs: 100, maxBackoffMs: 500 });

    // Never successfully opens -- every attempt closes immediately, so backoff keeps growing.
    for (let i = 0; i < 5; i++) {
      sockets.at(-1)!.triggerClose();
      timers.fire();
    }

    expect(delays.slice(0, 4)).toEqual([100, 200, 400, 500]); // doubles, then caps at 500
  });

  it('resets the backoff to initialBackoffMs once a connection genuinely opens', () => {
    const { factory, sockets } = fakeSocketFactory();
    const timers = fakeTimers();
    const delays: number[] = [];
    const originalSetTimeout = timers.setTimeout.bind(timers);
    timers.setTimeout = (fn, ms) => {
      delays.push(ms);
      return originalSetTimeout(fn, ms);
    };

    connectLiveViewer({ url: 'wss://x/live', socketFactory: factory, timers, initialBackoffMs: 100 });

    sockets[0]!.triggerClose(); // first failure, before ever opening
    timers.fire(); // reconnect attempt 2
    sockets.at(-1)!.triggerOpen(); // this one succeeds -- backoff should reset
    sockets.at(-1)!.triggerClose(); // fails again after having been open

    expect(delays).toEqual([100, 100]); // second failure's delay is back to the initial value, not 200
  });

  it('does not schedule a reconnect after dispose(), and closes the live socket', () => {
    const { factory, sockets } = fakeSocketFactory();
    const timers = fakeTimers();
    const viewer = connectLiveViewer({ url: 'wss://x/live', socketFactory: factory, timers });
    sockets[0]!.triggerOpen();

    viewer.dispose();
    expect(sockets[0]!.closeCalls).toBe(1);
    expect(viewer.state).toBe('closed');

    sockets[0]!.triggerClose(); // a stray close event after dispose must not schedule anything
    expect(timers.pendingCount).toBe(0);
  });

  it('cancels a pending reconnect timer on dispose()', () => {
    const { factory, sockets } = fakeSocketFactory();
    const timers = fakeTimers();
    const viewer = connectLiveViewer({ url: 'wss://x/live', socketFactory: factory, timers, initialBackoffMs: 100 });
    sockets[0]!.triggerOpen();
    sockets[0]!.triggerClose(); // schedules a reconnect
    expect(timers.pendingCount).toBe(1);

    viewer.dispose();
    expect(timers.pendingCount).toBe(0);
  });
});

describe('REAL_WEBSOCKET_FACTORY / REAL_TIMERS', () => {
  it('REAL_TIMERS schedules and cancels using the real setTimeout/clearTimeout', () => {
    return new Promise<void>((resolve) => {
      const handle = REAL_TIMERS.setTimeout(() => {
        throw new Error('should have been cancelled');
      }, 10);
      REAL_TIMERS.clearTimeout(handle);
      REAL_TIMERS.setTimeout(resolve, 15);
    });
  });
});
