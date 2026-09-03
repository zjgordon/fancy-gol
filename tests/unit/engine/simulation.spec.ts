import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRIANS_BRAIN, CONWAY, HIGHLIFE, SEEDS, STAR_WARS } from '@engine/rules/builtin';
import { validateRuleSet } from '@engine/rules/validate';
import { CHUNK_AREA, packChunk } from '@engine/grid/coords';
import { HistoryJournal, type HistoryEviction } from '@engine/history/journal';
import { Mulberry32 } from '@engine/rng';
import { Simulation } from '@engine/simulation';
import type { ChangeSet, PaintOp, RuleSet, Snapshot } from '@engine/types';

const FIXTURES = fileURLToPath(new URL('../../fixtures/rules/valid/', import.meta.url));
const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

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

describe('Phase 0 throughput smoke', () => {
  // The ≥ 60 steps/sec floor lives in `npm run bench` (P0-I-4, case conway-512-soup).
  // This unit test only guards a *gross* regression — a single 60-step sample on a
  // contended `vitest run` is too noisy to own the real gate (it was flaking at ~59.6).
  it('steps a 512×512 50%-density soup at a usable rate', { timeout: 30_000 }, () => {
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
    if (!UNDER_COVERAGE) expect((STEPS / elapsed) * 1000).toBeGreaterThanOrEqual(20);
  });
});

