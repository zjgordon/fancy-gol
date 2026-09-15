/**
 * The Default theme (P1-E-3 / P3-A-6): restrained motion — real easing curves, default
 * enter/exit/emphasis choreographies. No render hooks, no post-processing, `cost: 'low'`.
 */
import type { AdaptiveThemeModule } from '@themes/registry';
import type { ThemeModule } from '@themes/types';
import { defaultMotionSignature } from '@themes/motion/choreography';
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from './tokens';
import { DARK_STATE_RAMP, LIGHT_STATE_RAMP, makeDefaultPalette } from './palette';

const DEFAULT_MOTION = defaultMotionSignature();

export const DEFAULT_DARK_THEME: ThemeModule = {
  id: 'default-dark',
  name: 'Default (dark)',
  tokens: DEFAULT_DARK_TOKENS,
  palette: makeDefaultPalette(DARK_STATE_RAMP, DEFAULT_DARK_TOKENS.color.bg),
  motion: DEFAULT_MOTION,
  cost: 'low',
};

export const DEFAULT_LIGHT_THEME: ThemeModule = {
  id: 'default-light',
  name: 'Default (light)',
  tokens: DEFAULT_LIGHT_TOKENS,
  palette: makeDefaultPalette(LIGHT_STATE_RAMP, DEFAULT_LIGHT_TOKENS.color.bg),
  motion: DEFAULT_MOTION,
  cost: 'low',
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
