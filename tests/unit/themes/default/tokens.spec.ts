import { describe, expect, it } from 'vitest';
import { contrastRatio, resolveOpaqueColor, type RGB } from '@shared/color';
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from '@themes/default/tokens';
import type { ColorTokens } from '@themes/types';

const BLACK: RGB = { r: 0, g: 0, b: 0 };

/**
 * Every colour pairing a `client/index.html`-shaped chrome rule actually produces: `text`/`muted`
 * on each of the three panel backdrops, and `onAccent` on every button-background role. Resolves
 * each token against its real backdrop (compositing a translucent surface over `bg`, per
 * `shared/color.ts`'s `resolveOpaqueColor`) rather than checking the raw token value in
 * isolation — a translucent `--gol-color-surface` is only as legible as what actually sits behind
 * it, which for this theme is always the canvas's own `bg`.
 */
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

describe.each([
  ['dark', DEFAULT_DARK_TOKENS],
  ['light', DEFAULT_LIGHT_TOKENS],
] as const)('Default theme (%s variant) — WCAG AA chrome-text contrast (P1-E-3 AC1)', (_name, tokens) => {
  it.each(chromeTextPairs(tokens.color))('%s clears 4.5:1', (label, fg, bg) => {
    expect(contrastRatio(fg, bg), `${label} contrast ratio`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Default theme tokens — non-colour groups match between variants', () => {
  it('share the same type, space, radius, shadow and motion tokens', () => {
    expect(DEFAULT_LIGHT_TOKENS.type).toEqual(DEFAULT_DARK_TOKENS.type);
    expect(DEFAULT_LIGHT_TOKENS.space).toEqual(DEFAULT_DARK_TOKENS.space);
    expect(DEFAULT_LIGHT_TOKENS.radius).toEqual(DEFAULT_DARK_TOKENS.radius);
    expect(DEFAULT_LIGHT_TOKENS.shadow).toEqual(DEFAULT_DARK_TOKENS.shadow);
    expect(DEFAULT_LIGHT_TOKENS.motion).toEqual(DEFAULT_DARK_TOKENS.motion);
  });

  it('differ in every colour role between variants (a real light/dark swap, not a copy)', () => {
    const darkKeys = Object.keys(DEFAULT_DARK_TOKENS.color) as (keyof ColorTokens)[];
    for (const key of darkKeys) {
      expect(DEFAULT_LIGHT_TOKENS.color[key], key).not.toBe(DEFAULT_DARK_TOKENS.color[key]);
    }
  });
});
