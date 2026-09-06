import { describe, expect, it } from 'vitest';
import type { CellPalette } from '@render/types';
import type { MotionSignature, ThemeModule, TokenSet } from '@themes/types';

const palette: CellPalette = (state) => (state === 0 ? '#000000' : '#ffffff');

const tokens: TokenSet = {
  color: {
    bg: '#0e0f11',
    surface: 'rgba(255,255,255,0.05)',
    elevated: 'rgba(255,255,255,0.09)',
    border: 'rgba(255,255,255,0.14)',
    borderStrong: 'rgba(255,255,255,0.24)',
    text: '#eef0f2',
    muted: '#9aa0a6',
    accent: '#8a97a8',
    accentStrong: '#a6b2c2',
    accentPressed: '#6f7c8c',
    onAccent: '#0e0f11',
    scrim: 'rgba(0,0,0,0.55)',
    danger: '#e5484d',
    dangerStrong: '#ff6369',
    success: '#3dd68c',
    successStrong: '#5eeaa6',
  },
  type: {
    fontFamily: 'system-ui',
    fontFamilyMono: 'ui-monospace',
    size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
    weight: { regular: 400, medium: 600, bold: 700 },
    letterSpacing: { normal: '0', wide: '0.04em' },
  },
  space: { '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '24px', '6': '32px', '7': '48px' },
  radius: { sm: '6px', md: '8px', lg: '14px' },
  shadow: { sm: '0 2px 8px rgba(0,0,0,.25)', md: '0 8px 24px rgba(0,0,0,.35)', lg: '0 16px 48px rgba(0,0,0,.45)' },
  motion: {
    duration: { instant: '0ms', fast: '150ms', slow: '600ms', slower: '900ms' },
    easing: {
      linear: 'linear',
      standard: 'cubic-bezier(.22,.61,.36,1)',
      decelerate: 'cubic-bezier(0,0,.2,1)',
      accelerate: 'cubic-bezier(.4,0,1,1)',
      bounce: 'cubic-bezier(.34,1.56,.64,1)',
    },
  },
  effect: { blur: { chrome: 'blur(4px)' } },
};

const motion: MotionSignature = {
  durationMs: { instant: 0, fast: 150, slow: 600, slower: 900 },
  easings: {
    linear: (t) => t,
    standard: (t) => t,
    decelerate: (t) => t,
    accelerate: (t) => t,
    bounce: (t) => t,
  },
  enter: { delayStepMs: 40 },
};

describe('themes/types.ts — the ThemeModule contract (P1-E-1)', () => {
  it('accepts a Phase-1-shaped Default theme (no render hooks, no sound)', () => {
    const theme: ThemeModule = {
      id: 'default',
      name: 'Default',
      tokens,
      palette,
      motion,
      cost: 'low',
    };

    expect(theme.cost).toBe('low');
    expect(theme.palette(0, 0)).toBe('#000000');
    expect(theme.drawBackground).toBeUndefined();
    expect(theme.sound).toBeUndefined();
  });

  it('accepts every Phase 3 field without widening the interface', () => {
    const theme: ThemeModule = {
      id: 'void-walker',
      name: 'Void-Walker',
      tokens,
      palette,
      motion,
      cost: 'high',
      sound: { muted: true },
      drawBackground: () => {},
      drawCellOverride: () => {},
      postProcess: () => {},
      shaders: { vertex: '', fragment: '' },
    };

    expect(theme.cost).toBe('high');
    expect(typeof theme.drawBackground).toBe('function');
  });

  it("motion.easings share TokenSet.motion's named keys", () => {
    expect(Object.keys(motion.easings).sort()).toEqual(Object.keys(tokens.motion.easing).sort());
    expect(Object.keys(motion.durationMs).sort()).toEqual(Object.keys(tokens.motion.duration).sort());
  });
});
