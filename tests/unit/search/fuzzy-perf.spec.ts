/**
 * P4-A-1 scoring budget, measured on the node project (jsdom's own overhead
 * made a 1 ms gate flake). Ranking correctness lives in tests/unit/ui/search.
 */
import { describe, expect, it } from 'vitest';
import { scoreFuzzy } from '@ui/search/fuzzy';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

describe('scoreFuzzy performance', () => {
  it('scores 1,000 candidates in under 1 ms', () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      i % 7 === 0 ? `Toggle Grid Lines ${i}` : `Command Palette Item ${i}`,
    );
    const samples: number[] = [];
    for (let n = 0; n < 7; n++) {
      const t0 = performance.now();
      let hits = 0;
      for (const s of items) {
        if (scoreFuzzy('tgl', s)) hits += 1;
      }
      samples.push(performance.now() - t0);
      expect(hits).toBeGreaterThan(0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[3]!;
    if (!UNDER_COVERAGE) expect(median).toBeLessThan(1);
  });
});
