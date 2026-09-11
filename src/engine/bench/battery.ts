/**
 * Standard ruleset test battery (P2-E-3).
 *
 * Runs the candidate rule on eight fixed seeds in a 32×32 toroidal arena
 * and reports stabilisation, population, growth class, period, and a
 * thumbnail. The arena is always toroidal and finite — a research tool
 * that compared infinite vs bounded would be a different experiment.
 *
 * Pure: no DOM, no timers. Cancel is a callback; the worker maps that
 * from a cancel command or `terminate()`.
 */
import { MIN_SAMPLES, classifyPopulation, describeGrowth, type GrowthReport } from '../stats/growth.js';
import { StatsCollector } from '../stats/collector.js';
import { Simulation } from '../simulation.js';
import { Mulberry32 } from '../rng.js';
import { DEAD, type RuleSet, type StateId } from '../types.js';
import {
  BENCH_CASES,
  BENCH_MAX_GENS,
  BENCH_SOUP8,
  BENCH_STABLE_WINDOW,
  BENCH_THUMB,
  BENCH_WORLD,
  thumbnailDigest,
  type BenchCaseResult,
  type BenchCaseSpec,
  type BenchCycleKind,
  type BenchReport,
} from '../../shared/bench.js';

export {
  BENCH_CASES,
  BENCH_MAX_GENS,
  BENCH_THUMB,
  BENCH_WORLD,
  referenceFromReport,
  thumbnailDigest,
} from '../../shared/bench.js';

export class BenchCancelledError extends Error {
  constructor() {
    super('bench cancelled');
    this.name = 'BenchCancelledError';
  }
}

export interface RunBatteryOptions {
  readonly maxGens?: number;
  readonly shouldCancel?: () => boolean;
  readonly onCase?: (result: BenchCaseResult) => void;
}

function liveState(rs: RuleSet): StateId {
  for (const s of rs.states) {
    if (s.countsAsAlive) return s.id;
  }
  throw new RangeError(`ruleset "${rs.name}" has no live state to seed`);
}

function arenaRuleset(ruleset: RuleSet): RuleSet {
  return {
    id: ruleset.id,
    name: ruleset.name,
    states: ruleset.states,
    neighborhood: ruleset.neighborhood,
    transition: ruleset.transition,
    boundary: 'toroidal',
    ...(ruleset.description !== undefined ? { description: ruleset.description } : {}),
    ...(ruleset.author !== undefined ? { author: ruleset.author } : {}),
    ...(ruleset.symmetry !== undefined ? { symmetry: ruleset.symmetry } : {}),
  };
}

function rehead(sim: Simulation): void {
  sim.restore(sim.snapshot());
}

function seedCase(sim: Simulation, spec: BenchCaseSpec, live: StateId): void {
  const mid = BENCH_WORLD >> 1;
  if (spec.kind === 'soup') {
    sim.seedRandom(spec.density ?? 0.5, spec.seed);
    return;
  }
  if (spec.kind === 'single') {
    sim.paint([{ x: mid, y: mid, state: live }]);
    rehead(sim);
    return;
  }
  if (spec.kind === 'block') {
    sim.paint([
      { x: mid, y: mid, state: live },
      { x: mid + 1, y: mid, state: live },
      { x: mid, y: mid + 1, state: live },
      { x: mid + 1, y: mid + 1, state: live },
    ]);
    rehead(sim);
    return;
  }
  const rng = new Mulberry32(spec.seed);
  const origin = (BENCH_WORLD - BENCH_SOUP8) >> 1;
  const density = spec.density ?? 0.5;
  const ops: { x: number; y: number; state: StateId }[] = [];
  for (let y = 0; y < BENCH_SOUP8; y++) {
    for (let x = 0; x < BENCH_SOUP8; x++) {
      if (rng.next() < density) ops.push({ x: origin + x, y: origin + y, state: live });
    }
  }
  if (ops.length > 0) sim.paint(ops);
  rehead(sim);
}

function classifyBenchGrowth(
  pops: readonly number[],
  stabilizationGeneration: number | null,
  fallback: GrowthReport,
): GrowthReport {
  const start = stabilizationGeneration ?? 0;
  const n = pops.length - start;
  if (n < MIN_SAMPLES) return fallback;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i;
    ys[i] = pops[start + i]!;
  }
  return classifyPopulation(xs, ys, n);
}

