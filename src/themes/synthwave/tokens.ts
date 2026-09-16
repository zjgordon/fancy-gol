/**
 * Synthwave tokens (P3-C-6) — magenta/cyan neon, italic display, pink glow.
 * Every colour pairing the chrome actually produces is WCAG AA-checked in
 * `tests/unit/themes/synthwave/tokens.spec.ts`.
 */
import type { TokenSet } from '@themes/types';

const TYPE: TokenSet['type'] = {
  fontFamily: 'ui-sans-serif, "Avenir Next Condensed", "Segoe UI", Helvetica, Arial, sans-serif',
  fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
  weight: { regular: 400, medium: 600, bold: 700 },
  letterSpacing: { normal: '0.02em', wide: '0.14em' },
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

const RADIUS: TokenSet['radius'] = { sm: '2px', md: '4px', lg: '8px' };

const SHADOW: TokenSet['shadow'] = {
  sm: '0 0 10px rgba(255, 43, 214, 0.35)',
  md: '0 0 22px rgba(255, 43, 214, 0.48)',
  lg: '0 0 44px rgba(46, 230, 214, 0.42)',
};

const MOTION: TokenSet['motion'] = {
  duration: { instant: '0ms', fast: '60ms', slow: '110ms', slower: '180ms' },
  easing: {
    linear: 'linear',
    standard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

const EFFECT: TokenSet['effect'] = { blur: { chrome: 'blur(8px)' } };

export const SYNTHWAVE_TOKENS: TokenSet = {
  color: {
    bg: '#12001f',
    surface: 'rgba(255, 43, 214, 0.1)',
    elevated: 'rgba(46, 230, 214, 0.12)',
    border: 'rgba(255, 43, 214, 0.45)',
    borderStrong: 'rgba(46, 230, 214, 0.72)',
    text: '#ffe6fb',
    muted: '#c99bc8',
    accent: '#ff2bd6',
    accentStrong: '#ff7aee',
    accentPressed: '#e85ec8',
    onAccent: '#1a0020',
    scrim: 'rgba(12, 0, 24, 0.75)',
    danger: '#ff5c7a',
    dangerStrong: '#ff8fa3',
    success: '#2ee6d6',
    successStrong: '#7ffff0',
  },
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  shadow: SHADOW,
  motion: MOTION,
  effect: EFFECT,
};
