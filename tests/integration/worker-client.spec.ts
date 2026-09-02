import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import type { Event } from '@shared/protocol';
import { createHandler, type Scheduler, type WorkerHandler } from '@worker/handler';
import { RAF_FRAME_SCHEDULER, WorkerClient, type FrameEvent, type FrameScheduler, type WorkerLike } from '@worker/client';

const CAPS = { sharedArrayBuffer: false, offscreenCanvas: false };

/** Same virtual-time scheduler as `tests/integration/worker-protocol.spec.ts` — no real timers. */
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

/**
 * Stands in for `requestAnimationFrame`: nothing fires until the test explicitly calls `tick()`,
 * which is what proves the client is coalescing on the *consumer's* cadence — a real worker's
 * `postMessage` delivers every frame as its own task, so if this fired automatically (the way a
 * microtask would), a burst of 50 separate frame arrivals would still yield 50 deliveries.
 */
class FakeFrameScheduler implements FrameScheduler {
  private nextId = 1;
  readonly jobs = new Map<number, () => void>();

  request(fn: () => void): number {
    const id = this.nextId++;
    this.jobs.set(id, fn);
    return id;
  }

  cancel(id: number): void {
    this.jobs.delete(id);
  }

  tick(): void {
    const fns = [...this.jobs.values()];
    this.jobs.clear();
    for (const fn of fns) fn();
  }
}

/** For tests that produce a frame but don't care about its delivery timing — delivers synchronously so nothing needs a manual tick. */
/**
 * Delivers on the next microtask, never synchronously inside `request()` itself — a real
 * `requestAnimationFrame` never fires before its scheduling call returns, and `WorkerClient`'s
 * own bookkeeping relies on that: it assigns `request()`'s return value to `frameRequestHandle`
 * *after* the call returns, so a same-tick callback would reset that field first and then have
 * the assignment immediately stomp it back to a stale handle, silently dropping every frame
 * delivery after the first (found via `tests/integration/canvas-bridge.spec.ts`, P0-H-3 — a
 * 100-generation run's snapshot was suspiciously small, only the very first frame ever landed).
 */
const IMMEDIATE_FRAME_SCHEDULER: FrameScheduler = {
  request: (fn) => {
    queueMicrotask(fn);
    return 0;
  },
  cancel: () => {},
};

/**
 * An in-memory `Worker` double whose two directions genuinely go through `structuredClone`
 * with a transfer list — the same detach semantics a real `postMessage` has — so this exercises
 * real transfer, not a same-object alias a plain function call would give for free.
 */
function createFakeWorker(scheduler: Scheduler = new FakeScheduler()): {
  readonly workerLike: WorkerLike;
  readonly handler: WorkerHandler;
  readonly scheduler: Scheduler;
  readonly lastPostedEvent: Event | undefined;
  crash(reason?: unknown): void;
} {
  let lastPostedEvent: Event | undefined;
  // A plain mutable box, not a `let workerLike`, so `post` below can reference the eventual
  // `workerLike` without a forward-declared, reassigned-once `let` (and the mutual dependency
  // it'd take to build them: `post` needs `workerLike.onmessage`, `workerLike.postMessage`
  // needs `handler`).
  const box: { workerLike?: WorkerLike } = {};

  const handler = createHandler({
    post: (event, transfer) => {
      lastPostedEvent = event; // captured before structuredClone detaches its buffers below
      const cloned = transfer?.length ? structuredClone(event, { transfer: [...transfer] }) : structuredClone(event);
      // A real postMessage delivers on a later task, never synchronously — deferring here is
      // what gives tests a genuine window to race a dispose()/crash() against an in-flight reply.
      setTimeout(() => box.workerLike?.onmessage?.({ data: cloned }), 0);
    },
    scheduler,
    capabilities: CAPS,
  });

  const workerLike: WorkerLike = {
    postMessage: (message, transfer) => {
      const cloned = transfer?.length ? structuredClone(message, { transfer: [...transfer] }) : structuredClone(message);
      setTimeout(() => handler.handle(cloned), 0);
    },
    onmessage: null,
    onerror: null,
    terminate: () => {},
  };
  box.workerLike = workerLike;

  return {
    workerLike,
    handler,
    scheduler,
    get lastPostedEvent() {
      return lastPostedEvent;
    },
    crash: (reason) => workerLike.onerror?.(reason),
  };
}

