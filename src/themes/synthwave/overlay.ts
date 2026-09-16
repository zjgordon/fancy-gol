/**
 * L4 overlay colours for Synthwave (P3-C-6). Selection and origin stay AA
 * against both the solid canvas and a busy neon grid line.
 */
import { parseCssColor, type RGB } from '@shared/color';
import type { TokenSet } from '@themes/types';

export interface SynthOverlayPalette {
  readonly selection: RGB;
  readonly gridMinor: RGB;
  readonly gridDecade: RGB;
  readonly origin: RGB;
}

function mustRgb(css: string, role: string): RGB {
  const parsed = parseCssColor(css);
  if (!parsed) throw new Error(`synthwave overlay: ${role} is not a parseable colour`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

export function overlayPalette(tokens: TokenSet): SynthOverlayPalette {
  const c = tokens.color;
  return {
    selection: mustRgb(c.text, 'text'),
    origin: mustRgb(c.successStrong, 'successStrong'),
    gridDecade: mustRgb(c.accentStrong, 'accentStrong'),
    gridMinor: mustRgb(c.muted, 'muted'),
  };
}
