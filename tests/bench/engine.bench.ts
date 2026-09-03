import { CONWAY } from '../../src/engine/rules/builtin/index.ts';
import { Simulation } from '../../src/engine/simulation.ts';
import { StatsCollector } from '../../src/engine/stats/collector.ts';
import type { PaintOp } from '../../src/engine/types.ts';
import { gc, soup, toroidalConway } from './helpers.ts';
import type { BenchCase } from './types.ts';

const SOUP_512_STEPS = 60;
const SOUP_4096_STEPS = 10;

let soup512: Simulation | undefined;
let soup4096: Simulation | undefined;
let memSim: Simulation | undefined;
let paintSim: Simulation | undefined;
let paintOps: PaintOp[] | undefined;
let snapSim: Simulation | undefined;
let snap: ReturnType<Simulation['snapshot']> | undefined;
let seekSim: Simulation | undefined;
let memMb = 0;
let statsBaseline: Simulation | undefined;
let statsWith: Simulation | undefined;
let statsCollector: StatsCollector | undefined;

export const cases: BenchCase[] = [
  {
    id: 'conway-512-soup',
    name: 'Conway 512² 50% soup steps/sec',
    unit: 'steps/sec',
    budget: 60,
    higherIsBetter: true,
    warmup: 3,
    setup() {
      soup512 = soup(512, 512, 0.5);
      // Real steps, not a toy loop — V8 needs the actual hot path to tier up.
      for (let i = 0; i < 80; i++) soup512.step();
    },
    run() {
      const sim = soup512!;
      const t0 = performance.now();
      for (let i = 0; i < SOUP_512_STEPS; i++) sim.step();
      return (SOUP_512_STEPS / (performance.now() - t0)) * 1000;
    },
    teardown() {
      soup512 = undefined;
    },
  },
  {
    id: 'conway-4096-1pct',
    name: 'Conway 4096² @ 1% density steps/sec',
    unit: 'steps/sec',
    budget: 5,
    higherIsBetter: true,
    warmup: 1,
    setup() {
      soup4096 = soup(4096, 4096, 0.01);
      for (let i = 0; i < 4; i++) soup4096.step();
    },
    run() {
      const sim = soup4096!;
      const t0 = performance.now();
      for (let i = 0; i < SOUP_4096_STEPS; i++) sim.step();
      return (SOUP_4096_STEPS / (performance.now() - t0)) * 1000;
    },
    teardown() {
      soup4096?.clear();
      soup4096 = undefined;
      gc();
    },
  },
  {
    id: 'paint-1m',
    name: '1M-cell paint',
    unit: 'ops/sec',
    higherIsBetter: true,
    warmup: 1,
    setup() {
      paintSim = new Simulation({
        ruleset: toroidalConway(),
        width: 1024,
        height: 1024,
        seed: 1,
      });
      const ops: PaintOp[] = [];
      for (let i = 0; i < 1_000_000; i++) {
        ops.push({ x: i & 1023, y: (i >>> 10) & 1023, state: 1 });
      }
      paintOps = ops;
    },
    run() {
      const sim = paintSim!;
      sim.clear();
      const t0 = performance.now();
      sim.paint(paintOps!);
      const elapsed = performance.now() - t0;
      return (1_000_000 / elapsed) * 1000;
    },
    teardown() {
      paintSim = undefined;
      paintOps = undefined;
    },
  },
  {
    id: 'grid-1m-memory',
    name: '1M live cells over 4096² (grid memory)',
    unit: 'MB',
    budget: 40,
    higherIsBetter: false,
    warmup: 0,
    setup() {
      gc();
      gc();
      const sim = soup(4096, 4096, 1_000_000 / (4096 * 4096));
      const live = sim.stats.population;
      if (live < 900_000) {
        throw new Error(`grid-1m-memory: expected ~1M live cells, got ${live}`);
      }
      // Typed-array payload of the sparse pages (Uint8Array data + Uint32Array perState
      // per allocated chunk). Heap deltas across cases are poisoned by the Chunk pool and
      // non-deterministic GC; this is the grid's own allocation, which is what the 40 MB
      // budget was sized for (16384 chunks × 2 KiB ≈ 32 MB).
      let chunks = 0;
      sim.view().forEachChunkInRect({ x: 0, y: 0, width: 4096, height: 4096 }, () => {
        chunks += 1;
      });
      const PAGE_BYTES = 1024; // Chunk.data
      const PER_STATE_BYTES = 256 * 4; // Chunk.perState
      memMb = (chunks * (PAGE_BYTES + PER_STATE_BYTES)) / (1024 * 1024);
      memSim = sim;
    },
    run() {
      if (memSim == null) throw new Error('grid-1m-memory: sim was reclaimed before measure');
      return memMb;
    },
    teardown() {
      memSim = undefined;
      gc();
    },
  },
  {
    id: 'snapshot-restore',
    name: 'snapshot then restore a 512² soup',
    unit: 'ms',
    higherIsBetter: false,
    warmup: 2,
    setup() {
      snapSim = soup(512, 512, 0.5);
      for (let i = 0; i < 8; i++) snapSim.step();
      snap = snapSim.snapshot();
    },
    run() {
      const sim = snapSim!;
      const held = snap!;
      const t0 = performance.now();
      sim.restore(held);
      sim.snapshot();
      return performance.now() - t0;
    },
    teardown() {
      snapSim = undefined;
      snap = undefined;
    },
  },
  {
    id: 'seek-4000',
    name: 'seek back 4,000 ticks (K=64)',
    unit: 'ms',
    budget: 250,
    higherIsBetter: false,
    baselineGate: false,
    warmup: 1,
    setup() {
      seekSim = new Simulation({
        ruleset: { ...CONWAY, boundary: 'toroidal' },
        width: 64,
        height: 64,
        seed: 0xf1a701,
        history: { keyframeInterval: 64 },
      });
      seekSim.seedRandom(0.4, 0xf1a701);
      for (let i = 0; i < 4_000; i++) seekSim.step();
    },
    run() {
      const sim = seekSim!;
      const t0 = performance.now();
      sim.seek(0);
      const ms = performance.now() - t0;
      sim.seek(4_000);
      return ms;
    },
    teardown() {
      seekSim = undefined;
    },
  },
  {
    id: 'stats-overhead',
    name: 'StatsCollector.apply overhead on 512² soup',
    unit: '%',
    budget: 3,
    higherIsBetter: false,
    baselineGate: false,
    warmup: 3,
    setup() {
      statsBaseline = soup(512, 512, 0.5, 4);
      statsWith = soup(512, 512, 0.5, 4);
      statsCollector = new StatsCollector();
      statsCollector.reset(statsWith.view(), 0);
      const jit = new StatsCollector();
      const jitSim = soup(512, 512, 0.5, 99);
      const cs = jitSim.step();
      for (let i = 0; i < 20_000; i++) jit.apply(cs);
      for (let i = 0; i < 80; i++) {
        statsBaseline.step();
        statsCollector.apply(statsWith.step());
      }
    },
    run() {
      const STEPS = 180;
      const t0 = performance.now();
      for (let i = 0; i < STEPS; i++) statsBaseline!.step();
      const stepMs = performance.now() - t0;
      const t1 = performance.now();
      for (let i = 0; i < STEPS; i++) statsCollector!.apply(statsWith!.step());
      const combinedMs = performance.now() - t1;
      return ((combinedMs - stepMs) / stepMs) * 100;
    },
    teardown() {
      statsBaseline = undefined;
      statsWith = undefined;
      statsCollector = undefined;
    },
  },
];
