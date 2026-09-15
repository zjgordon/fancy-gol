/**
 * Sids-Place tokens (P3-C-4) — ink on parchment, serif chrome, sans for data.
 * Highest AA-risk of the six: every pairing is checked in
 * `tests/unit/themes/sids-place/tokens.spec.ts`.
 */
import type { TokenSet } from '@themes/types';

const TYPE: TokenSet['type'] = {
  fontFamily: 'Palatino Linotype, Palatino, "Iowan Old Style", "Times New Roman", Georgia, serif',
  fontFamilyMono: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
  weight: { regular: 400, medium: 600, bold: 700 },
  letterSpacing: { normal: '0', wide: '0.06em' },
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

const MOTION: TokenSet['motion'] = {
  duration: { instant: '0ms', fast: '140ms', slow: '320ms', slower: '520ms' },
  easing: {
    linear: 'linear',
    standard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

const EFFECT: TokenSet['effect'] = { blur: { chrome: 'blur(2px)' } };

export const SIDS_PLACE_TOKENS: TokenSet = {
  color: {
    bg: '#e4d2ae',
    surface: 'rgba(90, 48, 18, 0.1)',
    elevated: 'rgba(90, 48, 18, 0.16)',
    border: 'rgba(90, 48, 18, 0.32)',
    borderStrong: 'rgba(122, 62, 18, 0.62)',
    text: '#2c1810',
    muted: '#5a3824',
    accent: '#7a3e12',
    accentStrong: '#9a5520',
    accentPressed: '#5c2e0c',
    onAccent: '#f4e6c8',
    scrim: 'rgba(40, 24, 12, 0.52)',
    danger: '#8b1e1e',
    dangerStrong: '#a83838',
    success: '#2f4a28',
    successStrong: '#3d5c32',
  },
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  shadow: {
    sm: '0 2px 6px rgba(60, 32, 12, 0.18)',
    md: '0 8px 20px rgba(60, 32, 12, 0.22)',
    lg: '0 16px 40px rgba(40, 20, 8, 0.28)',
  },
  motion: MOTION,
  effect: EFFECT,
};
