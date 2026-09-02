import { describe, expect, it } from 'vitest';

// Pins the 'node' test environment for the default project (P0-A-3): the engine
// must never need a DOM, so a stray `document` reference should fail loudly.
describe('default test environment', () => {
  it('runs in node, with no DOM globals present', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });
});
