/**
 * Chiba-City (P3-C-2): retro cyberpunk. Near-black, neon cyan, scanlines, bloom
 * on live cells, edge chromatic aberration, film grain. Cost medium — quality 0
 * is palette-only, not lossless.
 */
import type { ThemeModule } from '@themes/types';
import { makeChibaPalette } from './palette';
import { chibaMotionSignature } from './motion';
import { CHIBA_QUALITY } from './quality';
import { CHIBA_SOUND_PACK } from './sound';
import { CHIBA_CITY_TOKENS } from './tokens';

const MOTION = chibaMotionSignature();

export const CHIBA_CITY_THEME: ThemeModule = {
  id: 'chiba-city',
  name: 'Chiba-City',
  tokens: CHIBA_CITY_TOKENS,
  palette: makeChibaPalette(CHIBA_CITY_TOKENS.color.bg),
  motion: MOTION,
  sound: CHIBA_SOUND_PACK,
  cost: 'medium',
  quality: CHIBA_QUALITY,
};
