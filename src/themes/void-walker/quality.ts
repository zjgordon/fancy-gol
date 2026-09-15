/**
 * Void-Walker quality ladder (P3-C-5). Quality 0 is palette-only (not lossless —
 * the starfield, bloom and particles *are* the theme). Governor drops post →
 * effects → background.
 */
import type { ThemeQualitySpec } from '@themes/types';

export type VoidQualityLevel = 0 | 1 | 2 | 3;

export interface VoidQualityLevelSpec {
  readonly passes: readonly string[];
  readonly note: string;
}

export const VOID_QUALITY_LEVELS: Readonly<Record<VoidQualityLevel, VoidQualityLevelSpec>> = {
  0: { passes: [], note: 'tokens + palette' },
  1: { passes: ['starfield'], note: 'three-layer parallax starfield' },
  2: { passes: ['starfield', 'deathParticles', 'trailFade'], note: 'stars + death puffs + glow trails' },
  3: {
    passes: ['starfield', 'deathParticles', 'trailFade', 'bloom', 'vignette'],
    note: 'full stack: strongest bloom, vignette, pooled particles',
  },
};

export const VOID_QUALITY: ThemeQualitySpec = {
  max: 3,
  losslessAtQuality0: false,
};
