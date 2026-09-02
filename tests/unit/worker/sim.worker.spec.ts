import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import type { Event } from '@shared/protocol';
import { bootstrap, detectCapabilities, type DedicatedWorkerScope } from '@worker/sim.worker';

describe('detectCapabilities', () => {
  it('reflects this (Node) environment: SharedArrayBuffer yes, OffscreenCanvas no', () => {
    // Documents what P0-G-2's handler.ts deliberately doesn't do itself (ADR: environment
    // detection is sim.worker.ts's job). Node has SharedArrayBuffer globally; it has no
    // OffscreenCanvas — a real browser worker would differ, which is exactly the point of
    // keeping this detection isolated to one small, environment-specific function.
    expect(detectCapabilities()).toEqual({ sharedArrayBuffer: true, offscreenCanvas: false });
  });
});

function createFakeScope(): { scope: DedicatedWorkerScope; posted: unknown[] } {
  const posted: unknown[] = [];
  const scope: DedicatedWorkerScope = {
    postMessage: (message) => posted.push(message),
    onmessage: null,
  };
  return { scope, posted };
}

describe('bootstrap', () => {
  it('wires an incoming message to the handler and posts its reply back through the scope', () => {
    const { scope, posted } = createFakeScope();
    bootstrap(scope, { sharedArrayBuffer: false, offscreenCanvas: true });

    expect(scope.onmessage).toBeTypeOf('function');
    scope.onmessage?.({ data: { id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 } });

    expect(posted).toEqual([{ id: 1, type: 'ready', capabilities: { sharedArrayBuffer: false, offscreenCanvas: true } }]);
  });

  it('never crashes the scope on a malformed message', () => {
    const { scope, posted } = createFakeScope();
    bootstrap(scope, { sharedArrayBuffer: false, offscreenCanvas: false });

    expect(() => scope.onmessage?.({ data: 'not a command' })).not.toThrow();
    const [event] = posted as Event[];
    expect(event?.type).toBe('error');
  });

  it('defaults capabilities to detectCapabilities() when none are passed', () => {
    const { scope, posted } = createFakeScope();
    bootstrap(scope);
    scope.onmessage?.({ data: { id: 1, cmd: 'init', ruleset: CONWAY, width: 16, height: 16, seed: 1 } });
    expect(posted).toEqual([{ id: 1, type: 'ready', capabilities: detectCapabilities() }]);
  });
});
