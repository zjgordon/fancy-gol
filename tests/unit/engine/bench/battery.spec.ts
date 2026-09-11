import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BENCH_CASES, BenchCancelledError, referenceFromReport, runBattery, runBenchCase } from '@engine/bench/battery';
import { CONWAY } from '@engine/rules/builtin';
import type { BenchReferenceCase } from '@shared/bench';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../../tests/fixtures/rules/bench/conway-report.json');

function loadReference(): BenchReferenceCase[] {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: BenchReferenceCase[] };
  return raw.cases;
}

describe('runBattery', () => {
  it('scores Conway against the committed reference report', () => {
    const report = runBattery(CONWAY);
    expect(referenceFromReport(report)).toEqual(loadReference());
    expect(report.cases).toHaveLength(BENCH_CASES.length);
  });

  it('treats a Conway block as a still life and a lone cell as extinct', () => {
    const block = runBenchCase(CONWAY, BENCH_CASES.find((c) => c.id === 'block')!);
    expect(block.finalPopulation).toBe(4);
    expect(block.period).toBe(1);
    expect(block.growthKind).toBe('constant');
    expect(block.stabilizationGeneration).toBe(0);

    const single = runBenchCase(CONWAY, BENCH_CASES.find((c) => c.id === 'single')!);
    expect(single.finalPopulation).toBe(0);
    expect(single.period).toBeNull();
    expect(single.stabilizationGeneration).toBe(1);
    expect(single.growthKind).toBe('constant');
    expect(single.growthLabel).toMatch(/Constant/i);
  });

  it('abstains on growth when the cap is below 64 samples', () => {
    const result = runBenchCase(CONWAY, BENCH_CASES.find((c) => c.id === 'block')!, { maxGens: 8 });
    expect(result.growthKind).toBe('insufficient-data');
    expect(result.growthLabel).toMatch(/Insufficient data/i);
  });

  it('throws when cancelled between cases', () => {
    let finished = 0;
    expect(() =>
      runBattery(CONWAY, {
        onCase: () => {
          finished += 1;
        },
        shouldCancel: () => finished >= 1,
      }),
    ).toThrow(BenchCancelledError);
    expect(finished).toBe(1);
  });

  it('covers an empty 8×8, a symmetric rule, and a palette with no live state', () => {
    const empty8 = runBenchCase(CONWAY, { id: 'soup-8x8', label: 'Empty 8×8', kind: 'soup8', seed: 1, density: 0 });
    expect(empty8.finalPopulation).toBe(0);
    expect(empty8.stabilizationGeneration).toBe(0);

    const mirrored = runBenchCase({ ...CONWAY, symmetry: 'rotational' }, BENCH_CASES.find((c) => c.id === 'block')!);
    expect(mirrored.finalPopulation).toBe(4);

    const inert = {
      ...CONWAY,
      states: CONWAY.states.map((s) => ({ ...s, countsAsAlive: false })),
    };
    expect(() => runBenchCase(inert, BENCH_CASES.find((c) => c.id === 'single')!)).toThrow(/no live state/);
  });

  it('cancels mid-case when the callback flips during stepping', () => {
    let steps = 0;
    expect(() =>
      runBenchCase(CONWAY, BENCH_CASES.find((c) => c.id === 'soup-50')!, {
        shouldCancel: () => {
          steps += 1;
          return steps > 3;
        },
      }),
    ).toThrow(BenchCancelledError);
  });

  it('finishes a typical rule in under 3 s', () => {
    const t0 = performance.now();
    runBattery(CONWAY);
    const elapsed = performance.now() - t0;
    if (!UNDER_COVERAGE) expect(elapsed).toBeLessThan(3000);
  });
});
