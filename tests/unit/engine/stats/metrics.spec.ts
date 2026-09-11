import { describe, expect, it } from 'vitest';
import { packCell } from '@engine/grid/coords';
import {
  BRIANS_BRAIN,
  CONWAY,
  DAY_AND_NIGHT,
  HIGHLIFE,
  STAR_WARS,
  WIREWORLD,
} from '@engine/rules/builtin';
import { Mulberry32 } from '@engine/rng';
import { Simulation } from '@engine/simulation';
import { StatsCollector } from '@engine/stats/collector';
import { DEAD, type ChangeSet, type GridView, type RuleSet } from '@engine/types';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

interface BruteMetrics {
  population: number;
  perState: Uint32Array;
  density: number;
  bbox: { x: number; y: number; width: number; height: number };
  centroid: { x: number; y: number };
}

/**
 * Cell-accurate oracle. Walks the full logical world — not `view.bounds()`,
 * which is chunk-granular and skips emptied pages.
 */
function bruteMetrics(view: GridView, width: number, height: number): BruteMetrics {
  const perState = new Uint32Array(256);
  let population = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = 0;
  let minY = 0;
  let maxX = -1;
  let maxY = -1;
  let any = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = view.get(x, y);
      perState[s] = (perState[s] ?? 0) + 1;
      if (s === DEAD) continue;
      population += 1;
      sumX += x;
      sumY += y;
      if (!any) {
        minX = maxX = x;
        minY = maxY = y;
        any = true;
      } else {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bbox = any
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width: 0, height: 0 };
  const area =
    view.boundary !== 'infinite' && width > 0 && height > 0
      ? width * height
      : bbox.width * bbox.height;
  return {
    population,
    perState,
    density: population === 0 || area === 0 ? 0 : population / area,
    bbox,
    centroid: population === 0 ? { x: 0, y: 0 } : { x: sumX / population, y: sumY / population },
  };
}

function expectMetrics(collector: StatsCollector, brute: BruteMetrics, states: number): void {
  const s = collector.snapshot;
  expect(s.population).toBe(brute.population);
  expect(s.perState.slice(0, states)).toEqual(brute.perState.slice(0, states));
  expect(s.bbox).toEqual(brute.bbox);
  expect(s.centroid.x).toBeCloseTo(brute.centroid.x, 10);
  expect(s.centroid.y).toBeCloseTo(brute.centroid.y, 10);
  expect(s.density).toBeCloseTo(brute.density, 12);
}

function fluxFromChangeSet(cs: ChangeSet): Int32Array {
  const flux = new Int32Array(256);
  for (let i = 0; i < cs.count; i++) {
    const f = cs.from[i]!;
    const t = cs.to[i]!;
    if (f === t) continue;
    flux[f]!--;
    flux[t]!++;
  }
  return flux;
}

function seedBinary(sim: Simulation, rng: Mulberry32, w: number, h: number, p: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rng.next() < p) sim.set(x, y, 1);
    }
  }
}

