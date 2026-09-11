/**
 * Adapt a DOM `Worker` onto {@link WorkerLike} (P2-G-1). `WorkerClient` is typed against the
 * structural surface so tests can inject an in-memory double; a real `Worker`'s
 * `onmessage`/`onerror` setters are not assignable to that narrower shape.
 */
import type { WorkerLike } from '@worker/client';

export function toWorkerLike(worker: Worker): WorkerLike {
  const like: WorkerLike = {
    postMessage: (message, transfer) =>
      transfer ? worker.postMessage(message, [...transfer]) : worker.postMessage(message),
    onmessage: null,
    onerror: null,
    terminate: () => worker.terminate(),
  };
  worker.addEventListener('message', (event) => like.onmessage?.({ data: event.data }));
  worker.addEventListener('error', (event) => like.onerror?.(event));
  return like;
}
