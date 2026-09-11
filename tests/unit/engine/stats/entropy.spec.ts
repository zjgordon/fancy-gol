import { describe, expect, it } from 'vitest';
import { packChunk } from '@engine/grid/coords';
import {
  BRIANS_BRAIN,
  CONWAY,
  DAY_AND_NIGHT,
  HIGHLIFE,
  STAR_WARS,
} from '@engine/rules/builtin';
import { Mulberry32 } from '@engine/rng';
import { Simulation } from '@engine/simulation';
import { StatsCollector } from '@engine/stats/collector';
import {
  describeEntropy,
  EntropyScanner,
  MAX_ENTROPY,
  shannon,
} from '@engine/stats/entropy';
import type { RuleSet } from '@engine/types';

function seedBinary(sim: Simulation, rng: Mulberry32, w: number, h: number, p: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rng.next() < p) sim.set(x, y, 1);
    }
  }
}

/** 16×16-tile checkerboard agar: alternating full and empty occupancy blocks. */
function stampBlockCheckerboard(sim: Simulation, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tile = ((x >> 4) + (y >> 4)) & 1;
      if (tile === 0) sim.set(x, y, 1);
    }
  }
}

function stampStillLifes(sim: Simulation): void {
  sim.set(8, 8, 1);
  sim.set(9, 8, 1);
  sim.set(8, 9, 1);
  sim.set(9, 9, 1);
}

describe('shannon', () => {
  it('is 0 for a single occupied bin and for an empty histogram', () => {
    expect(shannon(new Uint32Array([4]), 4)).toBe(0);
    expect(shannon(new Uint32Array(257), 0)).toBe(0);
  });

  it('is 1 bit for a fair two-bin histogram', () => {
    expect(shannon(new Uint32Array([8, 8]), 16)).toBeCloseTo(1, 12);
  });
});

describe('describeEntropy', () => {
  it('labels exact readings as exact and sampled readings with the rate', () => {
    const exact = {
      entropy: 4.5,
      maxEntropy: MAX_ENTROPY,
      exact: true,
      blockStride: 1,
      sampleFraction: 1,
      period: 8,
      tick: 8,
      blocksSampled: 64,
      blocksTotal: 64,
    };
    const sampled = { ...exact, exact: false, blockStride: 2, sampleFraction: 0.5, blocksSampled: 32 };
    expect(describeEntropy(exact)).toBe('4.50 bits (exact)');
    expect(describeEntropy(sampled)).toContain('sampled');
    expect(describeEntropy(sampled)).toContain('every 8 ticks');
    expect(describeEntropy(sampled)).toContain('32/64 of 16×16 blocks');
    expect(describeEntropy(sampled)).not.toMatch(/\(exact\)/);
  });
});

describe('EntropyScanner ranges (P2-C-2)', () => {
  /**
   * Documented expected ranges, in bits, on a 128×128 bounded field
   * (64 blocks of 16×16; H_max = log2(257) ≈ 8.01):
   *
   * - uniform random ~50% soup: occupancy is Binomial(256, 0.5), spread
   *   across ~20 bins → **4.2–6.0 bits**, the top of what this measure
   *   attains on a CA field ("≈ maximum").
   * - still-life blocks on empty: almost every block occupancy 0 → **< 0.5**.
   * - 16×16-tile checkerboard agar: two occupancy classes (0 and 256) →
   *   **≈ 1 bit**, strictly between the two.
   *
   * A cell-level checkerboard is *not* the fixture: every 16×16 block then
   * has occupancy 128, so the histogram collapses to one bin (same as a
   * still life). Occupancy entropy sees spatial structure at the 16×16
   * scale it is defined on.
   */
  it('random ≈ maximum, still life ≈ near-zero, checkerboard agar between', () => {
    const W = 128;
    const H = 128;
    const scanner = new EntropyScanner();

    const random = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: W,
      height: H,
      seed: 1,
    });
    seedBinary(random, new Mulberry32(1), W, H, 0.5);
    const hRandom = scanner.measure(random.view()).entropy;

    const still = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: W,
      height: H,
      seed: 1,
    });
    stampStillLifes(still);
    const hStill = scanner.measure(still.view()).entropy;

    const agar = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: W,
      height: H,
      seed: 1,
    });
    stampBlockCheckerboard(agar, W, H);
    const hAgar = scanner.measure(agar.view()).entropy;

    expect(hRandom).toBeGreaterThanOrEqual(4.2);
    expect(hRandom).toBeLessThanOrEqual(6.0);
    expect(hStill).toBeGreaterThanOrEqual(0);
    expect(hStill).toBeLessThan(0.5);
    expect(hAgar).toBeCloseTo(1, 8);
    expect(hAgar).toBeGreaterThan(hStill);
    expect(hAgar).toBeLessThan(hRandom);
  });
});

