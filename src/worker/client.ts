/**
 * P0-G-3 — `WorkerClient`, the main-thread half of ADR-006's protocol. Wraps anything shaped
 * like a `Worker` (see {@link WorkerLike} — a real one, or an in-memory double, so this stays
 * testable without a browser, the same way `handler.ts` and `sim.worker.ts` do) and gives the
 * UI two things: promise-based RPC over the correlation ids, and a coalescing `onFrame`
 * subscription.
 *
 * Backpressure: a `frame` event never queues. Only the latest one is ever retained; if another
 * arrives before the previous has been handed to subscribers, it silently replaces it. Delivery
 * itself is driven by an injected {@link FrameScheduler} (`requestAnimationFrame` by default) —
 * a real worker's `postMessage` delivers each frame as its own task, so a *microtask*-based
 * coalesce would still fire once per message; only deferring to the actual consumption cadence
 * (the render loop's next paint opportunity) collapses a fast free-run (hundreds of frame events
 * a second) against a much slower 30 fps consumer into a single delivery per paint.
 *
 * Recovery: if the underlying worker dies (`onerror`), the client transparently spawns a
 * replacement (`WorkerClientOptions.spawn`), re-sends the last successful `init`, and — if one
 * was ever taken — `restore`s the last cached `snapshot`. In-flight requests against the dead
 * worker are rejected; nothing here reloads the page or leaves the caller silently stalled.
 */
import { parseEvent, type Command, type Event } from '@shared/protocol';
import type { RuleSet, Snapshot } from '@shared/types';

export type FrameEvent = Extract<Event, { type: 'frame' }>;

type WithoutId<T> = T extends { readonly id: number } ? Omit<T, 'id'> : never;
/** Any `Command` minus its `id` — `WorkerClient.send` assigns the correlation id itself. */
export type CommandInput = WithoutId<Command>;

/**
 * The minimal surface `WorkerClient` needs from a `Worker`. A real `Worker` satisfies this
 * structurally; tests pass an in-memory double instead (see `tests/integration/worker-client`).
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/**
 * What decides *when* a coalesced frame reaches subscribers — deliberately not hard-wired to
 * `requestAnimationFrame`, so this stays headlessly testable (a fake scheduler that only fires
 * when a test explicitly ticks it) and reusable if the render loop ever drives itself some other
 * way.
 */
export interface FrameScheduler {
  request(fn: () => void): number;
  cancel(id: number): void;
}

/** The real `requestAnimationFrame`-backed scheduler, for real usage. Not used by this module on its own — always passed in explicitly, same pattern as `handler.ts`'s `REAL_SCHEDULER`. */
export const RAF_FRAME_SCHEDULER: FrameScheduler = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (id) => cancelAnimationFrame(id),
};

export interface WorkerClientOptions {
  /** Creates a fresh transport. Called once at construction, and again on recovery. */
  readonly spawn: () => WorkerLike;
  /** Defaults to {@link RAF_FRAME_SCHEDULER}. */
  readonly frameScheduler?: FrameScheduler;
  /** Notified (with no argument) each time recovery finishes re-`init`ing (and, if there was one, `restore`ing) a replacement worker. Optional — recovery happens regardless of whether anyone is listening. */
  readonly onRecovered?: () => void;
}

function transferablesFor(cmd: Command): Transferable[] | undefined {
  if (cmd.cmd === 'restore') return [cmd.snapshot.chunkKeys.buffer, cmd.snapshot.chunkData.buffer];
  return undefined;
}

function isEventWithId(e: Event): e is Extract<Event, { id: number }> {
  return 'id' in e;
}

interface PendingRequest {
  readonly resolve: (event: Event) => void;
  readonly reject: (reason: Error) => void;
}

export class WorkerClient {
  private readonly opts: WorkerClientOptions;
  private readonly frameScheduler: FrameScheduler;
  private worker: WorkerLike;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly frameSubscribers = new Set<(frame: FrameEvent) => void>();
  private latestFrame: FrameEvent | undefined;
  private frameRequestHandle: number | null = null;
  // Separate from frameRequestHandle so this is correct even if a FrameScheduler's `request()`
  // calls back synchronously (real requestAnimationFrame never does, but nothing enforces that
  // on an injected one): this flips true *before* request() is even called, so the callback
  // resetting it can't be raced by request()'s own return value being assigned afterwards.
  private frameDeliveryPending = false;
  private lastInit: { ruleset: RuleSet; width: number; height: number; seed: number } | undefined;
  private lastSnapshot: Snapshot | undefined;
  private disposed = false;

