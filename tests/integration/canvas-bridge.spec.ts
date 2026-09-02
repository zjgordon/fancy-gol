import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { createHandler, type Scheduler } from '@worker/handler';
import { WorkerClient, type FrameScheduler, type WorkerLike } from '@worker/client';
import { FrameGridMirror } from '@worker/frame-view';
import { Canvas2DRenderer } from '@render/canvas2d';
import { CanvasRecorder } from '@render/recorder';
import type { CompiledTheme, Viewport } from '@render/types';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

/**
 * INCEPTION.md: "a 'headless' rendering test to ensure the engine can push state to a canvas
 * buffer without overhead." This is that test — the full worker → client → renderer pipeline,
 * in Node, with no `Worker`, no jsdom, no real canvas. Every fake here reuses the exact patterns
 * `tests/integration/worker-client.spec.ts` already established (P0-G-3): a `structuredClone(…,
 * { transfer })` transport for genuine detach semantics, and an injectable `Scheduler`/
 * `FrameScheduler` instead of real timers/`requestAnimationFrame`.
 */

const CAPS = { sharedArrayBuffer: false, offscreenCanvas: false };

class NoopScheduler implements Scheduler {
  setInterval(): number {
    throw new Error('not used: this suite drives step-by-step, never free-run');
  }
  clearInterval(): void {}
}

/**
 * Delivers on the next microtask, never synchronously inside `request()` itself — a real
 * `requestAnimationFrame` never fires before its scheduling call returns, and `WorkerClient`'s
 * own bookkeeping (`frameRequestHandle`) relies on that: assigning `request()`'s return value
 * happens *after* the call returns, so a same-tick callback would reset that field and then have
 * the assignment immediately stomp it back to a stale handle, silently dropping every frame
 * after the first. (Found by this suite: a 100-generation run's snapshot was suspiciously small
 * — only the first frame, from `paint`, was ever actually delivered.)
 */
const IMMEDIATE_FRAME_SCHEDULER: FrameScheduler = {
  request: (fn) => {
    queueMicrotask(fn);
    return 0;
  },
  cancel: () => {},
};

function createFakeWorker(): { workerLike: WorkerLike } {
  const box: { workerLike?: WorkerLike } = {};
  const handler = createHandler({
    post: (event, transfer) => {
      const cloned = transfer?.length ? structuredClone(event, { transfer: [...transfer] }) : structuredClone(event);
      setTimeout(() => box.workerLike?.onmessage?.({ data: cloned }), 0);
    },
    scheduler: new NoopScheduler(),
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
  return { workerLike };
}

/**
 * A `CanvasRenderingContext2D`-shaped double that does the least possible work: plain counters,
 * no growing log. Used only by the allocation test — `CanvasRecorder`'s own logging necessarily
 * allocates a log entry per call, which would swamp any signal about the renderer's own
 * behaviour (this is exactly what the first version of this test got wrong).
 */
class CountingContext {
  fillStyle = '#000000';
  fillRectCalls = 0;
  bufferAllocations = 0;

  fillRect(): void {
    this.fillRectCalls += 1;
  }

  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    this.bufferAllocations += 1;
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4) };
  }

  putImageData(): void {}
}

async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

const THEME: CompiledTheme = {
  id: 'canvas-bridge-test',
  background: '#000000',
  palette: () => '#ffffff',
};

/** The Gosper glider gun (LifeWiki's canonical RLE, decoded by hand): 36 live cells, x=0..35, y=0..8. */
const GOSPER_GUN: ReadonlyArray<readonly [number, number]> = [
  [24, 0],
  [22, 1],
  [24, 1],
  [12, 2],
  [13, 2],
  [20, 2],
  [21, 2],
  [34, 2],
  [35, 2],
  [11, 3],
  [15, 3],
  [20, 3],
  [21, 3],
  [34, 3],
  [35, 3],
  [0, 4],
  [1, 4],
  [10, 4],
  [16, 4],
  [20, 4],
  [21, 4],
  [0, 5],
  [1, 5],
  [10, 5],
  [14, 5],
  [16, 5],
  [17, 5],
  [22, 5],
  [24, 5],
  [10, 6],
  [16, 6],
  [24, 6],
  [11, 7],
  [15, 7],
  [12, 8],
  [13, 8],
];

