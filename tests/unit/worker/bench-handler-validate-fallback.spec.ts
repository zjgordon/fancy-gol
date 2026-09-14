import { describe, expect, it, vi } from 'vitest';
import type { BenchEvent } from '@shared/bench';

/**
 * `validateRuleSet` only ever throws its own `RuleValidationError` — there is no real input that
 * makes it throw anything else. The handler's message-building ternary still has a fallback for
 * "some other error type" (an unexpected runtime failure inside validation), which is defensive
 * code with no reachable real-world trigger. Mock validation to throw a non-Error value and prove
 * the fallback stringifies it instead of crashing.
 */
vi.mock('@engine/rules/validate', () => ({
  validateRuleSet: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error, to prove the handler's String(err) fallback
    throw 'not even an Error instance';
  },
}));

const { createBenchHandler } = await import('@worker/bench-handler');

describe('createBenchHandler validation-fallback branch', () => {
  it('stringifies a non-Error, non-RuleValidationError thrown during validation', () => {
    const posted: BenchEvent[] = [];
    const handler = createBenchHandler({ post: (e) => posted.push(e) });
    handler.handle({ cmd: 'run', ruleset: {} });
    expect(posted).toEqual([{ type: 'error', message: 'not even an Error instance' }]);
  });
});