function captureThumbnail(sim: Simulation): Uint8Array {
  const pixels = new Uint8Array(BENCH_THUMB * BENCH_THUMB);
  for (let y = 0; y < BENCH_THUMB; y++) {
    for (let x = 0; x < BENCH_THUMB; x++) {
      if (sim.get(x, y) !== DEAD) pixels[y * BENCH_THUMB + x] = 1;
    }
  }
  return pixels;
}

export function runBenchCase(
  ruleset: RuleSet,
  spec: BenchCaseSpec,
  opts: RunBatteryOptions = {},
): BenchCaseResult {
  const maxGens = opts.maxGens ?? BENCH_MAX_GENS;
  const sim = new Simulation({
    ruleset: arenaRuleset(ruleset),
    width: BENCH_WORLD,
    height: BENCH_WORLD,
    seed: spec.seed,
    history: { keyframeInterval: 16, byteCeiling: 8 * 1024 * 1024 },
  });
  seedCase(sim, spec, liveState(ruleset));

  const collector = new StatsCollector();
  collector.reset(sim.view(), sim.tick);
  collector.observeCycle((t) => sim.materialize(t));

  const pops: number[] = [collector.snapshot.population];
  let lastPop = pops[0]!;
  let lastChangedTick = 0;
  let extinctAt: number | null = lastPop === 0 ? 0 : null;
  let cycleKind: BenchCycleKind | null = null;
  let period: number | null = null;
  let cyclePrevious: number | null = null;

  for (let i = 0; i < maxGens; i++) {
    if (opts.shouldCancel?.()) throw new BenchCancelledError();
    const cs = sim.step();
    collector.apply(cs, sim.view());
    const found = collector.observeCycle((t) => sim.materialize(t));
    const snap = collector.snapshot;
    pops.push(snap.population);
    if (snap.activity > 0 || snap.population !== lastPop) {
      lastChangedTick = sim.tick;
      lastPop = snap.population;
    }
    if (snap.population === 0 && extinctAt === null) extinctAt = sim.tick;
    if (found && cycleKind === null) {
      cycleKind = found.kind;
      period = found.period;
      cyclePrevious = found.previousTick;
    }
    const settled =
      extinctAt !== null ||
      cycleKind !== null ||
      (sim.tick - lastChangedTick >= BENCH_STABLE_WINDOW && snap.activity === 0);
    const stabAt =
      extinctAt !== null ? extinctAt : cyclePrevious !== null ? cyclePrevious : settled ? lastChangedTick : null;
    const tail = stabAt !== null ? pops.length - stabAt : 0;
    if (settled && tail >= MIN_SAMPLES) break;
  }

  let stabilizationGeneration: number | null;
  let reportedPeriod = period;
  let reportedCycle = cycleKind;
  if (extinctAt !== null) {
    stabilizationGeneration = extinctAt;
    reportedPeriod = null;
    reportedCycle = null;
  } else if (cyclePrevious !== null) {
    stabilizationGeneration = cyclePrevious;
  } else if (sim.tick - lastChangedTick >= BENCH_STABLE_WINDOW) {
    stabilizationGeneration = lastChangedTick;
    reportedPeriod = 1;
  } else {
    stabilizationGeneration = null;
  }

  const growth = classifyBenchGrowth(pops, stabilizationGeneration, collector.classifyGrowth());

  const thumbnail = captureThumbnail(sim);
  return {
    id: spec.id,
    label: spec.label,
    stabilizationGeneration,
    finalPopulation: collector.snapshot.population,
    growthKind: growth.kind,
    growthLabel: describeGrowth(growth),
    period: reportedPeriod,
    cycleKind: reportedCycle,
    thumbnail,
    thumbnailDigest: thumbnailDigest(thumbnail),
  };
}

export function runBattery(ruleset: RuleSet, opts: RunBatteryOptions = {}): BenchReport {
  const cases: BenchCaseResult[] = [];
  for (const spec of BENCH_CASES) {
    if (opts.shouldCancel?.()) throw new BenchCancelledError();
    const result = runBenchCase(ruleset, spec, opts);
    cases.push(result);
    opts.onCase?.(result);
  }
  return { cases };
}
