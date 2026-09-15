/**
 * L4 overlay colours for Sids-Place (P3-C-4). Selection and origin stay AA
 * against both the solid parchment token and a busy baked-fibre texel.
 */
import { parseCssColor, type RGB } from '@shared/color';
import type { TokenSet } from '@themes/types';

export interface SidsOverlayPalette {
  readonly selection: RGB;
  readonly gridMinor: RGB;
  readonly gridDecade: RGB;
  readonly origin: RGB;
}

function mustRgb(css: string, role: string): RGB {
  const parsed = parseCssColor(css);
  if (!parsed) throw new Error(`sids overlay: ${role} is not a parseable colour`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

export function overlayPalette(tokens: TokenSet): SidsOverlayPalette {
  const c = tokens.color;
  return {
    selection: mustRgb(c.text, 'text'),
    origin: mustRgb(c.accent, 'accent'),
    gridDecade: mustRgb(c.accentStrong, 'accentStrong'),
    gridMinor: mustRgb(c.muted, 'muted'),
  };
}
