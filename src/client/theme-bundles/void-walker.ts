/** P3-E-7 — the void-walker theme bundle: one lazily loaded chunk (see `../theme-bundles.ts`). */
import { createVoidWalkerPassStack } from '@render/effects/library';
import { VOID_WALKER_THEME } from '@themes/void-walker/theme';
import type { ThemeBundle } from '../theme-bundles';

export const bundle: ThemeBundle = {
  theme: VOID_WALKER_THEME,
  createPasses: createVoidWalkerPassStack,
  background: 'parallax',
  ageBuffer: true,
};
