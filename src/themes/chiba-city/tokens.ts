/**
 * Chiba-City tokens (P3-C-2) — near-black, neon cyan, angular chrome, monospace UI.
 * Every colour pairing the chrome actually produces is WCAG AA-checked in
 * `tests/unit/themes/chiba-city/tokens.spec.ts`.
 */
import type { TokenSet } from '@themes/types';

const TYPE: TokenSet['type'] = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
  weight: { regular: 400, medium: 600, bold: 700 },
  letterSpacing: { normal: '0', wide: '0.08em' },
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

/** Angular corners — a terminal, not a card. */
const RADIUS: TokenSet['radius'] = { sm: '0px', md: '0px', lg: '2px' };

const SHADOW: TokenSet['shadow'] = {
  sm: '0 0 8px rgba(46, 230, 214, 0.28)',
  md: '0 0 18px rgba(46, 230, 214, 0.38)',
  lg: '0 0 36px rgba(46, 230, 214, 0.48)',
};

const MOTION: TokenSet['motion'] = {
  duration: { instant: '0ms', fast: '70ms', slow: '120ms', slower: '200ms' },
  easing: {
    linear: 'linear',
    standard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

const EFFECT: TokenSet['effect'] = { blur: { chrome: 'blur(6px)' } };

export const CHIBA_CITY_TOKENS: TokenSet = {
  color: {
    bg: '#05090c',
    surface: 'rgba(46, 230, 214, 0.08)',
    elevated: 'rgba(46, 230, 214, 0.14)',
    border: 'rgba(46, 230, 214, 0.42)',
    borderStrong: 'rgba(94, 255, 232, 0.78)',
    text: '#e7fff9',
    muted: '#8ec9c0',
    accent: '#2ee6d6',
    accentStrong: '#6ffff0',
    accentPressed: '#1aaea3',
    onAccent: '#021014',
    scrim: 'rgba(2, 8, 12, 0.72)',
    danger: '#ff4d8d',
    dangerStrong: '#ff7aa8',
    success: '#3dff8a',
    successStrong: '#74ffb0',
  },
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  shadow: SHADOW,
  motion: MOTION,
  effect: EFFECT,
};
