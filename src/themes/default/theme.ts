/**
 * The Default theme (P3-C-1): restrained and excellent. Light and dark variants, crisp
 * motion, UI-click sound pack, no render hooks, no post-processing, `cost: 'low'`.
 * Quality 0 is lossless because there is nothing to drop.
 */
import type { AdaptiveThemeModule } from '@themes/registry';
import type { ThemeModule } from '@themes/types';
import { defaultMotionSignature } from '@themes/motion/choreography';
import { DEFAULT_QUALITY } from './quality';
import { DARK_AGE_TABLE, LIGHT_AGE_TABLE, makeDefaultPalette } from './palette';
import { DEFAULT_SOUND_PACK } from './sound';
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from './tokens';

const DEFAULT_MOTION = defaultMotionSignature();

export const DEFAULT_DARK_THEME: ThemeModule = {
  id: 'default-dark',
  name: 'Default (dark)',
  tokens: DEFAULT_DARK_TOKENS,
  palette: makeDefaultPalette(DARK_AGE_TABLE, DEFAULT_DARK_TOKENS.color.bg),
  motion: DEFAULT_MOTION,
  sound: DEFAULT_SOUND_PACK,
  cost: 'low',
  quality: DEFAULT_QUALITY,
};

export const DEFAULT_LIGHT_THEME: ThemeModule = {
  id: 'default-light',
  name: 'Default (light)',
  tokens: DEFAULT_LIGHT_TOKENS,
  palette: makeDefaultPalette(LIGHT_AGE_TABLE, DEFAULT_LIGHT_TOKENS.color.bg),
  motion: DEFAULT_MOTION,
  sound: DEFAULT_SOUND_PACK,
  cost: 'low',
  quality: DEFAULT_QUALITY,
};

/** The id a theme picker actually lists and selects — `themes/registry.ts`'s
 * `AdaptiveThemeModule`, resolved to whichever of the two modules above matches
 * `prefers-color-scheme` at activation time. */
export const DEFAULT_THEME: AdaptiveThemeModule = {
  kind: 'adaptive',
  id: 'default',
  name: 'Default',
  light: DEFAULT_LIGHT_THEME,
  dark: DEFAULT_DARK_THEME,
};
