/**
 * Rule test-bench wire types (P2-E-3). Shared so `engine/`, `worker/`, and
 * `ui/` agree on the card payload without `ui/` importing the engine.
 *
 * Eight fixed seeds on a 32×32 toroidal arena. Seeds are part of the contract:
 * Conway's committed reference report is a regression guard on this list.
 */
export const BENCH_WORLD = 32;
export const BENCH_MAX_GENS = 256;
export const BENCH_THUMB = 32;
export const BENCH_SOUP8 = 8;
/** Gens of zero activity before a field is called a still life (not a cycle). */
export const BENCH_STABLE_WINDOW = 8;

export const BENCH_CASE_IDS = [
  'soup-10',
  'soup-20',
  'soup-30',
  'soup-40',
  'soup-50',
  'single',
  'block',
  'soup-8x8',
] as const;

export type BenchCaseId = (typeof BENCH_CASE_IDS)[number];

export type BenchGrowthKind =
  | 'insufficient-data'
  | 'constant'
  | 'linear'
  | 'quadratic'
  | 'exponential'
  | 'chaotic';

export type BenchCycleKind = 'oscillator' | 'spaceship' | 'windowed';

export type BenchCaseKind = 'soup' | 'single' | 'block' | 'soup8';

export interface BenchCaseSpec {
  readonly id: BenchCaseId;
  readonly label: string;
  readonly kind: BenchCaseKind;
  readonly seed: number;
  readonly density?: number;
}

export const BENCH_CASES: readonly BenchCaseSpec[] = [
  { id: 'soup-10', label: 'Soup 10%', kind: 'soup', seed: 0x51a10010, density: 0.1 },
  { id: 'soup-20', label: 'Soup 20%', kind: 'soup', seed: 0x51a10020, density: 0.2 },
  { id: 'soup-30', label: 'Soup 30%', kind: 'soup', seed: 0x51a10030, density: 0.3 },
  { id: 'soup-40', label: 'Soup 40%', kind: 'soup', seed: 0x51a10040, density: 0.4 },
  { id: 'soup-50', label: 'Soup 50%', kind: 'soup', seed: 0x51a10050, density: 0.5 },
  { id: 'single', label: 'Single cell', kind: 'single', seed: 0 },
  { id: 'block', label: 'Block', kind: 'block', seed: 0 },
  { id: 'soup-8x8', label: 'Random 8×8', kind: 'soup8', seed: 0x51a10088, density: 0.5 },
];

export interface BenchCaseResult {
  readonly id: BenchCaseId;
  readonly label: string;
  /** First generation of the attractor, or `null` if still evolving at the cap. */
  readonly stabilizationGeneration: number | null;
  readonly finalPopulation: number;
  readonly growthKind: BenchGrowthKind;
  /** `describeGrowth` — abstentions and bands are already labelled. */
  readonly growthLabel: string;
  readonly period: number | null;
  readonly cycleKind: BenchCycleKind | null;
  /** `BENCH_THUMB`² occupancy (1 = live). */
  readonly thumbnail: Uint8Array;
  readonly thumbnailDigest: string;
}

export interface BenchReport {
  readonly cases: readonly BenchCaseResult[];
}

/** Fixture shape — no pixel buffers, only the digest that guards them. */
export interface BenchReferenceCase {
  readonly id: BenchCaseId;
  readonly stabilizationGeneration: number | null;
  readonly finalPopulation: number;
  readonly growthKind: BenchGrowthKind;
  readonly period: number | null;
  readonly thumbnailDigest: string;
}

export type BenchCommand = { readonly cmd: 'run'; readonly ruleset: unknown } | { readonly cmd: 'cancel' };

export type BenchEvent =
  | { readonly type: 'case'; readonly result: BenchCaseResult }
  | { readonly type: 'done'; readonly report: BenchReport }
  | { readonly type: 'cancelled' }
  | { readonly type: 'error'; readonly message: string };

export function referenceFromReport(report: BenchReport): BenchReferenceCase[] {
  return report.cases.map((c) => ({
    id: c.id,
    stabilizationGeneration: c.stabilizationGeneration,
    finalPopulation: c.finalPopulation,
    growthKind: c.growthKind,
    period: c.period,
    thumbnailDigest: c.thumbnailDigest,
  }));
}

/** FNV-1a of the occupancy bytes — stable across machines, not a pixel snapshot. */
export function thumbnailDigest(pixels: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i++) {
    h ^= pixels[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
