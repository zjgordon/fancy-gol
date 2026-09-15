/**
 * Flatline quality ladder (P3-C-3). Quality 0 is palette-only (not lossless —
 * the phosphor ghosts, rain and CRT *are* the theme). CRT is a post pass, so
 * the governor already drops it at quality ≤ 2; the pass itself also no-ops
 * at quality ≤ 1 if invoked.
 */
import type { ThemeQualitySpec } from '@themes/types';

export type FlatlineQualityLevel = 0 | 1 | 2 | 3;

export interface FlatlineQualityLevelSpec {
  readonly passes: readonly string[];
  readonly note: string;
}

export const FLATLINE_QUALITY_LEVELS: Readonly<Record<FlatlineQualityLevel, FlatlineQualityLevelSpec>> =
  {
    0: { passes: [], note: 'tokens + palette' },
    1: { passes: ['textRain'], note: 'falling glyphs at very low opacity' },
    2: { passes: ['textRain', 'phosphorDecay'], note: 'rain + phosphor ghosts' },
    3: {
      passes: ['textRain', 'phosphorDecay', 'scanlines', 'crtCurvature'],
      note: 'full stack: rain, ghosts, scanlines, subtle CRT (off at quality ≤ 1)',
    },
  };

export const FLATLINE_QUALITY: ThemeQualitySpec = {
  max: 3,
  losslessAtQuality0: false,
};
