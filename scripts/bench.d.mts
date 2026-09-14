// Hand-written type declarations for bench.mjs so tests/unit/bench-runner.spec.ts
// can typecheck it. The script itself stays plain JS — it must run with a bare
// `node --import tsx`, no build step (P0-I-4).
import type { BenchClass } from '../tests/bench/types.ts';

export declare const DEFAULT_N: number;
export declare const DEFAULT_DIR: string;
export declare const DEFAULT_BASELINE: string;
export declare const DETERMINISTIC_TOLERANCE: number;
export declare const WALL_CLOCK_TOLERANCE: number;
export declare const WALL_CLOCK_MAX_TOLERANCE: number;
export declare const CALIBRATION_ITERATIONS: number;

export declare function median(xs: readonly number[]): number;
export declare function applySlowdown(
  value: number,
  factor: number,
  higherIsBetter: boolean,
): number;
export declare function runCalibrationWorkload(iterations?: number): number;
export declare function measureCalibrationMs(n?: number, iterations?: number): number;
export declare function wallClockRatio(
  value: number,
  calibrationMs: number,
  higherIsBetter: boolean,
): number;
export declare function wallClockTolerance(spread: number): number;
export declare function evaluateCase(opts: {
  value: number;
  baseline?: number | null;
  budget?: number | null;
  higherIsBetter: boolean;
  cls?: BenchClass;
  tolerance?: number;
  ratio?: number | null;
  baselineRatio?: number | null;
}): { budgetFail: boolean; regressionFail: boolean; regression: number };
export declare function parseArgs(argv: string[]): {
  updateBaseline: boolean;
  injectSlowdown: number;
  dir: string;
  baseline: string;
  filter: string | null;
  n: number;
  help?: boolean;
};
export declare function formatNumber(n: number, unit?: string): string;