describe('P0-F-1 history journal', () => {
  const FIELD = { width: 64, height: 64 } as const;
  const SEED = 0xf1a701;

  function identical(a: Snapshot, b: Snapshot): void {
    expect(a.tick).toBe(b.tick);
    expect(a.rngState).toBe(b.rngState);
    expect(a.chunkKeys).toEqual(b.chunkKeys);
    expect(a.chunkData).toEqual(b.chunkData);
  }

  it('seek(t) for 200 random ticks matches a fresh re-simulation byte-for-byte', { timeout: 30_000 }, () => {
    const rule: RuleSet = { ...CONWAY, boundary: 'toroidal' };
    const live = new Simulation({ ruleset: rule, ...FIELD, seed: SEED, history: true });
    const twin = new Simulation({ ruleset: rule, ...FIELD, seed: SEED });
    live.seedRandom(0.4, SEED);
    twin.seedRandom(0.4, SEED);
    const goldens: Snapshot[] = [structuredClone(twin.snapshot())];
    const TICKS = 512;
    for (let i = 0; i < TICKS; i++) {
      live.step();
      twin.step();
      goldens.push(structuredClone(twin.snapshot()));
    }

    const rng = new Mulberry32(0x5eed);
    const picks = new Set<number>([0, 64, TICKS]);
    while (picks.size < 200) picks.add(rng.nextInt(TICKS + 1));

    for (const t of picks) {
      live.seek(t);
      expect(live.tick).toBe(t);
      identical(live.snapshot(), goldens[t]!);
    }
  });

  it('seeking backwards 4,000 ticks completes in < 250 ms with K = 64', { timeout: 30_000 }, () => {
    const rule: RuleSet = { ...CONWAY, boundary: 'toroidal' };
    const sim = new Simulation({
      ruleset: rule,
      ...FIELD,
      seed: SEED,
      history: { keyframeInterval: 64 },
    });
    sim.seedRandom(0.35, SEED);
    const STEPS = 4_100;
    for (let i = 0; i < STEPS; i++) sim.step();
    const target = sim.tick - 4_000;
    const t0 = performance.now();
    sim.seek(target);
    if (!UNDER_COVERAGE) expect(performance.now() - t0).toBeLessThan(250);
    expect(sim.tick).toBe(target);

    const fresh = new Simulation({ ruleset: rule, ...FIELD, seed: SEED });
    fresh.seedRandom(0.35, SEED);
    for (let i = 0; i < target; i++) fresh.step();
    identical(sim.snapshot(), fresh.snapshot());
  });

  it(
    'a 1M-cell chaotic journal for 10,000 ticks stays under the ceiling and reports evictions',
    { timeout: 30_000 },
    () => {
      const keys = new Int32Array(1024);
      const data = new Uint8Array(1024 * CHUNK_AREA);
      const rng = new Mulberry32(0xca0);
      let population = 0;
      let i = 0;
      for (let cy = 0; cy < 32; cy++) {
        for (let cx = 0; cx < 32; cx++) {
          keys[i] = packChunk(cx, cy);
          const off = i * CHUNK_AREA;
          for (let c = 0; c < CHUNK_AREA; c++) {
            // Both values are live, so the page is 1,048,576 occupied cells that
            // will not RLE-shrink — a chaotic 1M-cell payload, not a 50% soup.
            data[off + c] = rng.next() < 0.5 ? 1 : 2;
            population += 1;
          }
          i += 1;
        }
      }
      expect(population).toBe(1024 * 1024);

      const reports: HistoryEviction[] = [];
      const ceiling = 8 * 1024 * 1024;
      const journal = new HistoryJournal({
        keyframeInterval: 64,
        byteCeiling: ceiling,
        onEvict: (e) => reports.push(e),
      });
      const snapAt = (tick: number): Snapshot => ({
        tick,
        chunkKeys: keys,
        chunkData: data,
        rngState: tick,
      });
      const empty: ChangeSet = {
        tick: 0,
        coords: new Int32Array(0),
        from: new Uint8Array(0),
        to: new Uint8Array(0),
        count: 0,
        dirtyChunks: new Int32Array(0),
      };
      journal.resetTo(snapAt(0), population);
      for (let t = 1; t <= 10_000; t++) {
        journal.recordDelta({ ...empty, tick: t }, t);
        if (t % 64 === 0) journal.recordKeyframe(snapAt(t), population);
      }
      expect(journal.bytes).toBeLessThanOrEqual(ceiling);
      expect(journal.evictions).toBeGreaterThan(0);
      expect(reports.length).toBe(journal.evictions);
      expect(reports[0]!.discardedFrom).toBe(0);
      expect(journal.retained.from).toBeGreaterThan(0);
    },
  );

  it('mutating a returned ChangeSet does not rewrite recorded history', () => {
    const rule: RuleSet = { ...CONWAY, boundary: 'toroidal' };
    const sim = new Simulation({ ruleset: rule, width: 32, height: 32, history: true });
    sim.seedRandom(0.5, 3);
    const afterSeed = structuredClone(sim.snapshot());
    const cs = sim.step();
    expect(cs.count).toBeGreaterThan(0);
    const tick1 = structuredClone(sim.snapshot());
    cs.coords.fill(0);
    cs.from.fill(9);
    cs.to.fill(9);
    sim.seek(0);
    identical(sim.snapshot(), afterSeed);
    sim.seek(1);
    identical(sim.snapshot(), tick1);
  });

  it('reports evictions through Simulation, truncates the fork, and refuses seek when history is off', () => {
    const reports: HistoryEviction[] = [];
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'toroidal' },
      width: 32,
      height: 32,
      history: {
        keyframeInterval: 1,
        byteCeiling: 20_000,
        onEvict: (e) => reports.push(e),
      },
    });
    sim.seedRandom(0.5, 1);
    for (let i = 0; i < 80; i++) sim.step();
    expect(sim.history).toBeDefined();
    expect(sim.history!.bytes).toBeLessThanOrEqual(20_000);
    expect(sim.history!.evictions).toBeGreaterThan(0);
    expect(reports.length).toBe(sim.history!.evictions);
    expect(sim.history!.retained.from).toBeGreaterThan(0);

    const mid = sim.tick - 4;
    sim.truncateAfter(mid);
    expect(sim.history!.retained.to).toBe(mid);
    expect(() => sim.seek(mid + 1)).toThrow(/outside the retained window/);
    sim.seek(mid - 1);
    expect(sim.tick).toBe(mid - 1);

    const mute = new Simulation({ ruleset: infiniteConway(), history: false });
    expect(mute.history).toBeUndefined();
    expect(() => mute.seek(0)).toThrow(/history is disabled/);
    expect(() => mute.truncateAfter(0)).toThrow(/history is disabled/);
  });

  it('clear and restore reset the journal to the new head', () => {
    const rule: RuleSet = { ...CONWAY, boundary: 'toroidal' };
    const sim = new Simulation({ ruleset: rule, width: 32, height: 32, history: true });
    sim.seedRandom(0.5, 2);
    sim.step();
    sim.step();
    const snap = structuredClone(sim.snapshot());
    sim.clear();
    expect(sim.stats.population).toBe(0);
    expect(sim.history!.retained).toEqual({ from: sim.tick, to: sim.tick });
    expect(() => sim.seek(0)).toThrow(/outside the retained window/);

    const other = new Simulation({ ruleset: rule, width: 32, height: 32, history: true });
    other.restore(snap);
    expect(other.tick).toBe(snap.tick);
    other.seek(snap.tick);
    identical(other.snapshot(), snap);
  });
});

