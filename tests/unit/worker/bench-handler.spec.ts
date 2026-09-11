import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import type { BenchEvent } from '@shared/bench';
import { createBenchHandler } from '@worker/bench-handler';
import { bootstrap } from '@worker/bench.worker';

describe('createBenchHandler', () => {
  it('posts a case per seed and a done report for Conway', () => {
    const posted: BenchEvent[] = [];
    const handler = createBenchHandler({ post: (e) => posted.push(e) });
    handler.handle({ cmd: 'run', ruleset: CONWAY });
    const cases = posted.filter((e) => e.type === 'case');
    const done = posted.find((e) => e.type === 'done');
    expect(cases).toHaveLength(8);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') expect(done.report.cases).toHaveLength(8);
  });

  it('stops after cancel and never posts done', () => {
    const posted: BenchEvent[] = [];
    const handler = createBenchHandler({
      post: (e) => {
        posted.push(e);
        if (e.type === 'case') handler.cancel();
      },
    });
    handler.handle({ cmd: 'run', ruleset: CONWAY });
    expect(posted.some((e) => e.type === 'done')).toBe(false);
    expect(posted.some((e) => e.type === 'cancelled')).toBe(true);
    expect(posted.filter((e) => e.type === 'case').length).toBeLessThan(8);
  });

  it('rejects a malformed command and an invalid ruleset', () => {
    const posted: BenchEvent[] = [];
    const handler = createBenchHandler({ post: (e) => posted.push(e) });
    handler.handle('nope');
    handler.handle({ cmd: 'run', ruleset: { version: 1 } });
    handler.handle({ cmd: 'cancel' });
    expect(posted.filter((e) => e.type === 'error')).toHaveLength(2);
  });
});

describe('bench.worker bootstrap', () => {
  it('wires run through the scope without a real Worker', () => {
    const posted: unknown[] = [];
    const scope = {
      postMessage: (message: unknown) => posted.push(message),
      onmessage: null as ((event: { data: unknown }) => void) | null,
    };
    bootstrap(scope);
    expect(scope.onmessage).toBeTypeOf('function');
    scope.onmessage?.({ data: { cmd: 'run', ruleset: CONWAY } });
    expect(posted.some((e) => (e as BenchEvent).type === 'done')).toBe(true);
  });
});
