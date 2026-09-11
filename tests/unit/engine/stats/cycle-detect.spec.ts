import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
  CycleDetector,
  snapshotsEqual,
  snapshotsEqualInWindow,
  snapshotsEqualTranslated,
  WINDOW_PAD,
  type CycleReport,
} from '@engine/stats/cycle-detect';
import { decode } from '@shared/rle';
import type { RuleSet } from '@engine/types';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';
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
  // `set` does not record history; pin tick 0 so materialize(0) is the stamp.
  if (sim.history) sim.restore(sim.snapshot());
}

function seedBinary(sim: Simulation, rng: Mulberry32, w: number, h: number, p: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rng.next() < p) sim.set(x, y, 1);
    }
  }
}

function runUntil(
  sim: Simulation,
  collector: StatsCollector,
  gens: number,
  pred: (report: CycleReport | null) => boolean,
): CycleReport | null {
  collector.reset(sim.view(), sim.tick);
  collector.observeCycle((t) => sim.materialize(t));
  for (let i = 0; i < gens; i++) {
    collector.apply(sim.step(), sim.view());
    const report = collector.observeCycle((t) => sim.materialize(t));
    if (pred(report)) return report;
  }
  return collector.cycle;
}

function expectOscillator(file: string, period: number, gens: number): void {
  const sim = new Simulation({ ruleset: infiniteConway(), history: true });
  stampRle(sim, file);
  const collector = new StatsCollector();
  const report = runUntil(sim, collector, gens, (r) => r?.kind === 'oscillator' && r.period === period);
  expect(report, `${file} should be an oscillator of period ${period}`).toEqual(
    expect.objectContaining({
      kind: 'oscillator',
      period,
      displacement: { x: 0, y: 0 },
    }),
  );
}

