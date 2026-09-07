/**
 * `/live` (ADR-002, P1-G-3): wires a `ws.WebSocketServer` onto an already-listening
 * `http.Server` at one path, delegating every broadcast/backpressure/heartbeat/capacity
 * decision to `LiveHub`. Not an Express route — a WebSocket upgrade happens at the raw HTTP
 * server level, so `attachLiveServer` is called *after* `server.listen()`, not mounted via
 * `app.use()` the way every `/api/*` route is (`server/index.ts`'s own boot sequence, or a
 * test's `beforeEach`, both call it the same way).
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { LiveHub, type LiveHubOptions } from '../live-hub.js';

export interface AttachLiveOptions extends LiveHubOptions {
  /** Defaults to `/live`. */
  readonly path?: string;
}

export interface LiveServer {
  readonly hub: LiveHub;
  close(): void;
}

/** RFC 6455 §7.4.1 policy-violation-adjacent code, used here for "server is at capacity" — a
 * real close reason, not a bare connection drop, for a socket the hub never even registered. */
const CLOSE_TRY_AGAIN_LATER = 1013;

/**
 * `/live` is a documented opt-*out* feature flag today, not opt-in despite `ENABLE_LIVE`'s name
 * (Phase 1's own risk-mitigation note: "default on locally... reviewed before any public deploy
 * in Phase 6") — only an explicit `ENABLE_LIVE=0`/`false` turns it off. Revisiting the default
 * for a public deploy is Phase 6's own job, not guessed at here.
 */
export function isLiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env['ENABLE_LIVE'];
  return flag !== '0' && flag?.toLowerCase() !== 'false';
}

export function attachLiveServer(server: Server, options: AttachLiveOptions = {}): LiveServer {
  const hub = new LiveHub(options);
  const wss = new WebSocketServer({ server, path: options.path ?? '/live' });

  wss.on('connection', (socket: WebSocket) => {
    const accepted = hub.addClient(socket);
    if (!accepted) {
      socket.close(CLOSE_TRY_AGAIN_LATER, 'Try Again Later');
      return;
    }
    socket.on('close', () => hub.removeClient(socket));
  });

  hub.start();

  return {
    hub,
    close: () => {
      hub.stop();
      // `wss.close()` alone only stops *accepting new* connections — by the `ws` library's own
      // documented behaviour it never touches already-open clients, which would otherwise leave
      // the underlying `http.Server`'s own `close()` waiting indefinitely for upgraded
      // connections that are never going to end on their own. A real process kill (this task's
      // own "killing the server" acceptance criterion) drops every socket at once; this is what
      // makes that simulation honest instead of a graceful shutdown that quietly never finishes.
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