  constructor(opts: WorkerClientOptions) {
    this.opts = opts;
    this.frameScheduler = opts.frameScheduler ?? RAF_FRAME_SCHEDULER;
    this.worker = opts.spawn();
    this.wire(this.worker);
  }

  private wire(worker: WorkerLike): void {
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = () => this.handleWorkerDeath();
  }

  private handleMessage(raw: unknown): void {
    if (this.disposed) return; // a stale message from a transport whose replacement/teardown we've already moved on from
    const parsed = parseEvent(raw);
    if (!parsed.ok) return; // a malformed message from the wire is dropped, not fatal
    const event = parsed.value;

    if (event.type === 'frame') {
      this.latestFrame = event;
      this.scheduleFrameDelivery();
      return;
    }
    if (event.type === 'stats') return; // no Phase 0 consumer yet (Phase 2's stat engine)
    if (!isEventWithId(event)) return;

    const request = this.pending.get(event.id);
    if (!request) return; // a reply for a request we're no longer tracking (already timed out/disposed)
    this.pending.delete(event.id);
    if (event.type === 'error') {
      request.reject(new Error(`${event.code}: ${event.message}`));
    } else {
      request.resolve(event);
    }
  }

  /** Coalescing: collapse any burst of frames arriving before the scheduler's next opportunity into the single latest one. */
  private scheduleFrameDelivery(): void {
    if (this.frameDeliveryPending) return;
    this.frameDeliveryPending = true;
    this.frameRequestHandle = this.frameScheduler.request(() => {
      this.frameDeliveryPending = false;
      this.frameRequestHandle = null;
      const frame = this.latestFrame;
      this.latestFrame = undefined;
      if (!frame) return;
      for (const subscriber of this.frameSubscribers) subscriber(frame);
    });
  }

  /** Subscribe to coalesced frames. Returns an unsubscribe function. */
  onFrame(cb: (frame: FrameEvent) => void): () => void {
    this.frameSubscribers.add(cb);
    return () => this.frameSubscribers.delete(cb);
  }

  /** Send one command, assigning its correlation id. Resolves with the matching `ready`/`ok`, rejects with the matching `error`. */
  send(input: CommandInput): Promise<Event> {
    if (this.disposed) return Promise.reject(new Error('WorkerClient has been disposed'));
    const id = this.nextId++;
    const command = { ...input, id } as Command;

    if (command.cmd === 'init') {
      this.lastInit = {
        ruleset: command.ruleset,
        width: command.width,
        height: command.height,
        seed: command.seed,
      };
    }

    const reply = new Promise<Event>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(command, transferablesFor(command));
    });
    return reply.then((event) => {
      if (command.cmd === 'snapshot' && event.type === 'ok' && isSnapshot(event.result)) {
        this.lastSnapshot = event.result;
      }
      return event;
    });
  }

  /** Worker died mid-flight: fail whatever was waiting on it, then recover transparently — no page reload. */
  private handleWorkerDeath(): void {
    if (this.disposed) return;
    for (const request of this.pending.values()) {
      request.reject(new Error('worker terminated unexpectedly'));
    }
    this.pending.clear();
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }

    this.worker = this.opts.spawn();
    this.wire(this.worker);

    const init = this.lastInit;
    if (!init) return; // never successfully initialised; nothing to recover to
    void this.send({ cmd: 'init', ...init })
      .then(() => (this.lastSnapshot ? this.send({ cmd: 'restore', snapshot: this.lastSnapshot }) : undefined))
      .then(() => this.opts.onRecovered?.());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const request of this.pending.values()) {
      request.reject(new Error('WorkerClient disposed'));
    }
    this.pending.clear();
    this.frameSubscribers.clear();
    if (this.frameRequestHandle !== null) {
      this.frameScheduler.cancel(this.frameRequestHandle);
      this.frameRequestHandle = null;
    }
    this.frameDeliveryPending = false;
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
  }
}

function isSnapshot(v: unknown): v is Snapshot {
  return (
    typeof v === 'object' &&
    v !== null &&
    'chunkKeys' in v &&
    'chunkData' in v &&
    (v as Record<string, unknown>)['chunkKeys'] instanceof Int32Array &&
    (v as Record<string, unknown>)['chunkData'] instanceof Uint8Array
  );
}
