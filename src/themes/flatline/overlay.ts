/**
 * L4 overlay colours for Flatline (P3-C-3). Selection and origin stay AA
 * against both the solid canvas and a busy phosphor glyph (textRain + ghost).
 */
import { parseCssColor, type RGB } from '@shared/color';
import type { TokenSet } from '@themes/types';

export interface FlatlineOverlayPalette {
  readonly selection: RGB;
  readonly gridMinor: RGB;
  readonly gridDecade: RGB;
  readonly origin: RGB;
}

function mustRgb(css: string, role: string): RGB {
  const parsed = parseCssColor(css);
  if (!parsed) throw new Error(`flatline overlay: ${role} is not a parseable colour`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

export function overlayPalette(tokens: TokenSet): FlatlineOverlayPalette {
  const c = tokens.color;
  return {
    selection: mustRgb(c.text, 'text'),
    origin: mustRgb(c.text, 'text'),
    gridDecade: mustRgb(c.accentStrong, 'accentStrong'),
    gridMinor: mustRgb(c.muted, 'muted'),
  };
}
