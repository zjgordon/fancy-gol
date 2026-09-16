/**
 * Synthwave (P3-C-6): 1984's future. Magenta→cyan sky, perspective floor grid,
 * neon cells with chromatic edges. Cost high — quality 0 is palette-only.
 * Dead cells are transparent so the L0 sun/sky shows through.
 */
import type { ThemeModule } from '@themes/types';
import { makeSynthPalette } from './palette';
import { synthMotionSignature } from './motion';
import { SYNTH_QUALITY } from './quality';
import { SYNTHWAVE_SOUND_PACK } from './sound';
import { SYNTHWAVE_TOKENS } from './tokens';

const MOTION = synthMotionSignature();

export const SYNTHWAVE_THEME: ThemeModule = {
  id: 'synthwave',
  name: 'Synthwave',
  tokens: SYNTHWAVE_TOKENS,
  palette: makeSynthPalette('rgba(0, 0, 0, 0)'),
  motion: MOTION,
  sound: SYNTHWAVE_SOUND_PACK,
  cost: 'high',
  quality: SYNTH_QUALITY,
  cellLayerBackground: 'rgba(0, 0, 0, 0)',
};
