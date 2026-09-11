import { describe, expect, it } from 'vitest';
import {
  BENCH_CASES,
  BENCH_CASE_IDS,
  referenceFromReport,
  thumbnailDigest,
  type BenchCaseResult,
  type BenchReport,
} from '@shared/bench';

describe('bench contract', () => {
  it('names eight fixed seeds including five soups, a cell, a block, and an 8×8', () => {
    expect(BENCH_CASES.map((c) => c.id)).toEqual([...BENCH_CASE_IDS]);
    expect(BENCH_CASES.filter((c) => c.kind === 'soup')).toHaveLength(5);
    expect(BENCH_CASES.some((c) => c.kind === 'single')).toBe(true);
    expect(BENCH_CASES.some((c) => c.kind === 'block')).toBe(true);
    expect(BENCH_CASES.some((c) => c.kind === 'soup8')).toBe(true);
  });

  it('digests occupancy bytes stably and drops pixels from a reference slice', () => {
    const pixels = new Uint8Array([1, 0, 1, 0]);
    expect(thumbnailDigest(pixels)).toBe(thumbnailDigest(pixels));
    expect(thumbnailDigest(pixels)).not.toBe(thumbnailDigest(new Uint8Array([0, 0, 1, 0])));
    const result: BenchCaseResult = {
      id: 'block',
      label: 'Block',
      stabilizationGeneration: 0,
      finalPopulation: 4,
      growthKind: 'constant',
      growthLabel: 'Constant population',
      period: 1,
      cycleKind: 'oscillator',
      thumbnail: pixels,
      thumbnailDigest: thumbnailDigest(pixels),
    };
    const report: BenchReport = { cases: [result] };
    expect(referenceFromReport(report)).toEqual([
      {
        id: 'block',
        stabilizationGeneration: 0,
        finalPopulation: 4,
        growthKind: 'constant',
        period: 1,
        thumbnailDigest: thumbnailDigest(pixels),
      },
    ]);
  });
});
