/**
 * The `/live` exhibition grid (ADR-002, P1-G-3) — the inception document's "State Sync", scoped
 * honestly: one shared, always-running Conway's Life world anybody can watch, never anybody's
 * own simulation (that always runs client-side, in a Worker, ADR-006 — nothing in this file ever
 * touches it, "watching /live never interferes with the viewer's own local simulation").
 *
 * Owns exactly one `Simulation`, steps it at a fixed rate, and broadcasts the resulting
 * `ChangeSet` as a {@link LiveDeltaMessage} to every client that's keeping up — a full
 * {@link LiveKeyframeMessage} on join, and again to any client that fell behind
 * (`bufferedAmount` over the threshold) once it has fully drained, never by disconnecting it.
 * A heartbeat ping/pong reaps sockets that stop responding at all, independent of that
 * backpressure policy — a slow-but-alive client and a genuinely dead one are different problems
 * with different fixes.
 *
 * Every impure dependency is injected: {@link LiveSocket} is the minimal `ws.WebSocket` surface
 * this file needs (a real one satisfies it with no adapter), and {@link Timers} is the same
 * `setInterval`/`clearInterval` shape this project's other timer-driven modules already use —
 * so the whole broadcast/backpressure/heartbeat policy is unit-testable with fake sockets and a
 * fake clock, no real network or wall-clock waiting required.
 */
import { Simulation } from '../engine/simulation.js';
import { CONWAY } from '../engine/rules/builtin/life.js';
import type { RuleSet } from '../shared/types.js';
import {
  LIVE_PROTOCOL_VERSION,
  type LiveCell,
  type LiveDeltaMessage,
  type LiveKeyframeMessage,
} from '../shared/live-protocol.js';

/** `WebSocket.OPEN`'s value, per the (stable, version-1) WebSocket protocol spec — duplicated as
 * a literal so this file never needs to import `ws` for one constant. */
const OPEN = 1;

/** The minimal `ws.WebSocket` surface this hub needs. A real one satisfies this with no adapter;
 * a test hands in a plain object. */
export interface LiveSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  ping(): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  on(event: 'pong', listener: () => void): void;
}

/** The same `setInterval`/`clearInterval` shape `client/session.ts`'s `Timers` uses for
 * `setTimeout`/`clearTimeout` — each timer-driven module keeps its own copy (that file's own
 * doc explains why) rather than sharing one. */
export interface Timers {
  setInterval(fn: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

export const REAL_TIMERS: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clearInterval: (handle) => clearInterval(handle),
};

export interface LiveHubOptions {
  /** Defaults to `CONWAY` (already `boundary: 'toroidal'`, so the exhibition wraps forever
   * instead of running into a bounded edge). */
  readonly ruleset?: RuleSet;
  readonly width?: number;
  readonly height?: number;
  readonly seedDensity?: number;
  readonly seed?: number;
  /** Broadcast period. Defaults to 100 (10 Hz, this task's own figure). */
  readonly tickIntervalMs?: number;
  readonly maxClients?: number;
  /** Bytes. A client whose `bufferedAmount` exceeds this stops receiving deltas until it fully
   * drains (`bufferedAmount === 0`), at which point it gets a fresh keyframe instead of the next
   * delta. */
  readonly bufferedAmountThreshold?: number;
  readonly heartbeatIntervalMs?: number;
  readonly timers?: Timers;
}

const DEFAULTS = {
  width: 128,
  height: 128,
  seedDensity: 0.35,
  seed: 0x9e3779b9,
  tickIntervalMs: 100,
  maxClients: 200,
  bufferedAmountThreshold: 64 * 1024,
  heartbeatIntervalMs: 30_000,
} as const;

interface ClientState {
  /** True while this socket is over the backpressure threshold and being skipped. */
  stalled: boolean;
  /** Heartbeat liveness — set on every `pong`, cleared (then checked) on every heartbeat tick. */
  isAlive: boolean;
}

/**
 * Owns the exhibition `Simulation` and every connected client's backpressure/heartbeat state.
 * `start()`/`stop()` control the broadcast and heartbeat timers; `addClient()`/`removeClient()`
 * are what `routes/live.ts`'s actual `ws.WebSocketServer` wiring calls on `connection`/`close`.
 */
export class LiveHub {
  private readonly sim: Simulation;
  private readonly ruleset: RuleSet;
  private readonly clients = new Map<LiveSocket, ClientState>();
  private readonly timers: Timers;
  private readonly maxClients: number;
  private readonly bufferedAmountThreshold: number;
  private readonly tickIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private tickHandle: number | null = null;
  private heartbeatHandle: number | null = null;