describe('sampled vs exact (P2-C-2)', () => {
  it('sampled entropy tracks the exact value within 5% on 20 chaotic fixtures', () => {
    const W = 256;
    const H = 256;
    const rules: RuleSet[] = [HIGHLIFE, BRIANS_BRAIN, STAR_WARS, DAY_AND_NIGHT];
    const scanner = new EntropyScanner();
    let n = 0;
    for (const ruleset of rules) {
      for (let seed = 1; seed <= 5; seed++) {
        const sim = new Simulation({
          ruleset: { ...ruleset, boundary: 'toroidal' },
          width: W,
          height: H,
          seed,
        });
        seedBinary(sim, new Mulberry32(seed * 17), W, H, 0.45);
        for (let t = 0; t < 4; t++) sim.step();
        const exact = scanner.measure(sim.view(), { blockStride: 1 }).entropy;
        const sampled = scanner.measure(sim.view(), { sampleFraction: 0.75 }).entropy;
        expect(sampled).toBeGreaterThan(0);
        expect(Math.abs(sampled - exact) / exact).toBeLessThanOrEqual(0.05);
        n += 1;
      }
    }
    expect(n).toBe(20);
  });
});

describe('EntropyScanner', () => {
  it('rejects a non-positive period or stride', () => {
    expect(() => new EntropyScanner({ period: 0 })).toThrow(/period/);
    expect(() => new EntropyScanner({ blockStride: -1 })).toThrow(/blockStride/);
  });

  it('rejects a sampleFraction outside (0, 1]', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 16,
      height: 16,
      seed: 1,
    });
    const scanner = new EntropyScanner();
    expect(() => scanner.measure(sim.view(), { sampleFraction: 0 })).toThrow(/sampleFraction/);
    expect(() => scanner.measure(sim.view(), { sampleFraction: 1.2 })).toThrow(/sampleFraction/);
  });

  it('empty world is 0 bits and exact', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 32,
      height: 32,
      seed: 1,
    });
    const sample = new EntropyScanner().measure(sim.view());
    expect(sample.entropy).toBe(0);
    expect(sample.exact).toBe(true);
    expect(sample.blocksTotal).toBe(4);
    expect(describeEntropy(sample)).toBe('0.00 bits (exact)');
  });

  it('exposes per-chunk population from the same walk', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 64,
      height: 32,
      seed: 1,
    });
    sim.set(0, 0, 1);
    sim.set(40, 0, 1);
    sim.set(40, 1, 1);
    const scanner = new EntropyScanner();
    scanner.measure(sim.view());
    expect(scanner.chunkCount).toBe(2);
    const pops = [...scanner.chunkPopulation.subarray(0, scanner.chunkCount)].sort((a, b) => a - b);
    expect(pops).toEqual([1, 2]);
    expect(scanner.chunkKeys[0]).toBe(packChunk(0, 0));
  });

  it('observe holds the previous reading and marks it not-exact off-period', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 32,
      height: 32,
      seed: 1,
    });
    seedBinary(sim, new Mulberry32(3), 32, 32, 0.5);
    const scanner = new EntropyScanner({ period: 8, blockStride: 1 });
    const first = scanner.observe(sim.view(), 8);
    expect(first.exact).toBe(true);
    expect(scanner.due(8)).toBe(true);
    const held = scanner.observe(sim.view(), 9);
    expect(held.exact).toBe(false);
    expect(held.entropy).toBe(first.entropy);
    expect(describeEntropy(held)).toContain('sampled');
  });

  it('two scanners do not share mutable buffers', () => {
    const a = new EntropyScanner();
    const b = new EntropyScanner();
    expect(a.chunkKeys).not.toBe(b.chunkKeys);
    expect(a.chunkPopulation).not.toBe(b.chunkPopulation);
  });
});

describe('StatsCollector entropy wiring', () => {
  it('reset takes an exact reading; apply marks it stale; the label says so', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 32,
      height: 32,
      seed: 1,
    });
    seedBinary(sim, new Mulberry32(4), 32, 32, 0.4);
    const collector = new StatsCollector({ entropyPeriod: 8 });
    collector.reset(sim.view(), 0);
    expect(collector.snapshot.entropyExact).toBe(true);
    expect(collector.snapshot.entropy).toBeGreaterThan(0);
    expect(collector.sample().entropy).toBe(collector.snapshot.entropy);
    expect(collector.entropyLabel()).toContain('exact');

    collector.apply(sim.step(), sim.view());
    expect(collector.snapshot.entropyExact).toBe(false);
    expect(collector.entropyLabel()).toContain('sampled');
  });

  it('observeEntropy on a due tick refreshes the reading', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'toroidal' },
      width: 32,
      height: 32,
      seed: 1,
    });
    seedBinary(sim, new Mulberry32(5), 32, 32, 0.5);
    const collector = new StatsCollector({ entropyPeriod: 1 });
    collector.reset(sim.view(), 0);
    collector.apply(sim.step(), sim.view());
    collector.observeEntropy(sim.view());
    expect(collector.snapshot.entropyExact).toBe(true);
    expect(collector.snapshot.entropy).toBeGreaterThan(0);
    expect(collector.entropyLabel()).toContain('exact');
  });
});
