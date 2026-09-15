/**
 * Void-Walker (P3-C-5): deep space. Near-black violet, parallax starfield,
 * strongest bloom, death puffs. Cost high — quality 0 is palette-only, not
 * lossless. Dead cells are transparent so L0 starlight shows through.
 */
import type { ThemeModule } from '@themes/types';
import { makeVoidPalette } from './palette';
import { voidMotionSignature } from './motion';
import { VOID_QUALITY } from './quality';
import { VOID_SOUND_PACK } from './sound';
import { VOID_WALKER_TOKENS } from './tokens';

const MOTION = voidMotionSignature();

export const VOID_WALKER_THEME: ThemeModule = {
  id: 'void-walker',
  name: 'Void-Walker',
  tokens: VOID_WALKER_TOKENS,
  palette: makeVoidPalette('rgba(0, 0, 0, 0)'),
  motion: MOTION,
  sound: VOID_SOUND_PACK,
  cost: 'high',
  quality: VOID_QUALITY,
  cellLayerBackground: 'rgba(0, 0, 0, 0)',
};
