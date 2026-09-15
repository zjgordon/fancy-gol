/**
 * L4 overlay colours for Void-Walker (P3-C-5). Selection and origin stay AA
 * against both the solid canvas and a busy starfield texel.
 */
import { parseCssColor, type RGB } from '@shared/color';
import type { TokenSet } from '@themes/types';

export interface VoidOverlayPalette {
  readonly selection: RGB;
  readonly gridMinor: RGB;
  readonly gridDecade: RGB;
  readonly origin: RGB;
}

function mustRgb(css: string, role: string): RGB {
  const parsed = parseCssColor(css);
  if (!parsed) throw new Error(`void-walker overlay: ${role} is not a parseable colour`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

export function overlayPalette(tokens: TokenSet): VoidOverlayPalette {
  const c = tokens.color;
  return {
    selection: mustRgb(c.text, 'text'),
    origin: mustRgb(c.accentStrong, 'accentStrong'),
    gridDecade: mustRgb(c.accent, 'accent'),
    gridMinor: mustRgb(c.muted, 'muted'),
  };
}
