/** P3-E-7 — the flatline theme bundle: one lazily loaded chunk (see `../theme-bundles.ts`). */
import { createFlatlinePassStack } from '@render/effects/library';
import { FLATLINE_THEME } from '@themes/flatline/theme';
import type { ThemeBundle } from '../theme-bundles';

export const bundle: ThemeBundle = {
  theme: FLATLINE_THEME,
  createPasses: createFlatlinePassStack,
  background: 'static',
  ageBuffer: true,
};
