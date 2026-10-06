/** P3-E-7 — the sids-place theme bundle: one lazily loaded chunk (see `../theme-bundles.ts`). */
import { createSidsPlacePassStack } from '@render/effects/library';
import { SIDS_PLACE_THEME } from '@themes/sids-place/theme';
import type { ThemeBundle } from '../theme-bundles';

export const bundle: ThemeBundle = {
  theme: SIDS_PLACE_THEME,
  createPasses: createSidsPlacePassStack,
  background: 'static',
  ageBuffer: true,
};
