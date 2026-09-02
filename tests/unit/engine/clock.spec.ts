import { describe, expect, it } from 'vitest';
import { TestClock } from '@engine/clock';

describe('TestClock', () => {
  it('starts at zero', () => {
    expect(new TestClock().now()).toBe(0);
  });

  it('advances deterministically so stepMicros-style measurements are assertable', () => {
    const clock = new TestClock();
    const start = clock.now();
    clock.advance(1234);
    const elapsed = clock.now() - start;
    expect(elapsed).toBe(1234);
  });

  it('set() jumps to an absolute time', () => {
    const clock = new TestClock();
    clock.set(999);
    expect(clock.now()).toBe(999);
  });
});
