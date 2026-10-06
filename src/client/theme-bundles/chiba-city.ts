/** P3-E-7 — the chiba-city theme bundle: one lazily loaded chunk (see `../theme-bundles.ts`). */
import { createChibaCityPassStack } from '@render/effects/library';
import { CHIBA_CITY_THEME } from '@themes/chiba-city/theme';
import type { ThemeBundle } from '../theme-bundles';

export const bundle: ThemeBundle = {
  theme: CHIBA_CITY_THEME,
  createPasses: createChibaCityPassStack,
  background: 'parallax',
  ageBuffer: true,
};
