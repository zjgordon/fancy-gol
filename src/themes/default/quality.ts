/**
 * Default quality ladder (P3-C-1). No background, effects, or post-process at any level —
 * quality 0 is visually identical to quality 3, which is why this theme is the only one
 * fully itself when the governor has dropped everything.
 */
import type { ThemeQualitySpec } from '@themes/types';

export type DefaultQualityLevel = 0 | 1 | 2 | 3;

export interface DefaultQualityLevelSpec {
  readonly passes: readonly string[];
  readonly note: string;
}

export const DEFAULT_QUALITY_LEVELS: Readonly<Record<DefaultQualityLevel, DefaultQualityLevelSpec>> = {
  0: { passes: [], note: 'tokens + palette' },
  1: { passes: [], note: 'tokens + palette (no background pass)' },
  2: { passes: [], note: 'tokens + palette (no effects)' },
  3: { passes: [], note: 'tokens + palette (no post-process)' },
};

export const DEFAULT_QUALITY: ThemeQualitySpec = {
  max: 3,
  losslessAtQuality0: true,
};
