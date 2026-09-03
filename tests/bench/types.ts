/**
 * One case the P0-I-4 runner (`scripts/bench.mjs`) will load from `tests/bench/*.bench.ts`.
 * `run` does the work and returns the metric — the runner takes the median of N calls.
 */
export interface BenchCase {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  /** Absolute Phase 0 floor. Omitted for recorded-only cases (no §3.6 budget). */
  readonly budget?: number;
  readonly higherIsBetter: boolean;
  /** Extra unrecorded `run()` calls after `setup`, before the 7 measured trials. */
  readonly warmup?: number;
  /**
   * When false, the 10% baseline-regression gate is skipped and only the absolute
   * budget applies. Use for ratio metrics and sub-millisecond timers whose 10%
   * band is smaller than measurement noise.
   */
  readonly baselineGate?: boolean;
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
  run: () => number | Promise<number>;
}
