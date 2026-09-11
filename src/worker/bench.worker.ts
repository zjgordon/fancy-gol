/**
 * Real worker entry for the ruleset bench (P2-E-3). `createBenchHandler`
 * is the logic; this file only binds it to a worker scope.
 */
import { createBenchHandler } from './bench-handler';

export interface DedicatedWorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export function bootstrap(scope: DedicatedWorkerScope) {
  const handler = createBenchHandler({
    post: (event) => scope.postMessage(event),
  });
  scope.onmessage = (event) => handler.handle(event.data);
  return handler;
}

/* v8 ignore next 3 -- only true inside a real worker; `bootstrap` above is what's under test. */
if (typeof self !== 'undefined' && typeof (self as unknown as { importScripts?: unknown }).importScripts === 'function') {
  bootstrap(self as unknown as DedicatedWorkerScope);
}
