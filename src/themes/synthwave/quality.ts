/**
 * Synthwave quality ladder (P3-C-6). Quality 0 is palette-only (not lossless —
 * the sun, grid and neon stack *are* the theme).
 */
import type { ThemeQualitySpec } from '@themes/types';

export type SynthQualityLevel = 0 | 1 | 2 | 3;

export interface SynthQualityLevelSpec {
  readonly passes: readonly string[];
  readonly note: string;
}

export const SYNTH_QUALITY_LEVELS: Readonly<Record<SynthQualityLevel, SynthQualityLevelSpec>> = {
  0: { passes: [], note: 'tokens + palette' },
  1: { passes: ['sunGradient'], note: 'horizon sun only' },
  2: { passes: ['sunGradient', 'gridGlow', 'hueShiftByAge'], note: 'sun + perspective grid + age hue' },
  3: {
    passes: ['sunGradient', 'gridGlow', 'hueShiftByAge', 'bloom', 'chromaticAberration', 'scanlines'],
    note: 'full stack: bloom, edge aberration, subtle scanlines',
  },
};

export const SYNTH_QUALITY: ThemeQualitySpec = {
  max: 3,
  losslessAtQuality0: false,
};
