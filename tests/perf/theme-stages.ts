/**
 * P3-E-1 — which effect stages each theme enables, for the browser specs.
 *
 * Deliberately a literal table with no imports: the Playwright runner does not resolve the app's
 * path aliases, and importing the real pass stacks would drag canvas code into the test runner.
 * `tests/unit/perf/theme-stages.spec.ts` asserts this table equals the stages of the real
 * `createThemePassStack(theme)`, so it cannot silently drift from the themes.
 */
export type EffectStageName = 'background' | 'effects' | 'post';

export const THEME_STAGES: Readonly<Record<string, readonly EffectStageName[]>> = {
  default: [],
  'chiba-city': ['background', 'effects', 'post'],
  flatline: ['background', 'effects', 'post'],
  'sids-place': ['background'],
  'void-walker': ['background', 'effects', 'post'],
  synthwave: ['background', 'effects', 'post'],
};

/** Quality level at which a stage first becomes active (`stagesForQuality`, ctx.ts). */
export const STAGE_QUALITY: Readonly<Record<EffectStageName, 1 | 2 | 3>> = {
  background: 1,
  effects: 2,
  post: 3,
};
