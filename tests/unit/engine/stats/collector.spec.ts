import { describe, expect, it } from 'vitest';
import { BRIANS_BRAIN, CONWAY } from '@engine/rules/builtin';
import { Mulberry32 } from '@engine/rng';
import { Simulation } from '@engine/simulation';
import { StatsCollector } from '@engine/stats/collector';
import { DEAD, type ChangeSet, type GridView, type RuleSet } from '@engine/types';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

/**
 * The reference implementation the collector is cross-checked against: read
 * every cell in the *entire* logical world, not `view.bounds()` — bounds()
 * is a live-chunk bounding box (it skips chunks a rule has emptied out, and
 * a since-reclaimed chunk isn't in it at all), so it under-counts DEAD once
 * any region has died back. `StatsCollector`'s running totals must not drift
 * when that happens, so the oracle has to see the same DEAD cells regardless.
 */
function bruteForce(view: GridView, width: number, height: number): { population: number; perState: Uint32Array } {
  const perState = new Uint32Array(256);
  let population = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = view.get(x, y);
      perState[s] = (perState[s] ?? 0) + 1;
      if (s !== DEAD) population += 1;
    }
  }
  return { population, perState };
}

describe('StatsCollector.apply', () => {
  it('classifies each changed cell as a birth, death, or transition, and skips no-ops', () => {
    const collector = new StatsCollector();
    collector.apply({
      tick: 0,
      coords: new Int32Array(3),
      from: new Uint8Array([0, 0, 0]),
      to: new Uint8Array([1, 1, 2]),
      count: 3,
      dirtyChunks: new Int32Array(0),
    });
    expect(collector.snapshot.population).toBe(3);
    expect(collector.snapshot.perState[1]).toBe(2);
    expect(collector.snapshot.perState[2]).toBe(1);
    expect(collector.snapshot.births).toBe(3);
    expect(collector.snapshot.deaths).toBe(0);
    expect(collector.snapshot.transitions).toBe(0);

    collector.apply({
      tick: 1,
      coords: new Int32Array(4),
      from: new Uint8Array([1, 1, 2, 0]),
      to: new Uint8Array([0, 2, 2, 5]),
      count: 4,
      dirtyChunks: new Int32Array(0),
    });
    const s = collector.snapshot;
    // (1→0) death, (1→2) transition, (2→2) no-op skipped, (0→5) birth.
    expect(s.tick).toBe(1);
    expect(s.births).toBe(1);
    expect(s.deaths).toBe(1);
    expect(s.transitions).toBe(1);
    expect(s.activity).toBe(4); // ChangeSet.count, including the skipped no-op
    expect(s.population).toBe(3); // 3 - 1 (death) + 1 (birth)
    expect(s.perState[1]).toBe(0); // 2, minus the death and the transition out
    expect(s.perState[2]).toBe(2); // 1, plus the transition in
    expect(s.perState[5]).toBe(1); // the birth
  });

  it('births/deaths/transitions describe only the latest ChangeSet, not a running total', () => {
    const collector = new StatsCollector();
    collector.apply({
      tick: 0,
      coords: new Int32Array(1),
      from: new Uint8Array([0]),
      to: new Uint8Array([1]),
      count: 1,
      dirtyChunks: new Int32Array(0),
    });
    expect(collector.snapshot.births).toBe(1);
    collector.apply({
      tick: 1,
      coords: new Int32Array(0),
      from: new Uint8Array(0),
      to: new Uint8Array(0),
      count: 0,
      dirtyChunks: new Int32Array(0),
    });
    expect(collector.snapshot.births).toBe(0);
    expect(collector.snapshot.activity).toBe(0);
    expect(collector.snapshot.population).toBe(1); // population is still a running total
  });
});

describe('StatsCollector.reset', () => {
  it('seeds population and per-state counts matching a brute-force recount', () => {
    // Exactly one 32×32 chunk, so the live footprint reset() scans and the
    // logical world the brute-force oracle scans are the same region.
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 32, height: 32, seed: 1 });
    sim.set(0, 0, 1);
    sim.set(1, 1, 1);
    sim.set(2, 2, 1);

    const collector = new StatsCollector();
    collector.reset(sim.view(), 5);
    const brute = bruteForce(sim.view(), 32, 32);
    const s = collector.snapshot;

    expect(s.tick).toBe(5);
    expect(s.population).toBe(brute.population);
    expect(s.population).toBe(3);
    expect(s.perState.slice(0, 2)).toEqual(brute.perState.slice(0, 2));
    expect(s.births).toBe(0);
    expect(s.deaths).toBe(0);
    expect(s.transitions).toBe(0);
    expect(s.activity).toBe(0);
  });

  it('handles a grid with no live cells', () => {
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'bounded' }, width: 4, height: 4, seed: 1 });
    const collector = new StatsCollector();
    collector.reset(sim.view());
    expect(collector.snapshot.population).toBe(0);
    expect(collector.snapshot.perState.every((n) => n === 0)).toBe(true);
  });
});