describe('Canvas Bridge: worker -> client -> renderer, headless, 100 generations of a Gosper gun', () => {
  it('produces a stable, snapshot-tested draw-call log', { timeout: 30_000 }, async () => {
    const { workerLike } = createFakeWorker();
    const client = new WorkerClient({ spawn: () => workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });

    const recorder = new CanvasRecorder(512, 512);
    const canvas = {
      width: 0,
      height: 0,
      style: {} as { width?: string; height?: string },
      getContext: (kind: string) => (kind === '2d' ? recorder : null),
    } as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 4, widthPx: 512, heightPx: 512, dpr: 1 };
    renderer.resize(viewport.widthPx, viewport.heightPx, viewport.dpr);
    renderer.setTheme(THEME);
    renderer.setViewport(viewport);
    const mirror = new FrameGridMirror();
    client.onFrame((frame) => {
      mirror.applyChunks(frame.chunks);
      renderer.draw({ cells: mirror.view(), dirty: frame.dirty, tick: frame.tick });
    });

    await client.send({ cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 128, height: 128, seed: 1 });
    await client.send({
      cmd: 'paint',
      ops: GOSPER_GUN.map(([x, y]) => ({ x: x + 10, y: y + 10, state: 1 })),
    });
    await flush();

    for (let generation = 0; generation < 100; generation++) {
      await client.send({ cmd: 'step', n: 1 });
      await flush();
    }

    expect(recorder.calls).toMatchSnapshot();
  });

  it('zero allocations attributable to the render path across 100 frames', { timeout: 30_000 }, async () => {
    const { workerLike } = createFakeWorker();
    const client = new WorkerClient({ spawn: () => workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });

    // A minimal, non-logging context double — not the full CanvasRecorder. Recording "an
    // ordered log of calls and arguments" (the other two tests, and P0-H-3's own description of
    // the recorder) necessarily allocates a growing entry per call; that's the log doing its
    // job, not the render path. This test isolates the renderer's own contribution instead.
    const counting = new CountingContext();
    const canvas = {
      width: 0,
      height: 0,
      style: {} as { width?: string; height?: string },
      getContext: (kind: string) => (kind === '2d' ? counting : null),
    } as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 4, widthPx: 512, heightPx: 512, dpr: 1 };
    renderer.resize(viewport.widthPx, viewport.heightPx, viewport.dpr);
    renderer.setTheme(THEME);
    renderer.setViewport(viewport);
    const mirror = new FrameGridMirror();
    // Measures heap growth tightly around each renderer.draw() call itself, not the whole
    // onFrame handler — mirror.applyChunks() and (especially) the pipeline's own
    // structuredClone-based transport between calls allocate plenty on their own, and aren't
    // "the render path." Summing the delta *of the draw() call alone* across every frame is
    // what isolates the renderer's own contribution from that surrounding noise.
    let measuring = false;
    let drawHeapDelta = 0;
    client.onFrame((frame) => {
      mirror.applyChunks(frame.chunks);
      const renderFrame = { cells: mirror.view(), dirty: frame.dirty, tick: frame.tick };
      if (!measuring) {
        renderer.draw(renderFrame);
        return;
      }
      const before = process.memoryUsage().heapUsed;
      renderer.draw(renderFrame);
      drawHeapDelta += process.memoryUsage().heapUsed - before;
    });

    await client.send({ cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 128, height: 128, seed: 1 });
    await client.send({
      cmd: 'paint',
      ops: GOSPER_GUN.map(([x, y]) => ({ x: x + 10, y: y + 10, state: 1 })),
    });
    await flush();

    // Warm up before measuring: JIT, and — more importantly here — the gun keeps firing new
    // gliders for a while, so the renderer's reusable run pool and per-state bucket arrays
    // (canvas2d.ts) need enough generations to grow to this pattern's peak size. Grown once,
    // reused after; measuring too early would count that one-time growth as a leak.
    for (let i = 0; i < 60; i++) {
      await client.send({ cmd: 'step', n: 1 });
      await flush();
    }

    // Cell size 4 stays on the vector (fillRect) path — createImageData is only ever called
    // below cellSize 4 — so this is the sharpest available signal for "the render path itself
    // allocates a pixel buffer": it must never happen here, not even once.
    counting.bufferAllocations = 0;
    measuring = true;

    for (let generation = 0; generation < 100; generation++) {
      await client.send({ cmd: 'step', n: 1 });
      await flush();
    }

    expect(counting.fillRectCalls).toBeGreaterThan(0); // the scenario is genuinely exercising the render path
    expect(counting.bufferAllocations).toBe(0);
    // v8 coverage instrumentation adds its own per-call bookkeeping, which shows up as heap
    // growth unrelated to the render path itself — skip only this wall-clock-ish assertion
    // under coverage, same pattern as the engine's own throughput/allocation tests.
    if (!UNDER_COVERAGE) expect(drawHeapDelta).toBeLessThan(500_000); // < 5 KB/call average over 100 draw() calls
  });
});