describe('P0-E-4 snapshot property (five rulesets)', () => {
  it.each([
    ['Conway', CONWAY],
    ['HighLife', HIGHLIFE],
    ["Brian's Brain", BRIANS_BRAIN],
    ['Seeds', SEEDS],
    ['Star Wars', STAR_WARS],
  ] as const)('%s: snapshot → restore → step 100 matches a twin that never left', (_name, rs) => {
    const rule: RuleSet = { ...rs, boundary: 'toroidal' };
    const origin = new Simulation({ ruleset: rule, width: 64, height: 64, seed: 0x51eed });
    origin.seedRandom(0.3, 0x51eed);
    for (let i = 0; i < 8; i++) origin.step();

    const twin = new Simulation({ ruleset: rule, width: 64, height: 64, seed: 0 });
    twin.restore(structuredClone(origin.snapshot()));
    for (let i = 0; i < 100; i++) {
      origin.step();
      twin.step();
    }
    expect(twin.tick).toBe(origin.tick);
    expect(twin.stats.population).toBe(origin.stats.population);
    expect(twin.snapshot().chunkKeys).toEqual(origin.snapshot().chunkKeys);
    expect(twin.snapshot().chunkData).toEqual(origin.snapshot().chunkData);
    expect(twin.snapshot().rngState).toBe(origin.snapshot().rngState);
  });
});

describe('Phase 0 paint and seed budgets', () => {
  it('paints 100,000 cells in one call in under 20 ms with exactly 100,000 changes', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    const ops: PaintOp[] = [];
    for (let i = 0; i < 100_000; i++) {
      ops.push({ x: i % 400, y: (i / 400) | 0, state: 1 });
    }
    const warm = new Simulation({ ruleset: infiniteConway() });
    warm.paint(ops.slice(0, 1024));

    const t0 = performance.now();
    const cs = sim.paint(ops);
    const ms = performance.now() - t0;
    expect(cs.count).toBe(100_000);
    expect(sim.stats.population).toBe(100_000);
    if (!UNDER_COVERAGE) expect(ms).toBeLessThan(20);
  });

  it('seedRandom(0.5) is reproducible and within ±0.5% of target on a 1M-cell field', () => {
    const field = { width: 1024, height: 1024 };
    const a = new Simulation({ ruleset: CONWAY, ...field, seed: 0 });
    const b = new Simulation({ ruleset: CONWAY, ...field, seed: 99 });
    a.seedRandom(0.5, 0x51eed);
    b.seedRandom(0.5, 0x51eed);
    expect(a.snapshot().chunkData).toEqual(b.snapshot().chunkData);
    expect(a.snapshot().chunkKeys).toEqual(b.snapshot().chunkKeys);

    const n = 1024 * 1024;
    const density = a.stats.population / n;
    expect(density).toBeGreaterThanOrEqual(0.5 - 0.005);
    expect(density).toBeLessThanOrEqual(0.5 + 0.005);
  });

  it(
    'snapshot of a 1M-live-cell island serialises in < 100 ms and is ≥ 90% smaller than the dense world',
    { timeout: 20_000 },
    () => {
      const WORLD = 4096;
      const SIDE = 1024; // 1,048,576 live cells, clustered so empty pages stay unallocated
      const sim = new Simulation({
        ruleset: CONWAY,
        width: WORLD,
        height: WORLD,
      });
      const row: PaintOp[] = [];
      for (let x = 0; x < SIDE; x++) row.push({ x, y: 0, state: 1 });
      for (let y = 0; y < SIDE; y++) {
        for (let x = 0; x < SIDE; x++) row[x] = { x, y, state: 1 };
        sim.paint(row);
      }
      expect(sim.stats.population).toBe(SIDE * SIDE);

      const t0 = performance.now();
      const snap = sim.snapshot();
      const ms = performance.now() - t0;
      const bytes = snap.chunkKeys.byteLength + snap.chunkData.byteLength;
      const naive = WORLD * WORLD;
      expect(bytes).toBeLessThanOrEqual(naive * 0.1);
      if (!UNDER_COVERAGE) expect(ms).toBeLessThan(100);
    },
  );
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
    { timeout: 90_000 },
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

  it('the acorn stabilises at generation 5206 with 633 live cells', { timeout: 180_000 }, () => {
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

  it('stepMany(0) is a no-op and stepMany(1) matches step()', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    stamp(sim, BLINKER, 0, 0);
    const idle = sim.stepMany(0);
    expect(idle.count).toBe(0);
    expect(sim.tick).toBe(0);
    const a = sim.stepMany(1);
    expect(sim.tick).toBe(1);
    expect(a.count).toBeGreaterThan(0);
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
