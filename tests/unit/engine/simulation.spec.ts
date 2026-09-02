import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { validateRuleSet } from '@engine/rules/validate';
import { Mulberry32 } from '@engine/rng';
import { Simulation } from '@engine/simulation';
import type { RuleSet } from '@engine/types';

const FIXTURES = fileURLToPath(new URL('../../fixtures/rules/valid/', import.meta.url));

function infiniteConway(): RuleSet {
  return { ...CONWAY, boundary: 'infinite' };
}

function stamp(sim: Simulation, cells: Array<readonly [number, number]>, ox = 0, oy = 0): void {
  for (const [x, y] of cells) sim.set(ox + x, oy + y, 1);
}

function cellsOf(pattern: string[]): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  pattern.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === 'O') out.push([x, y]);
    });
  });
  return out;
}

const BLOCK = cellsOf(['OO', 'OO']);
const BLINKER = cellsOf(['.O.', '.O.', '.O.']);
const GLIDER = cellsOf(['.O.', '..O', 'OOO']);
const R_PENTOMINO = cellsOf(['.OO', 'OO.', '.O.']);
const ACORN = cellsOf(['.O.....', '...O...', 'OO..OOO']);

describe('Simulation construction', () => {
  it('rejects bounded/toroidal rules without width and height', () => {
    expect(() => new Simulation({ ruleset: CONWAY })).toThrow(/width and height/);
  });

  it('records stepMicros from the injected clock', () => {
    let t = 0;
    const clock = { now: () => (t += 17) };
    const sim = new Simulation({ ruleset: infiniteConway(), clock });
    stamp(sim, BLOCK);
    sim.step();
    expect(sim.stats.stepMicros).toBe(17);
  });
});

describe('Phase 0 throughput floor', () => {
  it('steps a 512×512 50%-density soup at ≥ 60 steps/sec', { timeout: 30_000 }, () => {
    const rs: RuleSet = { ...CONWAY, boundary: 'toroidal' };
    const sim = new Simulation({ ruleset: rs, width: 512, height: 512, seed: 1 });
    const rng = new Mulberry32(1);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        if (rng.next() < 0.5) sim.set(x, y, 1);
      }
    }
    for (let i = 0; i < 5; i++) sim.step();
    const STEPS = 60;
    const t0 = performance.now();
    for (let i = 0; i < STEPS; i++) sim.step();
    const elapsed = performance.now() - t0;
    expect((STEPS / elapsed) * 1000).toBeGreaterThanOrEqual(60);
  });
});

describe('ADR-004 oracles', () => {
  it('a block is a still life', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stamp(sim, BLOCK, 10, 10);
    const before = sim.snapshot();
    sim.step();
    expect(sim.stats.population).toBe(4);
    expect(sim.stats.births).toBe(0);
    expect(sim.stats.deaths).toBe(0);
    expect(sim.snapshot().chunkData).toEqual(before.chunkData);
  });

  it('a blinker has period 2', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stamp(sim, BLINKER, 8, 8);
    const t0 = sim.snapshot();
    sim.step();
    expect(sim.snapshot().chunkData).not.toEqual(t0.chunkData);
    sim.step();
    expect(sim.snapshot().chunkData).toEqual(t0.chunkData);
  });

  it('a glider returns to its own shape, translated by (1,1), after exactly 4 generations', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stamp(sim, GLIDER, 0, 0);
    for (let i = 0; i < 4; i++) sim.step();
    const sim2 = new Simulation({ ruleset: infiniteConway() });
    stamp(sim2, GLIDER, 1, 1);
    expect(sim.snapshot().chunkData).toEqual(sim2.snapshot().chunkData);
    expect(sim.get(3, 1)).toBe(sim2.get(3, 1));
    expect(sim.get(0, 0)).toBe(0);
  });

  it(
    'the R-pentomino stabilises at generation 1103 with 116 live cells',
    { timeout: 30_000 },
    () => {
      const sim = new Simulation({ ruleset: infiniteConway() });
      stamp(sim, R_PENTOMINO, 0, 0);
      for (let i = 0; i < 1103; i++) sim.step();
      expect(sim.stats.population).toBe(116);
      const pop = sim.stats.population;
      sim.step();
      expect(sim.stats.population).toBe(pop); // remaining ashes are still
    },
  );

  it('the acorn stabilises at generation 5206 with 633 live cells', { timeout: 60_000 }, () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stamp(sim, ACORN, 0, 0);
    for (let i = 0; i < 5206; i++) sim.step();
    expect(sim.stats.population).toBe(633);
  });
});

describe('ChangeSet reuse and stepMany', () => {
  it('returns the same ChangeSet arrays across ticks (callers must not retain them)', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stamp(sim, BLINKER, 0, 0);
    const a = sim.step();
    const coords = a.coords;
    const b = sim.step();
    expect(b.coords).toBe(coords);
  });

  it('stepMany(n) coalesces from the first before to the last after', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stamp(sim, BLINKER, 4, 4);
    const cs = sim.stepMany(2);
    expect(sim.tick).toBe(2);
    // period-2: net change is empty
    expect(cs.count).toBe(0);
  });
});

describe('snapshot, restore, determinism', () => {
  it('snapshot/restore round-trips a glider mid-flight', () => {
    const sim = new Simulation({ ruleset: infiniteConway(), seed: 7 });
    stamp(sim, GLIDER, 5, 5);
    sim.step();
    sim.step();
    const snap = sim.snapshot();
    const clone = new Simulation({ ruleset: infiniteConway(), seed: 99 });
    clone.restore(snap);
    expect(clone.tick).toBe(sim.tick);
    expect(clone.snapshot().chunkData).toEqual(snap.chunkData);
    sim.step();
    clone.step();
    expect(clone.snapshot().chunkData).toEqual(sim.snapshot().chunkData);
  });

  it(
    'two Simulations with the same seed produce byte-identical snapshots at tick 5,000',
    { timeout: 30_000 },
    () => {
      const paint = (sim: Simulation) => stamp(sim, GLIDER, 10, 10);
      const a = new Simulation({ ruleset: infiniteConway(), seed: 0x51eed });
      const b = new Simulation({ ruleset: infiniteConway(), seed: 0x51eed });
      paint(a);
      paint(b);
      for (let i = 0; i < 5_000; i++) {
        a.step();
        b.step();
      }
      expect(a.snapshot().chunkData).toEqual(b.snapshot().chunkData);
      expect(a.snapshot().chunkKeys).toEqual(b.snapshot().chunkKeys);
      expect(a.tick).toBe(5_000);
    },
  );
});

describe('allocation and throughput', () => {
  it(
    '1,000 steps on a still-life field grow the heap by less than 1 MB',
    { timeout: 20_000 },
    () => {
      const sim = new Simulation({ ruleset: infiniteConway() });
      for (let y = 0; y < 64; y += 4) {
        for (let x = 0; x < 64; x += 4) stamp(sim, BLOCK, x, y);
      }
      for (let i = 0; i < 10; i++) sim.step(); // warm ChangeSet / work-list
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 1_000; i++) sim.step();
      const after = process.memoryUsage().heapUsed;
      expect(after - before).toBeLessThan(1_000_000);
    },
  );
});

describe('turmite', () => {
  it('refuses to step a turmite rule as a per-cell CA', () => {
    const doc = validateRuleSet(JSON.parse(readFileSync(`${FIXTURES}langtons-ant.json`, 'utf8')));
    const sim = new Simulation({ ruleset: doc });
    expect(() => sim.step()).toThrow(/turmite/);
  });
});