describe('P2-C-1 incremental metrics', () => {
  it('reset seeds density, bbox and centroid from a known block', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 32,
      height: 32,
      seed: 1,
    });
    for (let y = 4; y <= 6; y++) {
      for (let x = 2; x <= 5; x++) sim.set(x, y, 1);
    }
    const collector = new StatsCollector();
    collector.reset(sim.view(), 3);
    expect(collector.snapshot.tick).toBe(3);
    expect(collector.snapshot.population).toBe(12);
    expect(collector.snapshot.bbox).toEqual({ x: 2, y: 4, width: 4, height: 3 });
    expect(collector.snapshot.centroid).toEqual({ x: 3.5, y: 5 });
    expect(collector.snapshot.density).toBeCloseTo(12 / (32 * 32), 12);
    expect(collector.snapshot.flux.every((n) => n === 0)).toBe(true);

    const sample = collector.sample();
    expect(sample.density).toBe(collector.snapshot.density);
    expect(sample.bbox).toEqual(collector.snapshot.bbox);
    expect(sample.centroid).toEqual(collector.snapshot.centroid);
    expect(sample.entropy).toBe(0);
    expect(sample.hash).toBe(0);
    expect(sample.perState).not.toBe(collector.snapshot.perState);
  });

  it('infinite-world density is population / bbox area', () => {
    const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'infinite' }, seed: 1 });
    sim.set(10, 10, 1);
    sim.set(11, 10, 1);
    sim.set(10, 11, 1);
    const collector = new StatsCollector();
    collector.reset(sim.view());
    expect(collector.snapshot.bbox).toEqual({ x: 10, y: 10, width: 2, height: 2 });
    expect(collector.snapshot.density).toBeCloseTo(3 / 4, 12);
  });

  it('bounding box is correct after a pattern shrinks', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 32,
      height: 32,
      seed: 1,
    });
    for (let y = 2; y <= 7; y++) {
      for (let x = 2; x <= 7; x++) sim.set(x, y, 1);
    }
    const collector = new StatsCollector();
    collector.reset(sim.view());
    expect(collector.snapshot.bbox).toEqual({ x: 2, y: 2, width: 6, height: 6 });

    const ring: Array<{ x: number; y: number }> = [];
    for (let y = 2; y <= 7; y++) {
      for (let x = 2; x <= 7; x++) {
        if (x === 2 || x === 7 || y === 2 || y === 7) ring.push({ x, y });
      }
    }
    const n = ring.length;
    const coords = new Int32Array(n);
    const from = new Uint8Array(n);
    const to = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const cell = ring[i]!;
      coords[i] = packCell(cell.x, cell.y);
      from[i] = 1;
      to[i] = DEAD;
      sim.set(cell.x, cell.y, DEAD);
    }
    collector.apply(
      { tick: 1, coords, from, to, count: n, dirtyChunks: new Int32Array(0) },
      sim.view(),
    );

    expect(collector.snapshot.population).toBe(16);
    expect(collector.snapshot.bbox).toEqual({ x: 3, y: 3, width: 4, height: 4 });
    expect(collector.snapshot.centroid).toEqual({ x: 4.5, y: 4.5 });
    expect(collector.snapshot.deaths).toBe(n);
    expect(collector.snapshot.flux[1]).toBe(-n);
    expect(collector.snapshot.flux[DEAD]).toBe(n);

    // Finish the job: delete the remaining 4×4 so the box collapses to empty.
    const rest: Array<{ x: number; y: number }> = [];
    for (let y = 3; y <= 6; y++) {
      for (let x = 3; x <= 6; x++) rest.push({ x, y });
    }
    const m = rest.length;
    const coords2 = new Int32Array(m);
    const from2 = new Uint8Array(m);
    const to2 = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const cell = rest[i]!;
      coords2[i] = packCell(cell.x, cell.y);
      from2[i] = 1;
      to2[i] = DEAD;
      sim.set(cell.x, cell.y, DEAD);
    }
    collector.apply(
      { tick: 2, coords: coords2, from: from2, to: to2, count: m, dirtyChunks: new Int32Array(0) },
      sim.view(),
    );
    expect(collector.snapshot.population).toBe(0);
    expect(collector.snapshot.bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(collector.snapshot.centroid).toEqual({ x: 0, y: 0 });
    expect(collector.snapshot.density).toBe(0);
  });

  it('bbox shrinks across a chunk boundary when the far island dies', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 64,
      height: 64,
      seed: 1,
    });
    sim.set(1, 1, 1);
    sim.set(40, 40, 1);
    const collector = new StatsCollector();
    collector.reset(sim.view());
    expect(collector.snapshot.bbox).toEqual({ x: 1, y: 1, width: 40, height: 40 });

    sim.set(40, 40, DEAD);
    collector.apply(
      {
        tick: 1,
        coords: new Int32Array([packCell(40, 40)]),
        from: new Uint8Array([1]),
        to: new Uint8Array([DEAD]),
        count: 1,
        dirtyChunks: new Int32Array(0),
      },
      sim.view(),
    );
    expect(collector.snapshot.population).toBe(1);
    expect(collector.snapshot.bbox).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect(collector.snapshot.centroid).toEqual({ x: 1, y: 1 });
  });

  it('two collectors on two simulations do not share mutable state', () => {
    const simA = new Simulation({
      ruleset: { ...CONWAY, boundary: 'toroidal' },
      width: 32,
      height: 32,
      seed: 1,
    });
    const simB = new Simulation({
      ruleset: { ...CONWAY, boundary: 'toroidal' },
      width: 32,
      height: 32,
      seed: 2,
    });
    const rngA = new Mulberry32(1);
    const rngB = new Mulberry32(2);
    seedBinary(simA, rngA, 32, 32, 0.4);
    seedBinary(simB, rngB, 32, 32, 0.4);

    const a = new StatsCollector();
    const b = new StatsCollector();
    a.reset(simA.view(), 0);
    b.reset(simB.view(), 0);

    expect(a.snapshot.perState).not.toBe(b.snapshot.perState);
    expect(a.snapshot.flux).not.toBe(b.snapshot.flux);
    expect(a.snapshot.bbox).not.toBe(b.snapshot.bbox);
    expect(a.snapshot.centroid).not.toBe(b.snapshot.centroid);

    const frozenPop = b.snapshot.population;
    const frozenPerState = b.snapshot.perState.slice();
    const frozenBBox = { ...b.snapshot.bbox };
    const frozenCentroid = { ...b.snapshot.centroid };
    const frozenDensity = b.snapshot.density;

    a.apply(simA.step(), simA.view());
    a.snapshot.perState[1] = 0xffffffff;
    a.snapshot.flux[1] = 99;
    a.snapshot.centroid.x = -999;

    expect(b.snapshot.population).toBe(frozenPop);
    expect(b.snapshot.perState).toEqual(frozenPerState);
    expect(b.snapshot.bbox).toEqual(frozenBBox);
    expect(b.snapshot.centroid).toEqual(frozenCentroid);
    expect(b.snapshot.density).toBe(frozenDensity);
    expect(b.snapshot.perState[1]).not.toBe(0xffffffff);
    expect(b.snapshot.flux[1]).not.toBe(99);
  });

  it(
    'every metric matches a brute-force recount after 5,000 chaotic generations across 6 rulesets',
    { timeout: 120_000 },
    () => {
      const gens = UNDER_COVERAGE ? 80 : 5_000;
      const W = 64;
      const H = 64;
      const fixtures: Array<{
        name: string;
        ruleset: RuleSet;
        states: number;
        seed: (sim: Simulation, rng: Mulberry32) => void;
      }> = [
        {
          name: 'Conway',
          ruleset: CONWAY,
          states: 2,
          seed: (sim, rng) => seedBinary(sim, rng, W, H, 0.35),
        },
        {
          name: 'HighLife',
          ruleset: HIGHLIFE,
          states: 2,
          seed: (sim, rng) => seedBinary(sim, rng, W, H, 0.35),
        },
        {
          name: 'Day & Night',
          ruleset: DAY_AND_NIGHT,
          states: 2,
          seed: (sim, rng) => seedBinary(sim, rng, W, H, 0.45),
        },
        {
          name: "Brian's Brain",
          ruleset: BRIANS_BRAIN,
          states: 3,
          seed: (sim, rng) => seedBinary(sim, rng, W, H, 0.3),
        },
        {
          name: 'WireWorld',
          ruleset: WIREWORLD,
          states: 4,
          seed: (sim, rng) => {
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                const r = rng.next();
                if (r < 0.08) sim.set(x, y, 1);
                else if (r < 0.58) sim.set(x, y, 3);
              }
            }
          },
        },
        {
          name: 'Star Wars',
          ruleset: STAR_WARS,
          states: 4,
          seed: (sim, rng) => seedBinary(sim, rng, W, H, 0.3),
        },
      ];

      for (const fixture of fixtures) {
        const sim = new Simulation({
          ruleset: { ...fixture.ruleset, boundary: 'toroidal' },
          width: W,
          height: H,
          seed: 11,
        });
        fixture.seed(sim, new Mulberry32(11));
        const collector = new StatsCollector();
        collector.reset(sim.view(), sim.tick);
        expectMetrics(collector, bruteMetrics(sim.view(), W, H), fixture.states);

        const checkpoints = new Set([1, 2, 50, 500, 1000, 2500, 4000, 5000, gens]);
        for (let t = 1; t <= gens; t++) {
          const cs = sim.step();
          collector.apply(cs, sim.view());
          if (!checkpoints.has(t) && t !== gens) continue;
          expectMetrics(collector, bruteMetrics(sim.view(), W, H), fixture.states);
          const expectedFlux = fluxFromChangeSet(cs);
          for (let s = 0; s < fixture.states; s++) {
            expect(collector.snapshot.flux[s], `${fixture.name} flux[${s}] @${t}`).toBe(
              expectedFlux[s] ?? 0,
            );
          }
        }
      }
    },
  );
});