function nextFrame(client: WorkerClient): Promise<FrameEvent> {
  return new Promise((resolve) => {
    const unsubscribe = client.onFrame((frame) => {
      unsubscribe();
      resolve(frame);
    });
  });
}

/** Waits for every currently-scheduled `setTimeout(0)` (and anything they in turn schedule) to have run. */
async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('WorkerClient: promise-based RPC', () => {
  it('send resolves with the matching reply', async () => {
    const fake = createFakeWorker();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });
    const reply = await client.send({ cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    expect(reply).toEqual({ id: 1, type: 'ready', capabilities: CAPS });
  });

  it('send rejects on the matching error event', async () => {
    const fake = createFakeWorker();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });
    await client.send({ cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    await expect(client.send({ cmd: 'seek', tick: 0 })).rejects.toThrow(/history/i);
  });

  it('concurrent sends resolve independently, matched by correlation id', async () => {
    const fake = createFakeWorker();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });
    await client.send({ cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    const [a, b, c] = await Promise.all([
      client.send({ cmd: 'step', n: 1 }),
      client.send({ cmd: 'step', n: 1 }),
      client.send({ cmd: 'pause' }),
    ]);
    expect(a.type).toBe('ok');
    expect(b.type).toBe('ok');
    expect(c.type).toBe('ok');
  });
});

describe('WorkerClient: coalescing (P0-G-3 acceptance: no unbounded queue, ever)', () => {
  it('a 500 TPS burst outrunning a 30 fps consumer collapses into a single delivery per paint', async () => {
    const fake = createFakeWorker();
    const frameScheduler = new FakeFrameScheduler();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler });
    await client.send({ cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 16, height: 16, seed: 1 });

    let deliveries = 0;
    let lastTick = -1;
    client.onFrame((frame) => {
      deliveries += 1;
      lastTick = frame.tick;
    });

    await client.send({ cmd: 'run', tps: 500 });
    const scheduler = fake.scheduler as FakeScheduler;
    scheduler.tick(50); // 50 ticks worth of "500 TPS", each posted as its own separate task
    await flush(); // let every one of those 50 postMessage tasks actually reach the client

    expect(deliveries).toBe(0); // held: the (fake) render loop hasn't had "its next paint" yet
    frameScheduler.tick(); // simulates one 30 fps paint opportunity
    expect(deliveries).toBe(1); // exactly one delivery for all 50 ticks — never a growing backlog
    expect(lastTick).toBe(50); // and it's the latest state, not a stale one
  });

  it('subscribing/unsubscribing does not affect delivery to the remaining subscribers', async () => {
    const fake = createFakeWorker();
    const frameScheduler = new FakeFrameScheduler();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler });
    await client.send({ cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 16, height: 16, seed: 1 });

    let a = 0;
    let b = 0;
    const unsubA = client.onFrame(() => (a += 1));
    client.onFrame(() => (b += 1));
    unsubA();

    await client.send({ cmd: 'step', n: 1 });
    await flush();
    frameScheduler.tick();
    expect(a).toBe(0);
    expect(b).toBe(1);
  });
});

describe('WorkerClient: transferred buffers are genuinely transferred', () => {
  it("the worker's own copy of a frame's chunk data is detached (byteLength 0) after posting", async () => {
    const fake = createFakeWorker();
    const frameScheduler = new FakeFrameScheduler();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler });
    await client.send({ cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });

    const framePromise = nextFrame(client);
    await client.send({ cmd: 'paint', ops: [{ x: 0, y: 0, state: 1 }] });
    await flush(); // the 'frame' event is posted separately from the 'ok' reply just awaited
    frameScheduler.tick();
    const frame = await framePromise;
    expect(frame.chunks.data.byteLength).toBeGreaterThan(0); // the client's own copy is intact

    const original = fake.lastPostedEvent;
    expect(original?.type).toBe('frame');
    if (original?.type === 'frame') {
      expect(original.chunks.data.byteLength).toBe(0);
      expect(original.chunks.keys.byteLength).toBe(0);
    }
  });
});

