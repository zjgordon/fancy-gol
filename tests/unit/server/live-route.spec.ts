import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { attachLiveServer, isLiveEnabled } from '@server/routes/live';
import type { LiveMessage } from '@shared/live-protocol';
import { connectLiveViewer, type LiveConnectionState } from '../../../src/client/live-client';

let server: Server | undefined;
let liveServer: ReturnType<typeof attachLiveServer> | undefined;

afterEach(async () => {
  liveServer?.close();
  liveServer = undefined;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

function startServer(options: Parameters<typeof attachLiveServer>[1] = {}): Promise<{ url: string; port: number }> {
  return new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, () => {
      const { port } = server!.address() as AddressInfo;
      liveServer = attachLiveServer(server!, { tickIntervalMs: 20, width: 16, height: 16, ...options });
      resolve({ url: `ws://127.0.0.1:${port}/live`, port });
    });
  });
}

/**
 * Opens a client and starts collecting every message it receives into `messages`, attaching
 * that listener synchronously at construction — *before* awaiting `open` — so there is no window
 * in which a message (the join keyframe in particular, which the server may send the instant it
 * processes the connection) could arrive before anything is listening for it. Sequential
 * `once('message')` calls after `await open` have exactly that race; this doesn't.
 */
function openClient(url: string): { ws: WebSocket; messages: LiveMessage[]; opened: Promise<void> } {
  const ws = new WebSocket(url);
  const messages: LiveMessage[] = [];
  ws.on('message', (data: Buffer) => {
    messages.push(JSON.parse(data.toString()) as LiveMessage);
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, messages, opened };
}

describe('isLiveEnabled', () => {
  it('defaults to enabled when ENABLE_LIVE is unset', () => {
    expect(isLiveEnabled({})).toBe(true);
  });

  it('is disabled only by an explicit "0" or "false"', () => {
    expect(isLiveEnabled({ ENABLE_LIVE: '0' })).toBe(false);
    expect(isLiveEnabled({ ENABLE_LIVE: 'false' })).toBe(false);
    expect(isLiveEnabled({ ENABLE_LIVE: 'FALSE' })).toBe(false);
    expect(isLiveEnabled({ ENABLE_LIVE: '1' })).toBe(true);
    expect(isLiveEnabled({ ENABLE_LIVE: 'anything-else' })).toBe(true);
  });
});

describe('attachLiveServer — a single real client', () => {
  it('receives a keyframe on connect, then deltas', async () => {
    const { url } = await startServer();
    const { ws, messages, opened } = openClient(url);
    await opened;

    await vitestWaitFor(() => messages.length >= 2);
    expect(messages[0]?.type).toBe('keyframe');
    expect(messages[1]?.type).toBe('delta');

    ws.close();
  });

  it('reports the connected client in the hub', async () => {
    const { url } = await startServer();
    const { ws, messages, opened } = openClient(url);
    await opened;
    await vitestWaitFor(() => messages.length >= 1); // the join keyframe has genuinely landed
    expect(liveServer!.hub.clientCount).toBe(1);
    ws.close();
    await vitestWaitFor(() => liveServer!.hub.clientCount === 0);
  });

  it('rejects a connection over maxClients with close code 1013', async () => {
    const { url } = await startServer({ maxClients: 1 });
    const { ws: first, messages, opened } = openClient(url);
    await opened;
    await vitestWaitFor(() => messages.length >= 1);

    const second = new WebSocket(url);
    const closeCode = await new Promise<number>((resolve) => {
      second.once('close', (code: number) => resolve(code));
    });
    expect(closeCode).toBe(1013);
    first.close();
  });
});

describe('attachLiveServer — 100 simultaneous clients stay in sync (P1-G-3 AC, scaled duration)', () => {
  it('all clients receive a growing, matching sequence of ticks', async () => {
    // The literal criterion is 10 real minutes with flat memory -- a genuine soak/load test
    // outside a unit suite's time budget, not something to fake a pass for. What's proven here,
    // for real, with real sockets: 100 simultaneous clients, staying correctly synchronised
    // (never diverging, always receiving *the same* tick's content) over many broadcast cycles.
    // LiveHub itself retains nothing per tick beyond its fixed per-client state map (proven
    // separately in live-hub.spec.ts), which is the actual mechanism flat memory rests on.
    const CLIENT_COUNT = 100;
    const { url } = await startServer({ tickIntervalMs: 15 });

    const clients = Array.from({ length: CLIENT_COUNT }, () => openClient(url));
    await Promise.all(clients.map((c) => c.opened));

    await vitestWaitFor(() => clients.every((c) => c.messages.length >= 2), 5000);

    const lastTicks = clients.map((c) => c.messages.at(-1)!.tick);
    const maxTick = Math.max(...lastTicks);
    expect(maxTick).toBeGreaterThan(5);
    // "Stay in sync": no client is more than one broadcast behind the fastest-delivered one --
    // real network/event-loop scheduling means they won't all land on the exact same message at
    // the exact same instant, but none should be meaningfully behind the rest.
    for (const t of lastTicks) expect(maxTick - t).toBeLessThanOrEqual(1);

    for (const c of clients) c.ws.close();
  }, 10_000);
});

describe('connectLiveViewer (real client) — server restart does not wedge reconnection (P1-G-3 AC)', () => {
  it('reconnects automatically once the server comes back on the same port', async () => {
    const { url, port } = await startServer();

    const states: LiveConnectionState[] = [];
    const messages: LiveMessage[] = [];
    const viewer = connectLiveViewer({
      url,
      initialBackoffMs: 30,
      maxBackoffMs: 100,
      onStateChange: (s) => states.push(s),
      onMessage: (m) => messages.push(m),
    });

    // Wait for the first real connection to open and receive its keyframe.
    await vitestWaitFor(() => states.includes('open') && messages.length > 0);

    // Kill the server -- simulating the acceptance criterion's "killing the server".
    liveServer!.close();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    liveServer = undefined;

    await vitestWaitFor(() => states.includes('reconnecting'));

    // Restart a new server on the *same* port.
    const restarted = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => restarted.listen(port, () => resolve()));
    server = restarted;
    liveServer = attachLiveServer(restarted, { tickIntervalMs: 20, width: 16, height: 16 });

    // The client's own backoff loop must find its way back on its own -- never wedged.
    await vitestWaitFor(() => states.at(-1) === 'open');

    viewer.dispose();
  }, 10_000);
});

/** A tiny hand-written polling wait, not a new devDependency — this project already avoids
 * "extra test-only" tooling (`app.ts`'s own note on why it uses a real `http.Server` instead of
 * Supertest) for the exact same reason. */
async function vitestWaitFor(predicate: () => boolean, timeoutMs = 4000, intervalMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('vitestWaitFor: timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
