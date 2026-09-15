/**
 * Sids-Place quality ladder (P3-C-4). Quality 0 is palette-only (not lossless —
 * the parchment *is* the theme). The governor drops background last, so the
 * baked texture is the last thing to go.
 */
import type { ThemeQualitySpec } from '@themes/types';

export type SidsQualityLevel = 0 | 1 | 2 | 3;

export interface SidsQualityLevelSpec {
  readonly passes: readonly string[];
  readonly note: string;
}

export const SIDS_QUALITY_LEVELS: Readonly<Record<SidsQualityLevel, SidsQualityLevelSpec>> = {
  0: { passes: [], note: 'tokens + palette' },
  1: { passes: ['parchmentTexture'], note: 'baked parchment' },
  2: { passes: ['parchmentTexture'], note: 'baked parchment' },
  3: { passes: ['parchmentTexture'], note: 'baked parchment (generated once at activation)' },
};

export const SIDS_QUALITY: ThemeQualitySpec = {
  max: 3,
  losslessAtQuality0: false,
};
