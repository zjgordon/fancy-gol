/**
 * Main-thread half of the dedicated bench worker (P2-E-3). One isolate per
 * run so Cancel is `terminate()` and the live grid never hears about it.
 */
import type { BenchCaseResult, BenchEvent, BenchReport } from '@shared/bench';
import type { WorkerLike } from './client';

export interface BenchRunOptions {
  readonly signal?: AbortSignal;
  readonly onCase?: (result: BenchCaseResult) => void;
}

export interface BenchClient {
  run(ruleset: unknown, opts?: BenchRunOptions): Promise<BenchReport>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(): Error {
  const err = new Error('bench cancelled');
  err.name = 'AbortError';
  return err;
}

function asEvent(raw: unknown): BenchEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const type = (raw as { type?: unknown }).type;
  if (type === 'case' || type === 'done' || type === 'cancelled' || type === 'error') {
    return raw as BenchEvent;
  }
  return null;
}

export function createBenchClient(spawn: () => WorkerLike): BenchClient {
  return {
    run(ruleset, opts = {}) {
      if (opts.signal?.aborted) return Promise.reject(abortError());

      const worker = spawn();
      return new Promise<BenchReport>((resolve, reject) => {
        let settled = false;

        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          opts.signal?.removeEventListener('abort', onAbort);
          worker.terminate();
          fn();
        };

        const onAbort = (): void => {
          try {
            worker.postMessage({ cmd: 'cancel' });
          } catch {
            // isolate may already be gone
          }
          worker.terminate();
          finish(() => reject(abortError()));
        };

        worker.onmessage = (event) => {
          const msg = asEvent(event.data);
          if (!msg) return;
          if (msg.type === 'case') {
            opts.onCase?.(msg.result);
            return;
          }
          if (msg.type === 'done') {
            finish(() => resolve(msg.report));
            return;
          }
          if (msg.type === 'cancelled') {
            finish(() => reject(abortError()));
            return;
          }
          finish(() => reject(new Error(msg.message)));
        };
        worker.onerror = () => finish(() => reject(new Error('bench worker failed')));

        opts.signal?.addEventListener('abort', onAbort);
        try {
          worker.postMessage({ cmd: 'run', ruleset });
        } catch (error) {
          finish(() => reject(isAbortError(error) ? abortError() : error instanceof Error ? error : new Error(String(error))));
        }
      });
    },
  };
}
