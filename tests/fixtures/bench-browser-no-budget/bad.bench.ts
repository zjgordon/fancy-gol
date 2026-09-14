/**
 * `browser` class with no `budget` — its only gate — proves `scripts/bench.mjs` refuses to
 * load a case that would otherwise measure nothing (P2-F-1).
 */
export const cases = [
  {
    id: 'browser-no-budget',
    name: 'browser class, no budget (fixture)',
    unit: 'ms',
    higherIsBetter: false,
    class: 'browser',
    warmup: 0,
    run: () => 1,
  },
];