describe('Canvas Bridge: dirty-rect behaviour is proven by the draw-call log', () => {
  it('a static field with one blinker produces draw calls covering only its chunk, not the whole viewport', async () => {
    const { workerLike } = createFakeWorker();
    const client = new WorkerClient({ spawn: () => workerLike, frameScheduler: IMMEDIATE_FRAME_SCHEDULER });

    const recorder = new CanvasRecorder(512, 512);
    const canvas = {
      width: 0,
      height: 0,
      style: {} as { width?: string; height?: string },
      getContext: (kind: string) => (kind === '2d' ? recorder : null),
    } as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    // A 128×128 world (4×4 = 16 chunks) shown in full: a full repaint would cover all of it.
    const viewport: Viewport = { originX: 0, originY: 0, cellSize: 4, widthPx: 512, heightPx: 512, dpr: 1 };
    renderer.resize(viewport.widthPx, viewport.heightPx, viewport.dpr);
    renderer.setTheme(THEME);
    renderer.setViewport(viewport);
    const mirror = new FrameGridMirror();
    client.onFrame((frame) => {
      mirror.applyChunks(frame.chunks);
      renderer.draw({ cells: mirror.view(), dirty: frame.dirty, tick: frame.tick });
    });

    await client.send({ cmd: 'init', ruleset: { ...CONWAY, boundary: 'toroidal' }, width: 128, height: 128, seed: 1 });
    // A blinker at (50,50)-(52,50), well inside chunk (1,1) (world 32..63) with margin on every side.
    await client.send({
      cmd: 'paint',
      ops: [
        { x: 50, y: 50, state: 1 },
        { x: 51, y: 50, state: 1 },
        { x: 52, y: 50, state: 1 },
      ],
    });
    await flush();

    recorder.resetLog();
    await client.send({ cmd: 'step', n: 1 });
    await flush();

    const fillRects = recorder.calls.filter((c) => c.method === 'fillRect');
    expect(fillRects.length).toBeGreaterThan(0);

    // Chunk (1,1) in world space is [32,64)×[32,64); at cellSize 4 that's pixel [128,256)×[128,256).
    for (const call of fillRects) {
      const [x, y, w, h] = call.args;
      expect(x).toBeGreaterThanOrEqual(128);
      expect(y).toBeGreaterThanOrEqual(128);
      expect(x + w).toBeLessThanOrEqual(256);
      expect(y + h).toBeLessThanOrEqual(256);
    }

    // The background fill (the first fillRect) is exactly one chunk, not the 512×512 viewport.
    const [, , bgW, bgH] = fillRects[0]!.args;
    expect(bgW).toBe(128); // 32 cells × cellSize 4
    expect(bgH).toBe(128);
  });
});
