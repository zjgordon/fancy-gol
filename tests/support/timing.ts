/**
 * P3-E-8 — calibrated wall-clock budgets for unit tests.
 *
 * A budget such as "six charts cost < 2 ms" is a claim about *this* code on *the machine it was
 * set on*. CI runners are 2–3× slower and noisier, and `npm run coverage` instruments `src/` on
 * top, so an absolute millisecond assertion measures the runner rather than the product — it
 * failed at 8.7–9.8 ms against a 3 ms budget on every CI run since P3-D-1. This is the same
 * problem `planning/README.md` §3.6 solves for the bench harness, solved the same way: gate on a
 * ratio to a same-process calibration workload, never on raw milliseconds.
 *
 * `calibratedBudget(base)` = `base × max(1, speedFactor())`. On a machine as fast as the one the
 * budget was set on the factor is 1, so the budget is **exactly** the number in the test: nothing
 * is loosened where it was meant to bite. On a slower runner it scales with the runner.
 *
 * Two rules for anything that uses this:
 *  - Name the test with `[timing]` and declare it with {@link timingIt}. It is skipped under
 *    `npm run coverage` (V8 instrumentation inflates `src/` 2–10×, which no calibration of
 *    test-side code can cancel) and run uncovered by `npm run test:timing`, a CI step.
 *  - The *behavioural* half of a check (it stops, it is bounded, it is finite) stays in a plain
 *    `it`, which runs everywhere, including under coverage.
 */
import { it } from 'vitest';

export const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

/**
 * Median ms the {@link workload} takes on the machine the budgets were set on (2026-10-06,
 * Linux 6.8 sandbox, Node 24). Changing this is a deliberate decision, like re-baselining a bench
 * case: it moves every calibrated budget in the suite.
 */
export const REFERENCE_WORKLOAD_MS = 6.27;

let sink = 0;

/** Pure integer arithmetic, no allocation, no I/O — the same shape as `scripts/bench.mjs`'s calibrator. */
function workload(): void {
  let x = sink;
  for (let i = 0; i < 2_000_000; i++) x = (x + Math.imul(i, 2654435761)) ^ (x >>> 3);
  sink = x | 0;
}

/** How many times slower than the reference machine this process is right now (median of five runs). */
export function speedFactor(): number {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    workload();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[2]! / REFERENCE_WORKLOAD_MS;
}

/** `baseMs` on a reference-speed machine; scaled up, never down, on a slower one. */
export function calibratedBudget(baseMs: number): number {
  return baseMs * Math.max(1, speedFactor());
}

/** An `it` that runs only in the uncovered `[timing]` pass. Put `[timing]` in the name. */
export const timingIt = UNDER_COVERAGE ? it.skip : it;
