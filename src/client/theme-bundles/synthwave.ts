/** P3-E-7 — the synthwave theme bundle: one lazily loaded chunk (see `../theme-bundles.ts`). */
import { createSynthwavePassStack } from '@render/effects/library';
import { SYNTHWAVE_THEME } from '@themes/synthwave/theme';
import type { ThemeBundle } from '../theme-bundles';

export const bundle: ThemeBundle = {
  theme: SYNTHWAVE_THEME,
  createPasses: createSynthwavePassStack,
  background: 'parallax',
  ageBuffer: true,
};
