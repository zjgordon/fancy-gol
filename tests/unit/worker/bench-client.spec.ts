import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import type { BenchEvent } from '@shared/bench';
import { createBenchClient } from '@worker/bench-client';
import { createBenchHandler } from '@worker/bench-handler';
import type { WorkerLike } from '@worker/client';

function memoryWorker(): WorkerLike {
  const worker: WorkerLike = {
    postMessage(message) {
      handler.handle(message);
    },
    onmessage: null,
    onerror: null,
    terminate() {
      handler.cancel();
    },
  };
  const handler = createBenchHandler({
    post: (event) => worker.onmessage?.({ data: event }),
  });
  return worker;
}

describe('createBenchClient', () => {
  it('resolves a full report and streams cases', async () => {
    const seen: string[] = [];
    const client = createBenchClient(memoryWorker);
    const report = await client.run(CONWAY, { onCase: (c) => seen.push(c.id) });
    expect(report.cases).toHaveLength(8);
    expect(seen).toHaveLength(8);
  });

  it('rejects when the signal is already aborted', async () => {
    const client = createBenchClient(memoryWorker);
    const signal = AbortSignal.abort();
    await expect(client.run(CONWAY, { signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels a run from onCase via the abort signal', async () => {
    const ac = new AbortController();
    const client = createBenchClient(memoryWorker);
    await expect(
      client.run(CONWAY, {
        signal: ac.signal,
        onCase: () => ac.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a worker error event', async () => {
    const client = createBenchClient(() => {
      const worker: WorkerLike = {
        postMessage() {
          worker.onerror?.(new Error('boom'));
        },
        onmessage: null,
        onerror: null,
        terminate() {},
      };
      return worker;
    });
    await expect(client.run(CONWAY)).rejects.toThrow(/failed/);
  });

  it('ignores a malformed event and still resolves on done', async () => {
    const client = createBenchClient(() => {
      const worker: WorkerLike = {
        postMessage() {
          worker.onmessage?.({ data: 'nope' });
          worker.onmessage?.({
            data: { type: 'done', report: { cases: [] } } satisfies BenchEvent,
          });
        },
        onmessage: null,
        onerror: null,
        terminate() {},
      };
      return worker;
    });
    await expect(client.run(CONWAY)).resolves.toEqual({ cases: [] });
  });

  it('treats a cancelled event as AbortError', async () => {
    const client = createBenchClient(() => {
      const worker: WorkerLike = {
        postMessage() {
          worker.onmessage?.({ data: { type: 'cancelled' } satisfies BenchEvent });
        },
        onmessage: null,
        onerror: null,
        terminate() {},
      };
      return worker;
    });
    await expect(client.run(CONWAY)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('surfaces a structured error from the isolate', async () => {
    const client = createBenchClient(() => {
      const worker: WorkerLike = {
        postMessage() {
          const event: BenchEvent = { type: 'error', message: 'bad rule' };
          worker.onmessage?.({ data: event });
        },
        onmessage: null,
        onerror: null,
        terminate() {},
      };
      return worker;
    });
    await expect(client.run({})).rejects.toThrow('bad rule');
  });
});