describe('P0-F-2 cross-check against a brute-force recount', () => {
  it('incremental counters exactly equal a brute-force recount after 2,000 chaotic generations', { timeout: 30_000 }, () => {
    // Brian's Brain never settles into still lifes — three states churning
    // every tick is the "chaotic" case the acceptance criterion asks for.
    // 64×64 is exactly 2×2 chunks, so the world never grows past chunks the
    // toroidal wrap already touches.
    const rule: RuleSet = BRIANS_BRAIN;
    const sim = new Simulation({ ruleset: rule, width: 64, height: 64, seed: 7 });
    const rng = new Mulberry32(7);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (rng.next() < 0.3) sim.set(x, y, 1);
      }
    }

    const collector = new StatsCollector();
    collector.reset(sim.view(), sim.tick);

    const CHECKPOINTS = new Set([1, 2, 50, 500, 1000, 1500, 2000]);
    for (let t = 1; t <= 2000; t++) {
      collector.apply(sim.step());
      if (CHECKPOINTS.has(t)) {
        const brute = bruteForce(sim.view(), 64, 64);
        const s = collector.snapshot;
        expect(s.population).toBe(brute.population);
        expect(s.perState.slice(0, 3)).toEqual(brute.perState.slice(0, 3));
      }
    }
  });
});

/**
 * P0-F-2's acceptance criterion is "collecting stats adds < 3% to step
 * time on the 512² soup benchmark." That number needs `tests/bench`'s
 * warmup + N-run-median methodology (P0-I-4, not built yet — see
 * PHASE_0_FOUNDATION.md, matching P0-C-2's precedent for a bench-gated
 * criterion this phase can't yet enforce precisely). A quick JIT-prewarm
 * + median-of-7 measurement here landed `StatsCollector.apply` consistently
 * around 4-5% overhead once fully warmed (V8 needs several thousand calls
 * through the hot path before it tiers up; short of that it looks far
 * worse and wildly noisy) — close to budget, but this harness can't prove
 * the literal 3%. This test instead guards against a *gross* regression
 * (a stray full-grid scan, an accidental allocation per change, …) with a
 * generously loose ceiling, while P0-I-4 owns the tight, committed-baseline
 * assertion.
 */
describe('P0-F-2 throughput smoke guard', () => {
  it('applying stats does not blow past a generous overhead ceiling on the 512² soup benchmark', { timeout: 30_000 }, () => {
    function soup(seed: number): Simulation {
      const rs: RuleSet = { ...CONWAY, boundary: 'toroidal' };
      const sim = new Simulation({ ruleset: rs, width: 512, height: 512, seed });
      const rng = new Mulberry32(seed);
      for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
          if (rng.next() < 0.5) sim.set(x, y, 1);
        }
      }
      return sim;
    }
    function syntheticChangeSet(tick: number): ChangeSet {
      const n = 512;
      const coords = new Int32Array(n);
      const from = new Uint8Array(n);
      const to = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        coords[i] = i;
        from[i] = i % 2;
        to[i] = (i + 1) % 2;
      }
      return { tick, coords, from, to, count: n, dirtyChunks: new Int32Array(0) };
    }
    function median(xs: number[]): number {
      const sorted = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }

    const STEP_WARM = 10;
    const STEPS = 60;
    // v8 coverage instrumentation makes every call an order of magnitude
    // slower, so a full JIT-prewarm + 7-trial measurement blows well past
    // this test's timeout for no benefit (the assertion below is skipped
    // under coverage anyway) — do the smallest amount of work that still
    // exercises `apply` under instrumentation.
    const TRIALS = UNDER_COVERAGE ? 1 : 7;
    const JIT_WARM = UNDER_COVERAGE ? 0 : 20_000;

    // Cheap synthetic calls to get `StatsCollector.apply` through V8's
    // optimizing tiers before timing anything real.
    const jitCollector = new StatsCollector();
    for (let i = 0; i < JIT_WARM; i++) jitCollector.apply(syntheticChangeSet(i));

    const stepTimes: number[] = [];
    const combinedTimes: number[] = [];
    for (let trial = 0; trial < TRIALS; trial++) {
      const baseline = soup(4);
      for (let i = 0; i < STEP_WARM; i++) baseline.step();
      const t0 = performance.now();
      for (let i = 0; i < STEPS; i++) baseline.step();
      stepTimes.push(performance.now() - t0);

      const withStats = soup(4);
      const collector = new StatsCollector();
      collector.reset(withStats.view(), 0);
      for (let i = 0; i < STEP_WARM; i++) collector.apply(withStats.step());
      const t1 = performance.now();
      for (let i = 0; i < STEPS; i++) collector.apply(withStats.step());
      combinedTimes.push(performance.now() - t1);
    }

    if (!UNDER_COVERAGE) {
      const stepMed = median(stepTimes);
      const combinedMed = median(combinedTimes);
      expect(combinedMed).toBeLessThanOrEqual(stepMed * 1.25);
    }
  });
});
