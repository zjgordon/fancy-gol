import { describe, expect, it } from 'vitest';
import { Mulberry32 } from '@engine/rng';

describe('Mulberry32', () => {
  it('is deterministic: same seed produces an identical 10,000-value sequence', () => {
    const a = new Mulberry32(0x9e3779b9);
    const b = new Mulberry32(0x9e3779b9);
    for (let i = 0; i < 10_000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces values in [0, 1)', () => {
    const rng = new Mulberry32(1234);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds diverge', () => {
    const a = new Mulberry32(1);
    const b = new Mulberry32(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('fork() does not advance the parent stream', () => {
    const parent = new Mulberry32(42);
    const expected = new Mulberry32(42);

    parent.fork();
    for (let i = 0; i < 100; i++) {
      expect(parent.next()).toBe(expected.next());
    }
  });

  it('fork() produces a stream independent of, and different from, the parent', () => {
    const parent = new Mulberry32(42);
    const child = parent.fork();

    const parentSeq = Array.from({ length: 50 }, () => parent.next());
    const childSeq = Array.from({ length: 50 }, () => child.next());
    expect(childSeq).not.toEqual(parentSeq);

    // Deterministic: forking an identically-seeded, identically-advanced RNG again
    // reproduces the same child stream.
    const parentAgain = new Mulberry32(42);
    const childAgain = parentAgain.fork();
    expect(Array.from({ length: 50 }, () => childAgain.next())).toEqual(childSeq);
  });

  it('state getter round-trips through the constructor', () => {
    const rng = new Mulberry32(7);
    rng.next();
    rng.next();
    const restored = new Mulberry32(rng.state);
    for (let i = 0; i < 100; i++) {
      expect(restored.next()).toBe(rng.next());
    }
  });

  it('passes a chi-square uniformity test over 100k samples in 16 buckets (p > 0.01)', () => {
    const rng = new Mulberry32(0xc0ffee);
    const buckets = new Array<number>(16).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const bucket = rng.nextInt(16);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    const expected = n / 16;
    const chiSquare = buckets.reduce((sum, o) => sum + ((o ?? 0) - expected) ** 2 / expected, 0);
    // Critical value for df=15 at alpha=0.01 is ~30.578; staying under it means we fail to
    // reject uniformity at p > 0.01.
    expect(chiSquare).toBeLessThan(30.578);
  });

  it('reset() restores a snapshotted state and replays the same sequence', () => {
    const rng = new Mulberry32(99);
    rng.next();
    rng.next();
    const saved = rng.state;
    const a = rng.next();
    const b = rng.next();
    rng.reset(saved);
    expect(rng.next()).toBe(a);
    expect(rng.next()).toBe(b);
  });
});
