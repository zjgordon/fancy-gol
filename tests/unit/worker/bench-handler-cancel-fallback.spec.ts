import { describe, expect, it, vi } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import type { BenchEvent } from '@shared/bench';

/**
 * `bench-handler.ts`'s catch block reports `cancelled` (not the raw error) whenever
 * `err instanceof BenchCancelledError || cancelled` — real `runBattery` never throws
 * anything else while `cancelled` is true (its own `shouldCancel` check always throws
 * `BenchCancelledError` first), so the `|| cancelled` half is defensive: a future
 * battery implementation, or one under test, could throw something else after a cancel
 * request lands. Mock `runBattery` to do exactly that and prove the fallback holds.
 */
vi.mock('@engine/bench/battery', () => ({
  BenchCancelledError: class MockBenchCancelledError extends Error {},
  runBattery: (_ruleset: unknown, opts: { onCase?: (r: unknown) => void }) => {
    opts.onCase?.({ id: 'soup-10' });
    throw new Error('battery exploded mid-run, unrelated to cancellation');
  },
}));

const { createBenchHandler } = await import('@worker/bench-handler');

describe('createBenchHandler cancelled-fallback branch', () => {
  it('reports cancelled, not the raw error, when a non-cancellation error follows a cancel request', () => {
    const posted: BenchEvent[] = [];
    const handler = createBenchHandler({
      post: (e) => {
        posted.push(e);
        if (e.type === 'case') handler.cancel();
      },
    });
    handler.handle({ cmd: 'run', ruleset: CONWAY });
    expect(posted.some((e) => e.type === 'cancelled')).toBe(true);
    expect(posted.some((e) => e.type === 'error')).toBe(false);
  });
});
