import { describe, expect, it } from 'vitest';
import { toWorkerLike } from '@client/worker-adapter';

class FakeWorker {
  readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  lastMessage: unknown;
  terminated = false;

  postMessage(message: unknown): void {
    this.lastMessage = message;
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, fn: (event: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
}

describe('toWorkerLike', () => {
  it('forwards postMessage, terminate, and DOM events onto the structural surface', () => {
    const worker = new FakeWorker();
    const like = toWorkerLike(worker as unknown as Worker);
    const messages: unknown[] = [];
    const errors: unknown[] = [];
    like.onmessage = (e) => messages.push(e.data);
    like.onerror = (e) => errors.push(e);
    like.postMessage({ cmd: 'ping' });
    expect(worker.lastMessage).toEqual({ cmd: 'ping' });
    like.postMessage({ cmd: 'buf' }, [new ArrayBuffer(8)]);
    expect(worker.lastMessage).toEqual({ cmd: 'buf' });
    worker.listeners.get('message')?.[0]?.({ data: { type: 'ok' } });
    worker.listeners.get('error')?.[0]?.({ data: 'boom' });
    expect(messages).toEqual([{ type: 'ok' }]);
    expect(errors).toHaveLength(1);
    like.terminate();
    expect(worker.terminated).toBe(true);
  });
});
