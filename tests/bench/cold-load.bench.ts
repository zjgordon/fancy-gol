import type { BenchCase } from './types.ts';

/**
 * Cold interactive load is a *browser* number. Re-timing it in Node would be a
 * lie. P0-I-1 measured `window.__fancyGolFirstFrameMs` ≈ 38 ms against Vite;
 * P0-I-3's production image measured ≈ 48.6 ms. This case reports the more
 * conservative recorded figure so the §3.6 row lives in the baseline, labelled
 * as recorded rather than re-timed.
 */
const RECORDED_COLD_LOAD_MS = 48.6;

export const cases: BenchCase[] = [
  {
    id: 'cold-load-recorded',
    name: 'cold interactive load (recorded P0-I-1/P0-I-3 Playwright, not re-timed)',
    unit: 'ms',
    budget: 1500,
    higherIsBetter: false,
    warmup: 0,
    run: () => RECORDED_COLD_LOAD_MS,
  },
];
