import { beforeAll, describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { StatsCollector } from '@engine/stats/collector';
import {
  chooseTier,
  describeSeriesQuery,
  lttbIndices,
  Series,
  TIER_SLOTS,
  TIER_STRIDE,
} from '@engine/stats/series';
import type { StatSample } from '@engine/types';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';
const MB = 1024 * 1024;

function blankSample(): StatSample {
  return {
    tick: 0,
    population: 0,
    perState: new Uint32Array(256),
    births: 0,
    deaths: 0,
    transitions: 0,
    activity: 0,
    density: 0,
    bbox: { x: 0, y: 0, width: 0, height: 0 },
    centroid: { x: 0, y: 0 },
    entropy: 0,
    hash: 0,
  };
}

function pushSine(series: Series, n: number, period: number, mean: number, amp: number): void {
  const s = blankSample();
  const tau = (2 * Math.PI) / period;
  for (let t = 0; t < n; t++) {
    s.tick = t;
    s.population = mean + amp * Math.sin(t * tau);
    s.perState[1] = s.population | 0;
    series.push(s);
  }
}

function envelope(points: readonly { populationMin: number; populationMax: number }[]): number {
  let band = 0;
  for (const p of points) band = Math.max(band, p.populationMax - p.populationMin);
  return band;
}

describe('lttbIndices', () => {
  it('returns nothing for an empty series', () => {
    expect(lttbIndices(0, 8, (i) => i, (i) => i)).toEqual([]);
  });
  it('keeps every point when maxPoints is at least n', () => {
    expect(lttbIndices(5, 5, (i) => i, (i) => (i % 2 === 0 ? 0 : 10))).toEqual([0, 1, 2, 3, 4]);
  });

  it('always keeps the first and last point', () => {
    const n = 100;
    const idx = lttbIndices(n, 8, (i) => i, (i) => (i % 10 === 0 ? 50 : 0));
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    expect(idx).toHaveLength(8);
  });

  it('maxPoints 1 returns the last index; 2 returns the ends', () => {
    expect(lttbIndices(10, 1, (i) => i, (i) => i)).toEqual([9]);
    expect(lttbIndices(10, 2, (i) => i, (i) => i)).toEqual([0, 9]);
  });
});

describe('chooseTier', () => {
  it('picks the finest ring that still covers the requested age', () => {
    expect(chooseTier(0, [10, 0, 0, 0])).toBe(0);
    expect(chooseTier(5_000, [4096, 100, 0, 0])).toBe(1);
    expect(chooseTier(100_000, [4096, 4096, 50, 0])).toBe(2);
    expect(chooseTier(2_000_000, [4096, 4096, 4096, 8])).toBe(3);
  });

  it('falls back when a coarser ring is still empty', () => {
    expect(chooseTier(2_000_000, [4096, 4096, 4096, 0])).toBe(2);
    expect(chooseTier(2_000_000, [4096, 10, 0, 0])).toBe(1);
    expect(chooseTier(2_000_000, [0, 0, 0, 0])).toBe(0);
  });
});

describe('Series', () => {
  it('rejects a bad maxPoints or inverted range', () => {
    const s = new Series();
    expect(() => s.query(0, 1, 0)).toThrow(/maxPoints/);
    expect(() => s.query(0, 1, 1.5)).toThrow(/maxPoints/);
    expect(() => s.query(5, 1, 8)).toThrow(/before fromTick/);
  });

  it('two series do not share rings', () => {
    const a = new Series();
    const b = new Series();
    const s = blankSample();
    s.population = 7;
    a.push(s);
    expect(a.sampleCount).toBe(1);
    expect(b.sampleCount).toBe(0);
    expect(a.bytes).toBe(b.bytes);
  });

  it('preallocated rings sit under the 32 MB cap before any push', () => {
    expect(new Series().bytes).toBeLessThan(32 * MB);
  });

  it('query of a range with no stored ticks is empty', () => {
    const series = new Series();
    const s = blankSample();
    s.tick = 3;
    series.push(s);
    const q = series.query(100, 200, 8);
    expect(q.points).toEqual([]);
    expect(q.sourceCount).toBe(0);
  });

  it('query of an empty series is empty and labelled', () => {
    const q = new Series().query(0, 100, 800);
    expect(q.points).toEqual([]);
    expect(describeSeriesQuery(q)).toBe('No samples');
  });

  it('reset forgets every ring', () => {
    const series = new Series();
    const s = blankSample();
    for (let t = 0; t < 20; t++) {
      s.tick = t;
      s.population = t;
      series.push(s);
    }
    expect(series.tierPoints(1).length).toBeGreaterThan(0);
    series.reset();
    expect(series.sampleCount).toBe(0);
    expect(series.tierPoints(1)).toEqual([]);
    expect(series.query(0, 20, 8).points).toEqual([]);
  });

  it('a short run uses tier 0 and is exact (min = max = population)', () => {
    const series = new Series();
    const s = blankSample();
    for (let t = 0; t < 50; t++) {
      s.tick = t;
      s.population = t;
      series.push(s);
    }
    const q = series.query(0, 49, 800);
    expect(q.tier).toBe(0);
    expect(q.aggregated).toBe(false);
    expect(q.downsampled).toBe(false);
    expect(q.points).toHaveLength(50);
    expect(q.points[0]?.populationMin).toBe(q.points[0]?.population);
    expect(q.points[0]?.populationMax).toBe(q.points[0]?.population);
    expect(series.query(0, 49, 1).points).toHaveLength(1);
    expect(describeSeriesQuery(q)).toMatch(/Tier 0 \(every tick\)/);
  });

  it('an oscillation in tier 0 remains visible as a min/max band in tier 3', () => {
    const period = 32;
    const amp = 50;
    const series = new Series();
    // One T3 slot is 4,096 ticks = 128 periods of this sine — enough for
    // min/max to reach the peaks. Two slots proves the fold repeats.
    pushSine(series, 8_192, period, 200, amp);
    const t3 = series.tierPoints(3);
    expect(t3.length).toBeGreaterThan(0);
    expect(envelope(t3)).toBeGreaterThan(2 * amp * 0.9);
    expect(TIER_STRIDE[3]).toBe(4096);
  });
});

describe.skipIf(UNDER_COVERAGE)('million-tick series', { timeout: 60_000 }, () => {
  const period = 32;
  const mean = 200;
  const amp = 50;
  // T2 spans the last 1,048,576 ticks; push past that so the oldest
  // samples live only in tier 3.
  const n = 1_048_576 + 8_192;
  const series = new Series();

  beforeAll(() => {
    pushSine(series, n, period, mean, amp);
  });

  it('one million ticks occupy < 32 MB', () => {
    expect(series.bytes).toBeLessThan(32 * MB);
    expect(series.capacity).toBe(TIER_SLOTS);
    expect(series.sampleCount).toBe(TIER_SLOTS);
  });

  it('query over a million ticks at 800 points completes in < 8 ms', () => {
    const to = n - 1;
    const from = to - 999_999;
    series.query(from, to, 800);
    const t0 = performance.now();
    const q = series.query(from, to, 800);
    const ms = performance.now() - t0;
    expect(q.points.length).toBeLessThanOrEqual(800);
    expect(q.points.length).toBeGreaterThan(0);
    expect(q.tier).toBe(2);
    expect(q.aggregated).toBe(true);
    expect(q.downsampled).toBe(true);
    expect(describeSeriesQuery(q)).toMatch(/Tier 2/);
    expect(describeSeriesQuery(q)).toMatch(/min\/mean\/max/);
    expect(describeSeriesQuery(q)).toMatch(/LTTB/);
    if (!UNDER_COVERAGE) expect(ms).toBeLessThan(8);
  });

  it('query of the oldest ticks uses tier 3 and keeps the envelope', () => {
    const oldest = series.query(0, 8_000, 800);
    expect(oldest.tier).toBe(3);
    expect(oldest.aggregated).toBe(true);
    expect(envelope(oldest.points)).toBeGreaterThan(2 * amp * 0.9);
    expect(describeSeriesQuery(oldest)).toMatch(/min\/mean\/max/);
  });
});

describe('StatsCollector.series', () => {
  it('records samples from reset and apply', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'infinite' },
    });
    sim.set(0, 0, 1);
    sim.set(1, 0, 1);
    sim.set(0, 1, 1);
    sim.set(1, 1, 1);
    const collector = new StatsCollector();
    collector.reset(sim.view(), 0);
    expect(collector.series.sampleCount).toBe(1);
    collector.apply(sim.step(), sim.view());
    expect(collector.series.sampleCount).toBe(2);
    const q = collector.series.query(0, sim.tick, 16);
    expect(q.points.length).toBe(2);
    expect(q.points[0]?.population).toBe(4);
  });
});
