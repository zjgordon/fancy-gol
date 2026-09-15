/**
 * Flatline (P3-C-3): retro console. Amber phosphor on black (green/white tubes
 * share this module). Cost medium — quality 0 is palette-only, not lossless.
 */
import type { ThemeModule } from '@themes/types';
import { makeFlatlinePalette } from './palette';
import { flatlineMotionSignature } from './motion';
import { FLATLINE_QUALITY } from './quality';
import { FLATLINE_SOUND_PACK } from './sound';
import { makeFlatlineTokens, type PhosphorKind } from './tokens';

export function makeFlatlineTheme(kind: PhosphorKind = 'amber'): ThemeModule {
  const tokens = makeFlatlineTokens(kind);
  return {
    id: 'flatline',
    name: kind === 'amber' ? 'Flatline' : `Flatline (${kind})`,
    tokens,
    palette: makeFlatlinePalette(tokens.color.bg, kind),
    motion: flatlineMotionSignature(),
    sound: FLATLINE_SOUND_PACK,
    cost: 'medium',
    quality: FLATLINE_QUALITY,
  };
}

/** Amber is the registered theme; green/white are the same place with a different tube. */
export const FLATLINE_THEME: ThemeModule = makeFlatlineTheme('amber');
