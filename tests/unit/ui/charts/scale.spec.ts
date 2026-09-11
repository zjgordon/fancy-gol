import { describe, expect, it } from 'vitest';
import {
  linearScale,
  logScale,
  logTicks,
  niceDomain,
  niceStep,
  niceTicks,
  timeScale,
} from '@ui/charts/scale';

function mantissa(step: number): number {
  const exp = Math.floor(Math.log10(step));
  const m = step / 10 ** exp;
  return Number(m.toPrecision(8));
}

describe('niceStep', () => {
  it('picks a 1, 2, or 5 times a power of ten', () => {
    for (const [span, count] of [
      [100, 5],
      [10, 5],
      [7, 4],
      [1000, 8],
      [0.3, 5],
    ] as const) {
      const step = niceStep(span, count);
      expect([1, 2, 5]).toContain(mantissa(step));
    }
  });

  it('is 1 for a zero or non-finite span rather than NaN', () => {
    expect(niceStep(0, 5)).toBe(1);
    expect(niceStep(Number.NaN, 5)).toBe(1);
  });
});

describe('niceTicks', () => {
  it('covers 0–100 in twenties', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('expands a degenerate domain so a flat series still has a scale', () => {
    const [lo, hi] = niceDomain(4, 4);
    expect(hi).toBeGreaterThan(lo);
    expect(niceTicks(4, 4).length).toBeGreaterThan(1);
  });
});

describe('linearScale', () => {
  it('maps domain to range and inverts', () => {
    const s = linearScale([0, 100], [0, 200]);
    expect(s.convert(50)).toBe(100);
    expect(s.invert(100)).toBe(50);
    expect(s.kind).toBe('linear');
  });

  it('survives a collapsed domain without NaN', () => {
    const s = linearScale([3, 3], [10, 20]);
    expect(Number.isFinite(s.convert(3))).toBe(true);
    expect(Number.isFinite(s.invert(15))).toBe(true);
  });
});

describe('logScale', () => {
  it('maps decades onto the range', () => {
    const s = logScale([1, 1000], [0, 300]);
    expect(s.convert(1)).toBeCloseTo(0);
    expect(s.convert(10)).toBeCloseTo(100);
    expect(s.convert(1000)).toBeCloseTo(300);
    expect(s.invert(100)).toBeCloseTo(10);
  });

  it('handles zero and negatives without producing NaN geometry', () => {
    const s = logScale([0, 100], [0, 100]);
    for (const v of [Number.NEGATIVE_INFINITY, -50, -0.01, 0, Number.NaN]) {
      const y = s.convert(v);
      expect(Number.isFinite(y), `convert(${v}) → ${y}`).toBe(true);
    }
    expect(Number.isFinite(s.invert(0))).toBe(true);
    expect(Number.isFinite(s.invert(50))).toBe(true);
  });

  it('falls back to linear when the whole domain is non-positive', () => {
    const s = logScale([-8, -2], [0, 100]);
    expect(Number.isFinite(s.convert(-5))).toBe(true);
    expect(s.convert(-8)).toBeCloseTo(0);
    expect(s.convert(-2)).toBeCloseTo(100);
  });

  it('emits decade ticks, with 2/5 subdivisions on a short span', () => {
    const ticks = logTicks(1, 100);
    expect(ticks).toContain(1);
    expect(ticks).toContain(10);
    expect(ticks).toContain(100);
    expect(ticks).toContain(2);
    expect(ticks).toContain(5);
  });
});

describe('timeScale', () => {
  it('is a linear scale whose ticks prefer integers (generation numbers)', () => {
    const s = timeScale([0, 10], [0, 100]);
    expect(s.kind).toBe('time');
    expect(s.convert(5)).toBe(50);
    for (const t of s.ticks(5)) {
      expect(Number.isInteger(t)).toBe(true);
    }
  });
});
