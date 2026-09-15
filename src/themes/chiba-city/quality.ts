/**
 * Chiba-City quality ladder (P3-C-2). Quality 0 is palette-only (not lossless —
 * the haze, bloom and scanlines are the theme). Governor drops post → effects →
 * background.
 */
import type { ThemeQualitySpec } from '@themes/types';

export type ChibaQualityLevel = 0 | 1 | 2 | 3;

export interface ChibaQualityLevelSpec {
  readonly passes: readonly string[];
  readonly note: string;
}

export const CHIBA_QUALITY_LEVELS: Readonly<Record<ChibaQualityLevel, ChibaQualityLevelSpec>> = {
  0: { passes: [], note: 'tokens + palette' },
  1: { passes: ['hazeGrid'], note: 'cyan haze grid' },
  2: { passes: ['hazeGrid', 'birthFlash'], note: 'haze + birth flashes' },
  3: {
    passes: ['hazeGrid', 'birthFlash', 'bloom', 'scanlines', 'chromaticAberration', 'filmGrain'],
    note: 'full stack: bloom on live cells, dpr-pitched scanlines, edge aberration, grain',
  },
};

export const CHIBA_QUALITY: ThemeQualitySpec = {
  max: 3,
  losslessAtQuality0: false,
};
