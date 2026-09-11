/**
 * Dedicated ruleset-bench worker (P2-E-3). Transport-agnostic like
 * `handler.ts`: takes a `post` function, never a `self`. The live sim
 * worker is left alone — Cancel can `terminate()` this isolate without
 * touching the user's world.
 */
import { BenchCancelledError, runBattery } from '@engine/bench/battery';
import { RuleValidationError } from '@engine/rules/errors';
import { validateRuleSet } from '@engine/rules/validate';
import type { BenchCommand, BenchEvent } from '@shared/bench';

export type PostBenchFn = (event: BenchEvent) => void;

export interface BenchHandler {
  handle(raw: unknown): void;
  cancel(): void;
}

function parseCommand(raw: unknown): BenchCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const cmd = (raw as { cmd?: unknown }).cmd;
  if (cmd === 'cancel') return { cmd: 'cancel' };
  if (cmd === 'run') return { cmd: 'run', ruleset: (raw as { ruleset?: unknown }).ruleset };
  return null;
}

export function createBenchHandler(opts: { readonly post: PostBenchFn }): BenchHandler {
  let cancelled = false;

  function cancel(): void {
    cancelled = true;
  }

  function handle(raw: unknown): void {
    const parsed = parseCommand(raw);
    if (!parsed) {
      opts.post({ type: 'error', message: 'malformed bench command' });
      return;
    }
    if (parsed.cmd === 'cancel') {
      cancel();
      return;
    }
    cancelled = false;
    let ruleset;
    try {
      ruleset = validateRuleSet(parsed.ruleset);
    } catch (err) {
      const message =
        err instanceof RuleValidationError
          ? err.issues.map((i) => i.message).join('; ')
          : err instanceof Error
            ? err.message
            : String(err);
      opts.post({ type: 'error', message });
      return;
    }
    try {
      const report = runBattery(ruleset, {
        shouldCancel: () => cancelled,
        onCase: (result) => opts.post({ type: 'case', result }),
      });
      if (cancelled) {
        opts.post({ type: 'cancelled' });
        return;
      }
      opts.post({ type: 'done', report });
    } catch (err) {
      if (err instanceof BenchCancelledError || cancelled) {
        opts.post({ type: 'cancelled' });
        return;
      }
      opts.post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { handle, cancel };
}
