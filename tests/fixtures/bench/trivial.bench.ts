import type { BenchCase } from '../../bench/types.ts';

/** Constant-time fixture so the gate itself can be tested without a 512² soup. */
export const cases: BenchCase[] = [
  {
    id: 'trivial-ms',
    name: 'constant 100 ms (fixture)',
    unit: 'ms',
    budget: 200,
    higherIsBetter: false,
    class: 'deterministic',
    warmup: 0,
    run: () => 100,
  },
];
