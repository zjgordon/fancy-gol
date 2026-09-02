/**
 * P0-G-3 — the real worker entry point. Everything that actually *does* something lives in
 * `handler.ts` (transport-agnostic) and `REAL_SCHEDULER`/capability detection (this file's own,
 * environment-specific job per P0-G-2's design). `bootstrap()` takes an explicit scope instead
 * of reaching for the global `self`, so it — and therefore this whole file's wiring — is
 * testable without an actual `Worker`; only the two lines at the bottom that call it with the
 * real global scope need a browser worker context to run.
 */
import { createHandler, REAL_SCHEDULER } from './handler';
import type { Clock } from '@engine/clock';
import type { WorkerCaps } from '@shared/protocol';

/** The slice of `DedicatedWorkerGlobalScope` this file needs. A real worker's `self` satisfies this structurally. */
export interface DedicatedWorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** Real, environment-specific capability detection — the one thing `handler.ts` deliberately doesn't do itself. */
export function detectCapabilities(): WorkerCaps {
  return {
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  };
}

/**
 * The real `performance.now()`-backed clock `engine/clock.ts`'s own doc promises lives outside
 * `src/engine/**` — found missing (every `TickStats.stepMicros` silently read `0`, `handler.ts`'s
 * documented default when no clock is injected) while driving P0-I-1's client shell in a real
 * browser; nothing in Phase 0's tests exercises `HandlerOptions.clock` end-to-end, so the gap had
 * gone unnoticed. `performance.now()` is milliseconds (sub-ms fractional); `Clock.now()` is
 * documented as microseconds, hence the `* 1000`.
 */
export const REAL_CLOCK: Clock = {
  now: () => performance.now() * 1000,
};

/** Wires a worker scope to a fresh handler. Exported so it can be exercised with a fake scope, no `Worker` required. */
export function bootstrap(scope: DedicatedWorkerScope, capabilities: WorkerCaps = detectCapabilities()) {
  const handler = createHandler({
    post: (event, transfer) => scope.postMessage(event, transfer ? [...transfer] : undefined),
    scheduler: REAL_SCHEDULER,
    capabilities,
    clock: REAL_CLOCK,
  });
  scope.onmessage = (event) => handler.handle(event.data);
  return handler;
}

/* v8 ignore next 3 -- only true inside a real worker; `bootstrap` above is what's under test. */
if (typeof self !== 'undefined' && typeof (self as unknown as { importScripts?: unknown }).importScripts === 'function') {
  bootstrap(self as unknown as DedicatedWorkerScope);
}