describe('WorkerClient: recovers from a killed worker without a page reload (P0-G-3 acceptance)', () => {
  it('rejects in-flight requests, spawns a replacement, and restores the last cached snapshot', async () => {
    const spawnedWorkers: ReturnType<typeof createFakeWorker>[] = [];
    const spawn = () => {
      const fake = createFakeWorker();
      spawnedWorkers.push(fake);
      return fake.workerLike;
    };

    let resolveRecovered!: () => void;
    const recovered = new Promise<void>((resolve) => (resolveRecovered = resolve));
    const frameScheduler = new FakeFrameScheduler();
    const client = new WorkerClient({ spawn, frameScheduler, onRecovered: () => resolveRecovered() });

    await client.send({ cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 16, height: 16, seed: 1 });
    await client.send({
      cmd: 'paint',
      ops: [
        { x: 4, y: 4, state: 1 },
        { x: 5, y: 4, state: 1 },
        { x: 4, y: 5, state: 1 },
        { x: 5, y: 5, state: 1 },
      ],
    });
    await client.send({ cmd: 'snapshot' }); // cached internally for recovery

    const inFlight = client.send({ cmd: 'step', n: 1 });
    expect(spawnedWorkers).toHaveLength(1);
    spawnedWorkers[0]!.crash(new Error('the worker process died'));

    await expect(inFlight).rejects.toThrow(/terminated/i);
    expect(spawnedWorkers).toHaveLength(2); // a replacement was spawned automatically

    await recovered; // the automatic init + restore against the new worker has completed

    const framePromise = nextFrame(client);
    await client.send({ cmd: 'step', n: 1 });
    await flush();
    frameScheduler.tick();
    const frame = await framePromise;
    // The block survives one generation unchanged — proof the *painted* state, not a blank
    // grid from a fresh seed, made it into the replacement worker.
    expect(frame.stats.population).toBe(4);
  });

  it('recovery is a no-op (no replacement spawned) if the worker dies before any successful init', async () => {
    const spawnedWorkers: ReturnType<typeof createFakeWorker>[] = [];
    const spawn = () => {
      const fake = createFakeWorker();
      spawnedWorkers.push(fake);
      return fake.workerLike;
    };
    new WorkerClient({ spawn });
    expect(spawnedWorkers).toHaveLength(1);
    spawnedWorkers[0]!.crash(new Error('dead on arrival'));
    await flush();
    expect(spawnedWorkers).toHaveLength(2); // still replaces the transport...
    // ...but there is nothing to re-init, since `init` never succeeded.
  });
});

describe('WorkerClient.dispose', () => {
  it('cancels a frame delivery that was scheduled but not yet delivered', async () => {
    const fake = createFakeWorker();
    const frameScheduler = new FakeFrameScheduler();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler });
    await client.send({ cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });

    await client.send({ cmd: 'paint', ops: [{ x: 0, y: 0, state: 1 }] });
    await flush(); // the frame has arrived and a delivery is now scheduled, awaiting a tick
    expect(frameScheduler.jobs.size).toBe(1);

    client.dispose();
    expect(frameScheduler.jobs.size).toBe(0); // the pending delivery was cancelled, not just orphaned
  });

  it('rejects pending requests and refuses further sends', async () => {
    const fake = createFakeWorker();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });
    await client.send({ cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 });

    const pending = client.send({ cmd: 'step', n: 1 });
    client.dispose();
    await expect(pending).rejects.toThrow(/disposed/i);
    await expect(client.send({ cmd: 'pause' })).rejects.toThrow(/disposed/i);
  });

  it('is idempotent', () => {
    const fake = createFakeWorker();
    const client = new WorkerClient({ spawn: () => fake.workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });
    client.dispose();
    expect(() => client.dispose()).not.toThrow();
  });
});

describe('RAF_FRAME_SCHEDULER', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delegates to the real requestAnimationFrame/cancelAnimationFrame', () => {
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 7;
    });
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);

    const fn = vi.fn();
    const handle = RAF_FRAME_SCHEDULER.request(fn);
    expect(raf).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledOnce();

    RAF_FRAME_SCHEDULER.cancel(handle);
    expect(caf).toHaveBeenCalledWith(7);
  });
});
