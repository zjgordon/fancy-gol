import { describe, expect, it, vi } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import type { BenchEvent } from '@shared/bench';

/**
 * Real `runBattery` only ever throws `Error` instances (including `BenchCancelledError`). The
 * second catch's `String(err)` fallback for a non-Error throw has no reachable real trigger.
 * Mock the battery to throw a bare string and prove the handler stringifies it rather than
 * crashing on `.message` of a non-Error.
 */
vi.mock('@engine/bench/battery', () => ({
  BenchCancelledError: class MockBenchCancelledError extends Error {},
  runBattery: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error, to prove the handler's String(err) fallback
    throw 'raw string failure, unrelated to cancellation';
  },
}));

const { createBenchHandler } = await import('@worker/bench-handler');

describe('createBenchHandler battery non-Error branch', () => {
  it('stringifies a non-Error thrown by the battery when cancellation was never requested', () => {
    const posted: BenchEvent[] = [];
    const handler = createBenchHandler({ post: (e) => posted.push(e) });
    handler.handle({ cmd: 'run', ruleset: CONWAY });
    expect(posted).toEqual([{ type: 'error', message: 'raw string failure, unrelated to cancellation' }]);
  });
});
