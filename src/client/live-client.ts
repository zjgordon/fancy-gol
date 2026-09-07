/**
 * A reconnecting `/live` viewer connection (P1-G-3's own "killing and restarting the server does
 * not wedge reconnecting clients" acceptance criterion — not in that task's own `Files:` list,
 * but nothing else in Phase 1 claims it and the criterion is unmeetable without real client-side
 * reconnect logic, the same "this task's own file list was incomplete, no other task owns the
 * gap" situation `server/store/file-store.ts` (P1-G-1) and `server/routes/sessions.ts` (P1-F-2)
 * were both in).
 *
 * No rendering, no grid reconstruction: Phase 1 has no `/live`-viewing UI in any workstream (only
 * `P1-H-1`'s own Playwright spec list names "`/live` connect and receive" at all) — this is the
 * connection-resilience half a future UI task would sit on top of, via `onMessage`/
 * `onStateChange` callbacks, the same "this task builds the seam" split already applied
 * throughout Phase 1's server work.
 *
 * Every impure dependency — how a socket is actually created, and how a reconnect is scheduled —
 * is injected, the same discipline `server/live-hub.ts`'s `LiveSocket`/`Timers` already
 * establishes for the *server* side of this exact feature.
 */
import { parseLiveMessage, type LiveMessage } from '@shared/live-protocol';

export type LiveConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** The subset of the browser's own `WebSocket` this file needs — property-assigned handlers
 * (`onopen`/`onmessage`/...), not `EventTarget`'s `addEventListener`, because that *is* the real
 * `WebSocket`'s own shape; a fake test double satisfies this far more simply than emulating
 * `EventTarget`. Node's own global `WebSocket` (stable since Node 22) already satisfies this
 * too, which is what lets a test exercise {@link REAL_WEBSOCKET_FACTORY} for real without a
 * browser. */
export interface LiveClientSocket {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  close(): void;
}

export type LiveSocketFactory = (url: string) => LiveClientSocket;

export const REAL_WEBSOCKET_FACTORY: LiveSocketFactory = (url) => new WebSocket(url) as unknown as LiveClientSocket;

/** The same minimal `setTimeout`/`clearTimeout` shape `client/session.ts`'s own `Timers`
 * already uses — each timer-driven module keeps its own copy (that file's own doc explains why)
 * rather than sharing one. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

export interface LiveViewerOptions {
  readonly url: string;
  readonly socketFactory?: LiveSocketFactory;
  readonly timers?: Timers;
  readonly onMessage?: (message: LiveMessage) => void;
  readonly onStateChange?: (state: LiveConnectionState) => void;
  /** First reconnect delay, doubled after every further failed attempt up to
   * {@link LiveViewerOptions.maxBackoffMs}. Defaults to 500. */
  readonly initialBackoffMs?: number;
  /** Defaults to 30000. */
  readonly maxBackoffMs?: number;
}

export interface LiveViewer {
  readonly state: LiveConnectionState;
  dispose(): void;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Connects to `options.url` immediately, and on every close or error reconnects with
 * exponentially increasing backoff (capped at `maxBackoffMs`) — the backoff resets to
 * `initialBackoffMs` only once a connection genuinely reaches `open` again, so a server that's
 * merely slow to come back is retried with patience, not a hot loop, and a server that *has*
 * come back is caught up on quickly rather than left waiting out a long-since-irrelevant delay.
 * Never gives up on its own; call {@link LiveViewer.dispose} to stop trying.
 */
export function connectLiveViewer(options: LiveViewerOptions): LiveViewer {
  const socketFactory = options.socketFactory ?? REAL_WEBSOCKET_FACTORY;
  const timers = options.timers ?? REAL_TIMERS;
  const initialBackoffMs = options.initialBackoffMs ?? 500;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;

  let backoffMs = initialBackoffMs;
  let disposed = false;
  let state: LiveConnectionState = 'connecting';
  let reconnectHandle: number | null = null;
  let currentSocket: LiveClientSocket | null = null;

  function setState(next: LiveConnectionState): void {
    state = next;
    options.onStateChange?.(next);
  }

  function connect(): void {
    if (disposed) return;
    const socket = socketFactory(options.url);
    currentSocket = socket;

    socket.onopen = () => {
      backoffMs = initialBackoffMs;
      setState('open');
    };

    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? safeJsonParse(event.data) : null;
      const message = raw !== null ? parseLiveMessage(raw) : null;
      if (message) options.onMessage?.(message);
    };

    socket.onclose = () => {
      if (disposed) return;
      setState('reconnecting');
      reconnectHandle = timers.setTimeout(() => {
        reconnectHandle = null;
        connect();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    };

    // A real WebSocket always follows an error with a close event — nothing extra to schedule
    // here; onclose above is the one and only reconnect trigger.
    socket.onerror = () => {};
  }

  connect();

  return {
    get state() {
      return state;
    },
    dispose() {
      disposed = true;
      if (reconnectHandle !== null) {
        timers.clearTimeout(reconnectHandle);
        reconnectHandle = null;
      }
      currentSocket?.close();
      currentSocket = null;
      setState('closed');
    },
  };
}
