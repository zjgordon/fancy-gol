/**
 * P3-A-5 — effect library catalogue.
 *
 * Each factory is parameterised and tagged with the theme(s) that will consume it in Workstream C.
 * Themes are not shipped yet; the mapping documents the ≥1-theme contract and powers the
 * "most expensive theme" frame-budget check.
 */
import {
  createParchmentTexturePass,
  createStarfieldPass,
  createSunGradientPass,
  createTextRainPass,
} from './background-passes';
import {
  createBirthFlashPass,
  createDeathParticlesPass,
  createGridGlowPass,
  createHueShiftByAgePass,
  createPhosphorDecayPass,
  createTrailFadePass,
} from './effects-passes';
import { stagesForQuality, type EffectQuality } from './ctx';
import type { EffectPass } from './pass';
import {
  createBloomPass,
  createChromaticAberrationPass,
  createCrtCurvaturePass,
  createFilmGrainPass,
  createScanlinesPass,
  createVignettePass,
} from './post-passes';

export {
  createBloomPass,
  createScanlinesPass,
  createChromaticAberrationPass,
  createVignettePass,
  createFilmGrainPass,
  createCrtCurvaturePass,
} from './post-passes';

export {
  createStarfieldPass,
  createParchmentTexturePass,
  createSunGradientPass,
  createTextRainPass,
} from './background-passes';

export {
  createPhosphorDecayPass,
  createGridGlowPass,
  createBirthFlashPass,
  createDeathParticlesPass,
  createTrailFadePass,
  createHueShiftByAgePass,
} from './effects-passes';

export type ThemeId =
  | 'default'
  | 'chiba-city'
  | 'flatline'
  | 'sids-place'
  | 'void-walker'
  | 'synthwave';

export interface LibraryEntry {
  readonly id: string;
  readonly themes: readonly ThemeId[];
  readonly create: () => EffectPass;
}

/** All reusable passes — one entry each. */
export const EFFECT_LIBRARY: readonly LibraryEntry[] = [
  { id: 'bloom', themes: ['chiba-city', 'void-walker', 'synthwave'], create: () => createBloomPass() },
  { id: 'scanlines', themes: ['chiba-city', 'flatline', 'synthwave'], create: () => createScanlinesPass() },
  {
    id: 'chromaticAberration',
    themes: ['chiba-city', 'synthwave'],
    create: () => createChromaticAberrationPass(),
  },
  { id: 'vignette', themes: ['void-walker'], create: () => createVignettePass() },
  { id: 'filmGrain', themes: ['chiba-city'], create: () => createFilmGrainPass({ seed: 1 }) },
  { id: 'crtCurvature', themes: ['flatline'], create: () => createCrtCurvaturePass() },
  { id: 'phosphorDecay', themes: ['flatline'], create: () => createPhosphorDecayPass() },
  { id: 'starfield', themes: ['void-walker'], create: () => createStarfieldPass({ seed: 42 }) },
  {
    id: 'parchmentTexture',
    themes: ['sids-place'],
    create: () => createParchmentTexturePass({ seed: 7 }),
  },
  { id: 'gridGlow', themes: ['synthwave'], create: () => createGridGlowPass() },
  { id: 'birthFlash', themes: ['chiba-city'], create: () => createBirthFlashPass() },
  { id: 'deathParticles', themes: ['void-walker'], create: () => createDeathParticlesPass({ seed: 9 }) },
  { id: 'trailFade', themes: ['void-walker'], create: () => createTrailFadePass() },
  { id: 'hueShiftByAge', themes: ['synthwave'], create: () => createHueShiftByAgePass() },
  { id: 'sunGradient', themes: ['synthwave'], create: () => createSunGradientPass() },
  { id: 'textRain', themes: ['flatline'], create: () => createTextRainPass({ seed: 3 }) },
];

export const THEME_IDS: readonly ThemeId[] = [
  'default',
  'chiba-city',
  'flatline',
  'sids-place',
  'void-walker',
  'synthwave',
];

/** Build the pass stack a theme will use (default costs; themes may parameterise further). */
export function createThemePassStack(theme: ThemeId): EffectPass[] {
  return EFFECT_LIBRARY.filter((e) => e.themes.includes(theme)).map((e) => e.create());
}

/** Declared-cost sum of passes still running at this quality. Disposes the stack. */
export function declaredCostAtQuality(theme: ThemeId, quality: EffectQuality): number {
  const active = new Set(stagesForQuality(quality));
  const stack = createThemePassStack(theme);
  let cost = 0;
  for (const pass of stack) {
    if (active.has(pass.stage)) cost += pass.cost;
  }
  for (const pass of stack) pass.dispose();
  return cost;
}

/**
 * Declared-cost sum for the heaviest theme stack at quality 3.
 * Synthwave currently leads (sun + grid + bloom + aberration + scanlines + hue).
 */
export function mostExpensiveThemeDeclaredCostMs(): { theme: ThemeId; costMs: number } {
  let best: { theme: ThemeId; costMs: number } = { theme: 'default', costMs: 0 };
  for (const theme of THEME_IDS) {
    const costMs = declaredCostAtQuality(theme, 3);
    if (costMs > best.costMs) best = { theme, costMs };
  }
  return best;
}

/** 55 fps frame budget (ms) — P3 quality gate for quality 3. */
export const QUALITY3_FRAME_BUDGET_MS = 1000 / 55;
