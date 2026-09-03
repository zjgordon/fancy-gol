// Hand-written type declarations for bench.mjs so tests/unit/bench-runner.spec.ts
// can typecheck it. The script itself stays plain JS — it must run with a bare
// `node --import tsx`, no build step (P0-I-4).
export declare const DEFAULT_N: number;
export declare const DEFAULT_TOLERANCE: number;
export declare const DEFAULT_DIR: string;
export declare const DEFAULT_BASELINE: string;

export declare function median(xs: readonly number[]): number;
export declare function applySlowdown(
  value: number,
  factor: number,
  higherIsBetter: boolean,
): number;
export declare function evaluateCase(opts: {
  value: number;
  baseline?: number | null;
  budget?: number | null;
  higherIsBetter: boolean;
  tolerance?: number;
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
