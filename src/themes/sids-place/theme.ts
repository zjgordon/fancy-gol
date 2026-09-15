/**
 * Sids-Place (P3-C-4): Civ-I campaign map. Ink on parchment, hand-inked tiles,
 * weighty motion. Cost medium — quality 0 is palette-only, not lossless.
 * Dead cells are transparent so the baked parchment on L0 shows through.
 */
import type { ThemeModule } from '@themes/types';
import { makeSidsPalette } from './palette';
import { sidsMotionSignature } from './motion';
import { SIDS_QUALITY } from './quality';
import { SIDS_SOUND_PACK } from './sound';
import { sidsTileShape } from './tiles';
import { SIDS_PLACE_TOKENS } from './tokens';

const MOTION = sidsMotionSignature();

export const SIDS_PLACE_THEME: ThemeModule = {
  id: 'sids-place',
  name: "Sid's Place",
  tokens: SIDS_PLACE_TOKENS,
  palette: makeSidsPalette(SIDS_PLACE_TOKENS.color.bg),
  motion: MOTION,
  sound: SIDS_SOUND_PACK,
  cost: 'medium',
  quality: SIDS_QUALITY,
  cellLayerBackground: 'rgba(0, 0, 0, 0)',
  tileShape: sidsTileShape,
};
