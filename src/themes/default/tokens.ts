/**
 * The Default theme's token values (P1-E-3) — "simple, grey, basic... very compatible and good
 * for large grids" (INCEPTION.md), implementing the contract `themes/types.ts`/`themes/tokens.css`
 * declared (P1-E-1). Type, space, radius, shadow and motion are identical between variants (none
 * of those are colour-scheme-dependent); only `color` differs.
 *
 * Every colour pairing a chrome rule actually produces — `text`/`muted` against `bg`/`surface`/
 * `elevated`, and `onAccent` against every button-background role (`accent*`, `danger*`,
 * `success*`) — is checked against WCAG AA (4.5:1) by `tests/unit/themes/default/tokens.spec.ts`
 * using `shared/color.ts`'s `contrastRatio`, composited over its actual backdrop where a token is
 * translucent. This is this task's first acceptance criterion, not a claim taken on faith.
 */
import type { TokenSet } from '@themes/types';

const TYPE: TokenSet['type'] = {
  fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
  weight: { regular: 400, medium: 600, bold: 700 },
  letterSpacing: { normal: '0', wide: '0.04em' },
};

const SPACE: TokenSet['space'] = {
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '24px',
  '6': '32px',
  '7': '48px',
};

const RADIUS: TokenSet['radius'] = { sm: '6px', md: '8px', lg: '14px' };

const SHADOW: TokenSet['shadow'] = {
  sm: '0 2px 8px rgba(0, 0, 0, 0.25)',
  md: '0 8px 24px rgba(0, 0, 0, 0.35)',
  lg: '0 16px 48px rgba(0, 0, 0, 0.45)',
};

const MOTION: TokenSet['motion'] = {
  duration: { instant: '0ms', fast: '150ms', slow: '600ms', slower: '900ms' },
  easing: {
    linear: 'linear',
    standard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

const EFFECT: TokenSet['effect'] = { blur: { chrome: 'blur(4px)' } };

export const DEFAULT_DARK_TOKENS: TokenSet = {
  color: {
    bg: '#0e0f11',
    surface: 'rgba(255, 255, 255, 0.06)',
    elevated: 'rgba(255, 255, 255, 0.1)',
    border: 'rgba(255, 255, 255, 0.14)',
    borderStrong: 'rgba(255, 255, 255, 0.24)',
    text: '#f0f1f2',
    muted: '#a7acb1',
    accent: '#8fa6c9',
    accentStrong: '#a9bcda',
    accentPressed: '#7089ad',
    onAccent: '#0e0f11',
    scrim: 'rgba(0, 0, 0, 0.55)',
    danger: '#e5484d',
    dangerStrong: '#ff6369',
    success: '#3dd68c',
    successStrong: '#5eeaa6',
  },
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  shadow: SHADOW,
  motion: MOTION,
  effect: EFFECT,
};

export const DEFAULT_LIGHT_TOKENS: TokenSet = {
  color: {
    bg: '#f6f6f8',
    surface: 'rgba(20, 20, 30, 0.045)',
    elevated: 'rgba(20, 20, 30, 0.08)',
    border: 'rgba(20, 20, 30, 0.12)',
    borderStrong: 'rgba(20, 20, 30, 0.22)',
    text: '#15161a',
    muted: '#585d63',
    accent: '#3a5f8a',
    accentStrong: '#2c4b6e',
    accentPressed: '#294669',
    onAccent: '#ffffff',
    scrim: 'rgba(0, 0, 0, 0.4)',
    danger: '#c22b30',
    dangerStrong: '#9f2226',
    success: '#177a51',
    successStrong: '#186f4a',
  },
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  shadow: SHADOW,
  motion: MOTION,
  effect: EFFECT,
};
