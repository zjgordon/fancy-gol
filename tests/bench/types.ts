/**
 * One case the P0-I-4 runner (`scripts/bench.mjs`) will load from `tests/bench/*.bench.ts`.
 * `run` does the work and returns the metric — the runner takes the median of N calls.
 *
 * Every case declares a `class` (P2-F-1, `planning/README.md` §3.6). There is no per-case
 * opt-out from a regression gate — each class inherits its own honest policy instead:
 *
 *   - `deterministic`  tight ≤3% regression against the committed baseline. No noise excuse.
 *   - `wall-clock`     gated on `median / calibration`, not raw milliseconds, so the gate
 *                      survives a slower or noisier runner. Raw ms still prints for humans.
 *                      Same-process ratios set `selfCalibrated` and skip the calibrator.
 *   - `browser`        absolute budget only in this task (gate-history lands in P2-F-3).
 */
export type BenchClass = 'deterministic' | 'wall-clock' | 'browser';

export interface BenchCase {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  /** Absolute Phase 0 floor. Optional — `deterministic`/`wall-clock` cases may rely on their class gate alone. Required for `browser` (its only gate). */
  readonly budget?: number;
  readonly higherIsBetter: boolean;
  readonly class: BenchClass;
  /**
   * Wall-clock only. True when `run()` already returns a same-process ratio (overhead %,
   * large/small cost). The synthetic calibration workload must not divide that figure —
   * the machine already cancelled in the measurement.
   */
  readonly selfCalibrated?: boolean;
  /** True when the value is transcribed from an external measurement (e.g. a Playwright run), not re-timed by this process. Surfaced in the runner's table, not just the case name. */
  readonly transcribed?: boolean;
  /** Extra unrecorded `run()` calls after `setup`, before the N measured trials. */
  readonly warmup?: number;
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
  run: () => number | Promise<number>;
}