describe('P2-C-3 cycle detection', () => {
  it('blinker is period 2', () => {
    expectOscillator('blinker.rle', 2, 8);
  });

  it('pulsar is period 3', () => {
    expectOscillator('pulsar.rle', 3, 12);
  });

  it('pentadecathlon is period 15', () => {
    expectOscillator('pentadecathlon.rle', 15, 40);
  });

  it('a glider is a translating oscillator of period 4 with displacement (1,1)', () => {
    const sim = new Simulation({ ruleset: infiniteConway(), history: true });
    stampRle(sim, 'glider.rle');
    const collector = new StatsCollector();
    const report = runUntil(
      sim,
      collector,
      16,
      (r) => r?.kind === 'spaceship' && r.period === 4,
    );
    expect(report).toEqual(
      expect.objectContaining({
        kind: 'spaceship',
        period: 4,
        displacement: { x: 1, y: 1 },
      }),
    );
  });

  it(
    'Gosper gun is period 30 via a frozen core window (pad 8) so emitted gliders do not defeat detection',
    () => {
      // Windowing: live bbox at reset + WINDOW_PAD, frozen in world space.
      // Classic RLE already contains a forming glider; pad 8 lets that first
      // glider leave (~32 gens at c/4) so later phases compare the gun plus
      // the in-production glider only. See cycle-detect.ts.
      expect(WINDOW_PAD).toBe(8);
      const sim = new Simulation({ ruleset: infiniteConway(), history: true });
      stampRle(sim, 'gosper-gun.rle');
      const collector = new StatsCollector();
      const report = runUntil(
        sim,
        collector,
        360,
        (r) => r?.kind === 'windowed' && r.period === 30,
      );
      expect(report, 'gun should report a windowed period of 30').toEqual(
        expect.objectContaining({
          kind: 'windowed',
          period: 30,
          displacement: { x: 0, y: 0 },
        }),
      );
      const w = collector.hasher.core;
      expect(w.width).toBeGreaterThan(0);
      expect(w.height).toBeGreaterThan(0);
    },
  );

  it('a hash+population repeat is not reported without journal confirmation', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stampRle(sim, 'blinker.rle');
    const collector = new StatsCollector();
    collector.reset(sim.view(), 0);
    for (let i = 0; i < 8; i++) collector.apply(sim.step(), sim.view());
    expect(collector.cycle).toBeNull();
  });

  it('two detectors do not share mutable maps', () => {
    const simA = new Simulation({ ruleset: infiniteConway(), history: true });
    const simB = new Simulation({ ruleset: infiniteConway(), history: true });
    stampRle(simA, 'blinker.rle');
    stampRle(simB, 'glider.rle');
    const a = new StatsCollector();
    const b = new StatsCollector();
    runUntil(simA, a, 8, (r) => r?.kind === 'oscillator');
    expect(b.cycle).toBeNull();
    expect(a.cycle?.kind).toBe('oscillator');
    b.reset(simB.view(), 0);
    expect(b.cycle).toBeNull();
    expect(a.cycle?.period).toBe(2);
  });

  it(
    'zero false positives across 20 chaotic 5,000-generation runs',
    { timeout: 180_000 },
    () => {
      const gens = UNDER_COVERAGE ? 80 : 5_000;
      const W = 64;
      const H = 64;
      const fixtures: Array<{ ruleset: RuleSet; p: number }> = [
        { ruleset: CONWAY, p: 0.35 },
        { ruleset: HIGHLIFE, p: 0.35 },
        { ruleset: DAY_AND_NIGHT, p: 0.45 },
        { ruleset: BRIANS_BRAIN, p: 0.3 },
        { ruleset: STAR_WARS, p: 0.3 },
      ];
      const seeds = [3, 11, 29, 47];
      let runs = 0;
      for (const fixture of fixtures) {
        for (const seed of seeds) {
          runs += 1;
          const sim = new Simulation({
            ruleset: { ...fixture.ruleset, boundary: 'toroidal' },
            width: W,
            height: H,
            seed,
            history: true,
          });
          seedBinary(sim, new Mulberry32(seed), W, H, fixture.p);
          sim.restore(sim.snapshot());
          const collector = new StatsCollector();
          collector.reset(sim.view(), 0);
          collector.observeCycle((t) => sim.materialize(t));
          for (let i = 0; i < gens; i++) {
            collector.apply(sim.step(), sim.view());
            collector.observeCycle((t) => sim.materialize(t));
          }
          const report = collector.cycle;
          if (!report) continue;
          const a = sim.materialize(report.previousTick);
          const b = sim.materialize(report.detectedAt);
          if (report.kind === 'oscillator') {
            expect(snapshotsEqual(a, b), `false oscillator seed=${seed}`).toBe(true);
          } else if (report.kind === 'spaceship') {
            expect(
              snapshotsEqualTranslated(a, b, report.displacement.x, report.displacement.y),
              `false spaceship seed=${seed}`,
            ).toBe(true);
          } else {
            expect(
              snapshotsEqualInWindow(a, b, collector.hasher.core),
              `false windowed seed=${seed}`,
            ).toBe(true);
          }
        }
      }
      expect(runs).toBe(20);
    },
  );

  it('replaces a confirmed cycle with a shorter period of the same kind', () => {
    const sim = new Simulation({ ruleset: infiniteConway(), history: true });
    sim.set(0, 0, 1);
    sim.set(1, 0, 1);
    sim.set(0, 1, 1);
    sim.set(1, 1, 1);
    sim.restore(sim.snapshot());
    const block = sim.snapshot();
    const materialize = (t: number) => ({ ...block, tick: t });
    const bbox = { x: 0, y: 0, width: 2, height: 2 };
    const core = { x: -8, y: -8, width: 18, height: 18 };
    const det = new CycleDetector();
    const base = {
      population: 4,
      absHash: 1,
      shapeHash: 1,
      windowHash: 1,
      windowPop: 4,
      bbox,
      core,
      shapeValid: true,
      materialize,
    };
    det.observe({ ...base, tick: 0 });
    det.observe({ ...base, tick: 4 });
    expect(det.current?.period).toBe(4);
    det.observe({ ...base, tick: 5, absHash: 2 });
    det.observe({ ...base, tick: 7, absHash: 2 });
    expect(det.current?.period).toBe(2);
    expect(det.current?.kind).toBe('oscillator');
  });

  it('a journal miss on a candidate is not reported as a cycle', () => {
    const det = new CycleDetector();
    const bbox = { x: 0, y: 0, width: 1, height: 1 };
    const core = { x: 0, y: 0, width: 0, height: 0 };
    const input = {
      population: 1,
      absHash: 7,
      shapeHash: 7,
      windowHash: 0,
      windowPop: 0,
      bbox,
      core,
      shapeValid: true,
      materialize: (): never => {
        throw new RangeError('tick outside the retained window');
      },
    };
    det.observe({ ...input, tick: 0 });
    expect(det.observe({ ...input, tick: 3 })).toBeNull();
  });

  it('snapshot equality rejects a translated or extra live cell', () => {
    const a = new Simulation({ ruleset: infiniteConway() });
    const b = new Simulation({ ruleset: infiniteConway() });
    a.set(0, 0, 1);
    b.set(1, 0, 1);
    expect(snapshotsEqual(a.snapshot(), b.snapshot())).toBe(false);
    expect(snapshotsEqualTranslated(a.snapshot(), b.snapshot(), 1, 0)).toBe(true);
    expect(snapshotsEqualTranslated(a.snapshot(), b.snapshot(), 0, 1)).toBe(false);
    b.set(2, 0, 1);
    expect(snapshotsEqualTranslated(a.snapshot(), b.snapshot(), 1, 0)).toBe(false);
  });

  it('Simulation.materialize throws when history is off', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    expect(() => sim.materialize(0)).toThrow(/history is disabled/);
  });
});

