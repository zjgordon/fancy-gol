import { describe, expect, it, vi } from 'vitest';
import type { BenchEvent } from '@shared/bench';

/**
 * The first catch's message ternary has a middle branch — a real `Error` that is *not* a
 * `RuleValidationError` — with no reachable real-world trigger (`validateRuleSet` only ever
 * throws its own typed error). Mock it to throw a generic `Error` and prove the handler still
 * reports `err.message` rather than crashing or mis-stringifying it.
 */
vi.mock('@engine/rules/validate', () => ({
  validateRuleSet: () => {
    throw new Error('unexpected validator crash');
  },
}));

const { createBenchHandler } = await import('@worker/bench-handler');

describe('createBenchHandler validation generic-Error branch', () => {
  it('reports a generic Error thrown during validation by its own message', () => {
    const posted: BenchEvent[] = [];
    const handler = createBenchHandler({ post: (e) => posted.push(e) });
    handler.handle({ cmd: 'run', ruleset: {} });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ type: 'error', message: 'unexpected validator crash' });
  });
});
