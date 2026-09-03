import { describe, expect, it, vi } from 'vitest';
import { installGracefulShutdown, type CloseableServer, type SignalSource } from '@server/app';

/** Captures registered listeners so a test can invoke one directly instead of sending a real OS signal. */
function fakeSignalSource(): SignalSource & { emit(event: string): void } {
  const listeners = new Map<string, () => void>();
  return {
    on(event, listener) {
      listeners.set(event, listener);
    },
    emit(event) {
      listeners.get(event)?.();
    },
  };
}

function fakeServer(close: CloseableServer['close']): CloseableServer {
  return { close };
}

describe('installGracefulShutdown', () => {
  it('on signal, closes the server and exits 0 once close succeeds', () => {
    const signalSource = fakeSignalSource();
    const exit = vi.fn();
    let closeCallback: ((err?: Error) => void) | undefined;
    const server = fakeServer((cb) => (closeCallback = cb));

    installGracefulShutdown(server, { signalSource, exit });
    signalSource.emit('SIGTERM');

    expect(exit).not.toHaveBeenCalled(); // still waiting on close()
    closeCallback?.();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 if server.close() reports an error', () => {
    const signalSource = fakeSignalSource();
    const exit = vi.fn();
    let closeCallback: ((err?: Error) => void) | undefined;
    const server = fakeServer((cb) => (closeCallback = cb));

    installGracefulShutdown(server, { signalSource, exit });
    signalSource.emit('SIGTERM');
    closeCallback?.(new Error('a connection refused to drain'));

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('force-exits 1 after timeoutMs if server.close() never calls back', () => {
    vi.useFakeTimers();
    try {
      const signalSource = fakeSignalSource();
      const exit = vi.fn();
      const server = fakeServer(() => {
        /* never calls back — a stuck connection holding the listener open */
      });

      installGracefulShutdown(server, { signalSource, exit, timeoutMs: 5000 });
      signalSource.emit('SIGTERM');

      vi.advanceTimersByTime(4999);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the force-exit timer is cancelled once close() succeeds first, so it never double-exits', () => {
    vi.useFakeTimers();
    try {
      const signalSource = fakeSignalSource();
      const exit = vi.fn();
      let closeCallback: ((err?: Error) => void) | undefined;
      const server = fakeServer((cb) => (closeCallback = cb));

      installGracefulShutdown(server, { signalSource, exit, timeoutMs: 5000 });
      signalSource.emit('SIGTERM');
      closeCallback?.();
      vi.advanceTimersByTime(10_000);

      expect(exit).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('registers every signal in a custom signals list, and defaults to just SIGTERM', () => {
    const signalSource = fakeSignalSource();
    const onSpy = vi.spyOn(signalSource, 'on');
    const server = fakeServer(() => undefined);

    installGracefulShutdown(server, { signalSource, signals: ['SIGTERM', 'SIGINT'] });
    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(onSpy.mock.calls.map(([event]) => event)).toEqual(['SIGTERM', 'SIGINT']);

    const defaultSource = fakeSignalSource();
    const defaultOnSpy = vi.spyOn(defaultSource, 'on');
    installGracefulShutdown(server, { signalSource: defaultSource });
    expect(defaultOnSpy.mock.calls.map(([event]) => event)).toEqual(['SIGTERM']);
  });
});
