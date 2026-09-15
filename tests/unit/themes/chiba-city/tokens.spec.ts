import { describe, expect, it } from 'vitest';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { CHIBA_CITY_TOKENS } from '@themes/chiba-city/tokens';
import { DEFAULT_DARK_TOKENS } from '@themes/default/tokens';
import type { ColorTokens } from '@themes/types';

const BLACK: RGB = { r: 0, g: 0, b: 0 };

function chromeTextPairs(c: ColorTokens): ReadonlyArray<readonly [string, RGB, RGB]> {
  const bg = resolveOpaqueColor(c.bg, BLACK);
  const surface = resolveOpaqueColor(c.surface, bg);
  const elevated = resolveOpaqueColor(c.elevated, bg);
  const text = resolveOpaqueColor(c.text, bg);
  const muted = resolveOpaqueColor(c.muted, bg);
  const onAccent = resolveOpaqueColor(c.onAccent, bg);
  return [
    ['text/bg', text, bg],
    ['text/surface', text, surface],
    ['text/elevated', text, elevated],
    ['muted/bg', muted, bg],
    ['muted/surface', muted, surface],
    ['muted/elevated', muted, elevated],
    ['onAccent/accent', onAccent, resolveOpaqueColor(c.accent, bg)],
    ['onAccent/accentStrong', onAccent, resolveOpaqueColor(c.accentStrong, bg)],
    ['onAccent/accentPressed', onAccent, resolveOpaqueColor(c.accentPressed, bg)],
    ['onAccent/danger', onAccent, resolveOpaqueColor(c.danger, bg)],
    ['onAccent/dangerStrong', onAccent, resolveOpaqueColor(c.dangerStrong, bg)],
    ['onAccent/success', onAccent, resolveOpaqueColor(c.success, bg)],
    ['onAccent/successStrong', onAccent, resolveOpaqueColor(c.successStrong, bg)],
  ];
}

describe('Chiba-City tokens — WCAG AA chrome-text contrast (P3-C-2)', () => {
  it.each(chromeTextPairs(CHIBA_CITY_TOKENS.color))('%s clears 4.5:1', (label, fg, bg) => {
    expect(contrastRatio(fg, bg), `${label} contrast ratio`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Chiba-City tokens — considered against Default, not copied', () => {
  it('does not inherit Default colour, type, radius, shadow, or motion', () => {
    expect(CHIBA_CITY_TOKENS.color).not.toEqual(DEFAULT_DARK_TOKENS.color);
    expect(CHIBA_CITY_TOKENS.type.fontFamily).not.toBe(DEFAULT_DARK_TOKENS.type.fontFamily);
    expect(CHIBA_CITY_TOKENS.radius).not.toEqual(DEFAULT_DARK_TOKENS.radius);
    expect(CHIBA_CITY_TOKENS.shadow).not.toEqual(DEFAULT_DARK_TOKENS.shadow);
    expect(CHIBA_CITY_TOKENS.motion.duration).not.toEqual(DEFAULT_DARK_TOKENS.motion.duration);
  });

  it('is monospace and angular', () => {
    expect(CHIBA_CITY_TOKENS.type.fontFamily).toMatch(/mono/i);
    expect(CHIBA_CITY_TOKENS.radius.sm).toBe('0px');
    expect(CHIBA_CITY_TOKENS.radius.md).toBe('0px');
  });
});
