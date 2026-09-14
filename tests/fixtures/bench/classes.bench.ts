import { CALIBRATION_ITERATIONS, runCalibrationWorkload } from '../../../scripts/bench.mjs';
import type { BenchCase } from '../../bench/types.ts';

/**
 * One case per non-deterministic §3.6 class (`trivial.bench.ts` already covers
 * `deterministic`) so `bench-runner.spec.ts` can exercise the P2-F-1 runner end to end.
 *
 * `fixture-wall-clock` times a quarter of the real calibration workload rather than
 * returning a hand-picked constant — its natural ratio to calibration is then roughly
 * portable across machines, exactly the property the ratio gate is meant to have, so the
 * committed fixture baseline isn't secretly machine-bound the way a bare constant would be.
 */
const WALL_CLOCK_ITERATIONS = Math.round(CALIBRATION_ITERATIONS / 4);

export const cases: BenchCase[] = [
  {
    id: 'fixture-wall-clock',
    name: 'wall-clock fixture (quarter of the calibration workload, ratio-gated)',
    unit: 'ms',
    higherIsBetter: false,
    class: 'wall-clock',
    warmup: 1,
    run: () => {
      const t0 = performance.now();
      runCalibrationWorkload(WALL_CLOCK_ITERATIONS);
      return performance.now() - t0;
    },
  },
  {
    id: 'fixture-browser',
    name: 'browser fixture (absolute budget only, no regression gate)',
    unit: 'ms',
    budget: 20,
    higherIsBetter: false,
    class: 'browser',
    warmup: 0,
    run: () => 12,
  },
];
