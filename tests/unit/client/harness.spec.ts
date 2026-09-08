import { describe, expect, it } from 'vitest';
import { isTestMode } from '../../../src/client/harness';

describe('isTestMode', () => {
  it('is true only for the exact ?test=1 flag Playwright uses', () => {
    expect(isTestMode('?test=1')).toBe(true);
    expect(isTestMode('?test=1&live=1')).toBe(true);
    expect(isTestMode('?foo=1')).toBe(false);
    expect(isTestMode('?test=true')).toBe(false);
    expect(isTestMode('')).toBe(false);
  });
});