  constructor(options: LiveHubOptions = {}) {
    this.timers = options.timers ?? REAL_TIMERS;
    this.maxClients = options.maxClients ?? DEFAULTS.maxClients;
    this.bufferedAmountThreshold = options.bufferedAmountThreshold ?? DEFAULTS.bufferedAmountThreshold;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULTS.tickIntervalMs;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs;
    this.ruleset = options.ruleset ?? CONWAY;
    const seed = options.seed ?? DEFAULTS.seed;
    this.sim = new Simulation({
      ruleset: this.ruleset,
      width: options.width ?? DEFAULTS.width,
      height: options.height ?? DEFAULTS.height,
      seed,
    });
    this.sim.seedRandom(options.seedDensity ?? DEFAULTS.seedDensity, seed);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get tick(): number {
    return this.sim.tick;
  }

  /** Starts the broadcast and heartbeat timers. Idempotent — a second call is a no-op. */
  start(): void {
    this.tickHandle ??= this.timers.setInterval(() => this.stepAndBroadcast(), this.tickIntervalMs);
    this.heartbeatHandle ??= this.timers.setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
  }

  stop(): void {
    if (this.tickHandle !== null) {
      this.timers.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    if (this.heartbeatHandle !== null) {
      this.timers.clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }

  /**
   * Registers `socket` and immediately sends it a keyframe. Returns `false` (and registers
   * nothing) once `maxClients` is already reached — `routes/live.ts` is expected to close a
   * rejected socket itself; this hub never holds one it didn't accept.
   */
  addClient(socket: LiveSocket): boolean {
    if (this.clients.size >= this.maxClients) return false;
    const state: ClientState = { stalled: false, isAlive: true };
    this.clients.set(socket, state);
    socket.on('pong', () => {
      state.isAlive = true;
    });
    socket.send(JSON.stringify(this.buildKeyframe()));
    return true;
  }

  removeClient(socket: LiveSocket): void {
    this.clients.delete(socket);
  }

  private buildKeyframe(): LiveKeyframeMessage {
    const view = this.sim.view();
    const bounds = view.bounds();
    const cells: LiveCell[] = [];
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        const state = view.get(x, y);
        if (state !== 0) cells.push([x, y, state]);
      }
    }
    return {
      type: 'keyframe',
      version: LIVE_PROTOCOL_VERSION,
      tick: this.sim.tick,
      ruleset: this.ruleset,
      bounds,
      cells,
    };
  }

  private stepAndBroadcast(): void {
    const changeSet = this.sim.step();
    const changes = new Array<LiveCell>(changeSet.count);
    for (let i = 0; i < changeSet.count; i++) {
      const packed = changeSet.coords[i]!;
      const x = packed >> 16;
      const y = (packed << 16) >> 16;
      changes[i] = [x, y, changeSet.to[i]!];
    }
    const delta: LiveDeltaMessage = { type: 'delta', tick: this.sim.tick, changes };
    const deltaText = JSON.stringify(delta);

    for (const [socket, state] of this.clients) {
      if (socket.readyState !== OPEN) continue;

      if (state.stalled) {
        // Only a full drain counts as "caught up" — a client that merely dipped below the
        // threshold is still behind on every delta it already missed; only a keyframe repairs
        // that, and there is no point sending one until nothing is still queued ahead of it.
        if (socket.bufferedAmount === 0) {
          state.stalled = false;
          socket.send(JSON.stringify(this.buildKeyframe()));
        }
        continue;
      }

      if (socket.bufferedAmount > this.bufferedAmountThreshold) {
        state.stalled = true;
        continue;
      }

      socket.send(deltaText);
    }
  }

  private heartbeat(): void {
    for (const [socket, state] of this.clients) {
      if (!state.isAlive) {
        socket.terminate();
        this.clients.delete(socket);
        continue;
      }
      state.isAlive = false;
      socket.ping();
    }
  }
}
