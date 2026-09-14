/**
 * Deliberately missing `class` — proves `scripts/bench.mjs` refuses to load a case that
 * doesn't declare one (P2-F-1: "no measure-only orphans" is enforced at load time).
 */
export const cases = [
  {
    id: 'no-class',
    name: 'missing class field (fixture)',
    unit: 'ms',
    higherIsBetter: false,
    warmup: 0,
    run: () => 1,
  },
];
