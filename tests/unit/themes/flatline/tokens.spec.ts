import { describe, expect, it } from 'vitest';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { FLATLINE_TOKENS, makeFlatlineTokens, type PhosphorKind } from '@themes/flatline/tokens';
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

const TUBES: readonly PhosphorKind[] = ['amber', 'green', 'white'];

describe('Flatline tokens — WCAG AA chrome-text contrast (P3-C-3)', () => {
  it.each(chromeTextPairs(FLATLINE_TOKENS.color))('%s clears 4.5:1', (label, fg, bg) => {
    expect(contrastRatio(fg, bg), `${label} contrast ratio`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TUBES)('%s phosphor pairings also clear 4.5:1', (kind) => {
    for (const [label, fg, bg] of chromeTextPairs(makeFlatlineTokens(kind).color)) {
      expect(contrastRatio(fg, bg), `${kind} ${label}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('Flatline tokens — considered against Default, not copied', () => {
  it('does not inherit Default colour, type, radius, shadow, or motion', () => {
    expect(FLATLINE_TOKENS.color).not.toEqual(DEFAULT_DARK_TOKENS.color);
    expect(FLATLINE_TOKENS.type.fontFamily).not.toBe(DEFAULT_DARK_TOKENS.type.fontFamily);
    expect(FLATLINE_TOKENS.radius).not.toEqual(DEFAULT_DARK_TOKENS.radius);
    expect(FLATLINE_TOKENS.shadow).not.toEqual(DEFAULT_DARK_TOKENS.shadow);
    expect(FLATLINE_TOKENS.motion.duration).not.toEqual(DEFAULT_DARK_TOKENS.motion.duration);
  });

  it('is monospace, square, and amber', () => {
    expect(FLATLINE_TOKENS.type.fontFamily).toMatch(/mono/i);
    expect(FLATLINE_TOKENS.radius.sm).toBe('0px');
    expect(FLATLINE_TOKENS.radius.md).toBe('0px');
    expect(FLATLINE_TOKENS.radius.lg).toBe('0px');
    expect(FLATLINE_TOKENS.color.accent.toLowerCase()).toBe('#ffb000');
  });
});
