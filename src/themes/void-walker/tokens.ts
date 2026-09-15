/**
 * Void-Walker tokens (P3-C-5) — near-black violet, translucent glass, wide type.
 * Every colour pairing the chrome actually produces is WCAG AA-checked in
 * `tests/unit/themes/void-walker/tokens.spec.ts`.
 */
import type { TokenSet } from '@themes/types';

const TYPE: TokenSet['type'] = {
  fontFamily: 'ui-sans-serif, system-ui, "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif',
  fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
  weight: { regular: 400, medium: 500, bold: 700 },
  letterSpacing: { normal: '0.04em', wide: '0.18em' },
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

/** Soft corners — light bleeds around glass, not a terminal. */
const RADIUS: TokenSet['radius'] = { sm: '8px', md: '14px', lg: '22px' };

const SHADOW: TokenSet['shadow'] = {
  sm: '0 0 12px rgba(180, 140, 255, 0.28)',
  md: '0 0 28px rgba(180, 140, 255, 0.38)',
  lg: '0 0 56px rgba(180, 140, 255, 0.48)',
};

const MOTION: TokenSet['motion'] = {
  duration: { instant: '0ms', fast: '160ms', slow: '380ms', slower: '640ms' },
  easing: {
    linear: 'linear',
    standard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

const EFFECT: TokenSet['effect'] = { blur: { chrome: 'blur(14px)' } };

export const VOID_WALKER_TOKENS: TokenSet = {
  color: {
    bg: '#05010f',
    surface: 'rgba(180, 140, 255, 0.1)',
    elevated: 'rgba(180, 140, 255, 0.18)',
    border: 'rgba(196, 160, 255, 0.38)',
    borderStrong: 'rgba(220, 190, 255, 0.72)',
    text: '#ede4ff',
    muted: '#b59acc',
    accent: '#c4a0ff',
    accentStrong: '#e0c8ff',
    accentPressed: '#9470d4',
    onAccent: '#12081c',
    scrim: 'rgba(4, 1, 12, 0.78)',
    danger: '#ff6b9d',
    dangerStrong: '#ff96b8',
    success: '#7dffc8',
    successStrong: '#a8ffe0',
  },
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  shadow: SHADOW,
  motion: MOTION,
  effect: EFFECT,
};
