import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Mulberry32 } from '@engine/rng';
import { Simulation } from '@engine/simulation';
import { StatsCollector } from '@engine/stats/collector';
import {
  CHAOTIC_R2_FLOOR,
  classifyPopulation,
  describeGrowth,
  GrowthClassifier,
  MIN_SAMPLES,
} from '@engine/stats/growth';
import { decode } from '@shared/rle';
import type { RuleSet } from '@engine/types';

const PATTERNS = join(dirname(fileURLToPath(import.meta.url)), '../../../../patterns');

function infiniteConway(): RuleSet {
  return { ...CONWAY, boundary: 'infinite' };
}

function stampRle(sim: Simulation, file: string, ox = 0, oy = 0): void {
  const pattern = decode(readFileSync(join(PATTERNS, file), 'utf8'));
  for (const cell of pattern.cells) {
    if (cell.state === 0) continue;
    sim.set(ox + cell.x, oy + cell.y, cell.state);
  }
}

function runPattern(file: string, gens: number, ox = 0, oy = 0): StatsCollector {
  const sim = new Simulation({ ruleset: infiniteConway() });
  stampRle(sim, file, ox, oy);
  const collector = new StatsCollector();
  collector.reset(sim.view(), 0);
  for (let i = 0; i < gens; i++) collector.apply(sim.step(), sim.view());
  return collector;
}

function series(n: number, y: (i: number) => number): { xs: Float64Array; ys: Float64Array } {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i;
    ys[i] = y(i);
  }
  return { xs, ys };
}

describe('classifyPopulation', () => {
  it('abstains below 64 samples', () => {
    const { xs, ys } = series(63, () => 10);
    const report = classifyPopulation(xs, ys, 63);
    expect(report.kind).toBe('insufficient-data');
    expect(report.samples).toBe(63);
    expect(describeGrowth(report)).toBe('Insufficient data (63/64 samples)');
  });

  it('classifies a still series as constant at exactly 64 samples', () => {
    const { xs, ys } = series(MIN_SAMPLES, () => 12);
    const report = classifyPopulation(xs, ys, MIN_SAMPLES);
    expect(report.kind).toBe('constant');
    expect(report.r2).toBe(1);
    expect(report.r2Adjusted).toBe(1);
  });

  it('classifies a + b x as linear with R² > 0.99', () => {
    const { xs, ys } = series(200, (i) => 40 + 0.2 * i);
    const report = classifyPopulation(xs, ys, 200);
    expect(report.kind).toBe('linear');
    expect(report.r2).toBeGreaterThan(0.99);
  });

  it('classifies a + b x + c x² as quadratic', () => {
    const { xs, ys } = series(300, (i) => 20 + 0.05 * i + 0.002 * i * i);
    const report = classifyPopulation(xs, ys, 300);
    expect(report.kind).toBe('quadratic');
    expect(report.r2).toBeGreaterThan(0.99);
  });

  it('classifies A e^{b x} as exponential', () => {
    const { xs, ys } = series(120, (i) => 3 * Math.exp(0.02 * i));
    const report = classifyPopulation(xs, ys, 120);
    expect(report.kind).toBe('exponential');
    expect(report.r2).toBeGreaterThan(0.99);
  });

  it('labels a noisy walk as chaotic rather than guessing a law', () => {
    const rng = new Mulberry32(0x51e1d);
    const { xs, ys } = series(128, () => 80 + rng.nextInt(60));
    const report = classifyPopulation(xs, ys, 128);
    expect(report.kind).toBe('chaotic');
    expect(report.r2Adjusted).toBeLessThan(CHAOTIC_R2_FLOOR);
    expect(describeGrowth(report)).toMatch(/^Chaotic — no simple growth law/);
  });
});

describe('GrowthClassifier', () => {
  it('rejects a too-small capacity', () => {
    expect(() => new GrowthClassifier({ capacity: 8 })).toThrow(/capacity/);
  });

  it('two classifiers do not share the sample ring', () => {
    const a = new GrowthClassifier({ capacity: 64 });
    const b = new GrowthClassifier({ capacity: 64 });
    for (let i = 0; i < 70; i++) {
      a.observe(i, 10);
      b.observe(i, 10 + i);
    }
    expect(a.classify().kind).toBe('constant');
    expect(b.classify().kind).toBe('linear');
    expect(a.classify().params).not.toBe(b.classify().params);
  });
});

describe('P2-C-4 growth on live patterns', () => {
  it('below 64 samples the collector returns insufficient-data and says so', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    sim.set(0, 0, 1);
    sim.set(1, 0, 1);
    sim.set(0, 1, 1);
    sim.set(1, 1, 1);
    const collector = new StatsCollector();
    collector.reset(sim.view(), 0);
    for (let i = 0; i < 20; i++) collector.apply(sim.step(), sim.view());
    const report = collector.classifyGrowth();
    expect(report.kind).toBe('insufficient-data');
    expect(report.samples).toBe(21); // reset + 20 steps
    expect(collector.growthLabel()).toBe('Insufficient data (21/64 samples)');
  });

  it('a still life is constant', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    sim.set(8, 8, 1);
    sim.set(9, 8, 1);
    sim.set(8, 9, 1);
    sim.set(9, 9, 1);
    const collector = new StatsCollector();
    collector.reset(sim.view(), 0);
    for (let i = 0; i < 80; i++) collector.apply(sim.step(), sim.view());
    const report = collector.classifyGrowth();
    expect(report.kind).toBe('constant');
    expect(report.r2).toBeGreaterThan(0.99);
    expect(collector.growthLabel()).toMatch(/^Constant population/);
  });

  it('Gosper gun is linear with R² > 0.99', { timeout: 30_000 }, () => {
    const collector = runPattern('gosper-gun.rle', 1500);
    const report = collector.classifyGrowth();
    expect(report.kind, `gun classified as ${report.kind} R²=${report.r2}`).toBe('linear');
    expect(report.r2).toBeGreaterThan(0.99);
    expect(collector.growthLabel()).toMatch(/^Linear growth/);
  });

  it('a breeder is quadratic', { timeout: 60_000 }, () => {
    const collector = runPattern('rileys-breeder.rle', 900);
    const report = collector.classifyGrowth();
    expect(report.kind, `breeder classified as ${report.kind} R²=${report.r2}`).toBe('quadratic');
    expect(report.r2).toBeGreaterThan(0.95);
    expect(collector.growthLabel()).toMatch(/^Quadratic growth/);
  });

  it('random soup pre-stabilisation is chaotic', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'toroidal' },
      width: 64,
      height: 64,
      seed: 19,
    });
    const rng = new Mulberry32(19);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (rng.next() < 0.42) sim.set(x, y, 1);
      }
    }
    const collector = new StatsCollector();
    collector.reset(sim.view(), 0);
    for (let i = 0; i < 80; i++) collector.apply(sim.step(), sim.view());
    const report = collector.classifyGrowth();
    expect(report.kind, `soup classified as ${report.kind} R²=${report.r2}`).toMatch(
      /^(chaotic|insufficient-data)$/,
    );
    expect(report.kind).toBe('chaotic');
    expect(collector.growthLabel()).toMatch(/^Chaotic/);
  });
});
