/**
 * Flatline tokens (P3-C-3) — amber phosphor on black, monospace, square chrome.
 * Green and white are the same terminal with a different tube. Every pairing the
 * chrome produces is WCAG AA-checked in `tests/unit/themes/flatline/tokens.spec.ts`.
 */
import type { TokenSet } from '@themes/types';

export type PhosphorKind = 'amber' | 'green' | 'white';

const TYPE: TokenSet['type'] = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
  weight: { regular: 400, medium: 600, bold: 700 },
  letterSpacing: { normal: '0', wide: '0.12em' },
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

/** Square corners — box-drawing, not a card. */
const RADIUS: TokenSet['radius'] = { sm: '0px', md: '0px', lg: '0px' };

const MOTION: TokenSet['motion'] = {
  duration: { instant: '0ms', fast: '80ms', slow: '220ms', slower: '400ms' },
  easing: {
    linear: 'linear',
    standard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

const EFFECT: TokenSet['effect'] = { blur: { chrome: 'blur(0px)' } };

interface PhosphorColors {
  readonly color: TokenSet['color'];
  readonly shadow: TokenSet['shadow'];
  readonly rgb: readonly [number, number, number];
  readonly hue: number;
}

const PHOSPHOR: Readonly<Record<PhosphorKind, PhosphorColors>> = {
  amber: {
    hue: 75,
    rgb: [255, 176, 0],
    color: {
      bg: '#0a0804',
      surface: 'rgba(255, 176, 0, 0.08)',
      elevated: 'rgba(255, 176, 0, 0.14)',
      border: 'rgba(255, 176, 0, 0.45)',
      borderStrong: 'rgba(255, 210, 80, 0.82)',
      text: '#f6e2b3',
      muted: '#c9a56a',
      accent: '#ffb000',
      accentStrong: '#ffd24a',
      accentPressed: '#c48400',
      onAccent: '#140e04',
      scrim: 'rgba(8, 6, 4, 0.82)',
      danger: '#ff7a2e',
      dangerStrong: '#ff9a5c',
      success: '#ffe08a',
      successStrong: '#fff0c0',
    },
    shadow: {
      sm: '0 0 6px rgba(255, 176, 0, 0.35)',
      md: '0 0 14px rgba(255, 176, 0, 0.45)',
      lg: '0 0 28px rgba(255, 176, 0, 0.55)',
    },
  },
  green: {
    hue: 145,
    rgb: [51, 255, 102],
    color: {
      bg: '#040a06',
      surface: 'rgba(51, 255, 102, 0.08)',
      elevated: 'rgba(51, 255, 102, 0.14)',
      border: 'rgba(51, 255, 102, 0.42)',
      borderStrong: 'rgba(140, 255, 170, 0.8)',
      text: '#c8ffd4',
      muted: '#7dba8c',
      accent: '#33ff66',
      accentStrong: '#7dff9c',
      accentPressed: '#1db848',
      onAccent: '#031208',
      scrim: 'rgba(2, 8, 4, 0.82)',
      danger: '#ff6a3a',
      dangerStrong: '#ff8f66',
      success: '#b8ffc8',
      successStrong: '#e0ffe8',
    },
    shadow: {
      sm: '0 0 6px rgba(51, 255, 102, 0.35)',
      md: '0 0 14px rgba(51, 255, 102, 0.45)',
      lg: '0 0 28px rgba(51, 255, 102, 0.55)',
    },
  },
  white: {
    hue: 95,
    rgb: [232, 228, 212],
    color: {
      bg: '#080808',
      surface: 'rgba(232, 228, 212, 0.08)',
      elevated: 'rgba(232, 228, 212, 0.14)',
      border: 'rgba(232, 228, 212, 0.38)',
      borderStrong: 'rgba(245, 242, 230, 0.78)',
      text: '#ece8dc',
      muted: '#b0aa9a',
      accent: '#d8d4c8',
      accentStrong: '#f2eee2',
      accentPressed: '#9a968c',
      onAccent: '#101010',
      scrim: 'rgba(4, 4, 4, 0.82)',
      danger: '#e8a090',
      dangerStrong: '#f0c0b4',
      success: '#d8e0c8',
      successStrong: '#eef2e0',
    },
    shadow: {
      sm: '0 0 6px rgba(232, 228, 212, 0.32)',
      md: '0 0 14px rgba(232, 228, 212, 0.42)',
      lg: '0 0 28px rgba(232, 228, 212, 0.52)',
    },
  },
};

export function phosphorRgb(kind: PhosphorKind): readonly [number, number, number] {
  return PHOSPHOR[kind].rgb;
}

export function phosphorHue(kind: PhosphorKind): number {
  return PHOSPHOR[kind].hue;
}

export function makeFlatlineTokens(kind: PhosphorKind = 'amber'): TokenSet {
  const p = PHOSPHOR[kind];
  return {
    color: p.color,
    type: TYPE,
    space: SPACE,
    radius: RADIUS,
    shadow: p.shadow,
    motion: MOTION,
    effect: EFFECT,
  };
}

/** Amber is the registered default tube. */
export const FLATLINE_TOKENS: TokenSet = makeFlatlineTokens('amber');
