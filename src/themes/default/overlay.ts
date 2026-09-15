/**
 * L4 overlay colours derived from Default tokens (P3-C-1). Selection and origin must stay
 * legible against the solid canvas — Default has no busy background, so `bg` is the worst case.
 */
import { parseCssColor, type RGB } from '@shared/color';
import type { TokenSet } from '@themes/types';

export interface DefaultOverlayPalette {
  readonly selection: RGB;
  readonly gridMinor: RGB;
  readonly gridDecade: RGB;
  readonly origin: RGB;
}

function mustRgb(css: string, role: string): RGB {
  const parsed = parseCssColor(css);
  if (!parsed) throw new Error(`default overlay: ${role} is not a parseable colour`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

export function overlayPalette(tokens: TokenSet): DefaultOverlayPalette {
  const c = tokens.color;
  return {
    selection: mustRgb(c.text, 'text'),
    origin: mustRgb(c.text, 'text'),
    gridDecade: mustRgb(c.accent, 'accent'),
    gridMinor: mustRgb(c.muted, 'muted'),
  };
}
