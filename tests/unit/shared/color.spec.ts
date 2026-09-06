import { describe, expect, it } from 'vitest';
import {
  colorDistance,
  compositeOver,
  contrastRatio,
  meetsWcagAA,
  oklch,
  parseCssColor,
  relativeLuminance,
  resolveOpaqueColor,
  simulateColorBlindness,
  toHex,
  type RGB,
} from '@shared/color';

describe('oklch (Björn Ottosson OKLCH → sRGB)', () => {
  it('L=1, C=0 is white; L=0, C=0 is black', () => {
    expect(oklch(1, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(oklch(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('C=0 is always achromatic (r === g === b) regardless of hue', () => {
    const rgb = oklch(0.5, 0, 200);
    expect(rgb.r).toBe(rgb.g);
    expect(rgb.g).toBe(rgb.b);
  });

  it('clamps out-of-gamut results into valid byte range', () => {
    const rgb = oklch(0.7, 0.4, 30);
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe('toHex', () => {
  it('formats and zero-pads each channel', () => {
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(toHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff');
    expect(toHex({ r: 1, g: 2, b: 3 })).toBe('#010203');
  });

  it('clamps out-of-range channels rather than producing invalid hex', () => {
    expect(toHex({ r: -10, g: 300, b: 128.6 })).toBe('#00ff81');
  });
});

describe('parseCssColor', () => {
  it('parses 3-digit hex', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('parses 4-digit hex (with alpha nibble)', () => {
    expect(parseCssColor('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 136 / 255 });
  });

  it('parses 6-digit hex', () => {
    expect(parseCssColor('#7cf9d0')).toEqual({ r: 0x7c, g: 0xf9, b: 0xd0, a: 1 });
  });

  it('parses 8-digit hex (with alpha byte)', () => {
    expect(parseCssColor('#ffffff80')).toEqual({ r: 255, g: 255, b: 255, a: 128 / 255 });
  });

  it('is case-insensitive', () => {
    expect(parseCssColor('#ABCDEF')).toEqual(parseCssColor('#abcdef'));
  });

  it('parses rgb() with no alpha', () => {
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it('parses rgba() with alpha', () => {
    expect(parseCssColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it('returns null for anything this project never stores in a token', () => {
    expect(parseCssColor('hsl(200, 50%, 50%)')).toBeNull();
    expect(parseCssColor('rebeccapurple')).toBeNull();
    expect(parseCssColor('var(--gol-color-accent)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
  });
});

describe('compositeOver', () => {
  it('is a no-op passthrough at alpha 1', () => {
    expect(compositeOver({ r: 10, g: 20, b: 30, a: 1 }, { r: 0, g: 0, b: 0 })).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('blends toward the base colour at partial alpha', () => {
    // 50% white over black == mid-grey, exactly.
    expect(compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 })).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    });
  });

  it('is fully the base colour at alpha 0', () => {
    expect(compositeOver({ r: 255, g: 0, b: 0, a: 0 }, { r: 10, g: 20, b: 30 })).toEqual({ r: 10, g: 20, b: 30 });
  });
});

describe('resolveOpaqueColor', () => {
  it('returns an opaque colour unchanged', () => {
    expect(resolveOpaqueColor('#112233', { r: 0, g: 0, b: 0 })).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
  });

  it('composites a translucent colour over the given base', () => {
    expect(resolveOpaqueColor('rgba(255,255,255,0.5)', { r: 0, g: 0, b: 0 })).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    });
  });

  it('throws on an unparseable colour rather than silently guessing', () => {
    expect(() => resolveOpaqueColor('rebeccapurple', { r: 0, g: 0, b: 0 })).toThrow();
  });
});

describe('relativeLuminance / contrastRatio / meetsWcagAA', () => {
  const black: RGB = { r: 0, g: 0, b: 0 };
  const white: RGB = { r: 255, g: 255, b: 255 };

  it('relativeLuminance: black is 0, white is 1', () => {
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBe(1);
  });

  it('contrastRatio: black vs white is 21:1, identical colours are 1:1', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5); // order-independent
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('meetsWcagAA: requires 4.5:1 for normal text, 3:1 for large text/UI', () => {
    // A mid-grey text-on-white pairing that lands between the two thresholds.
    const midGrey: RGB = { r: 145, g: 145, b: 145 };
    const ratio = contrastRatio(midGrey, white);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5);
    expect(meetsWcagAA(midGrey, white, { large: true })).toBe(true);
    expect(meetsWcagAA(midGrey, white)).toBe(false);
    expect(meetsWcagAA(black, white)).toBe(true);
  });
});

describe('simulateColorBlindness', () => {
  it('leaves pure grey visually unchanged (no red/green channel to confuse)', () => {
    const grey: RGB = { r: 128, g: 128, b: 128 };
    const proto = simulateColorBlindness(grey, 'protanopia');
    const deut = simulateColorBlindness(grey, 'deuteranopia');
    expect(colorDistance(grey, proto)).toBeLessThan(5);
    expect(colorDistance(grey, deut)).toBeLessThan(5);
  });

  it('measurably shifts a saturated colour for both kinds', () => {
    const red: RGB = { r: 220, g: 30, b: 30 };
    expect(colorDistance(red, simulateColorBlindness(red, 'protanopia'))).toBeGreaterThan(20);
    expect(colorDistance(red, simulateColorBlindness(red, 'deuteranopia'))).toBeGreaterThan(20);
  });

  it('produces valid sRGB bytes', () => {
    const result = simulateColorBlindness({ r: 255, g: 0, b: 0 }, 'protanopia');
    for (const channel of [result.r, result.g, result.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe('colorDistance', () => {
  it('is 0 for identical colours', () => {
    expect(colorDistance({ r: 1, g: 2, b: 3 }, { r: 1, g: 2, b: 3 })).toBe(0);
  });

  it('is symmetric and matches the plain Euclidean formula', () => {
    const a: RGB = { r: 0, g: 0, b: 0 };
    const b: RGB = { r: 3, g: 4, b: 0 };
    expect(colorDistance(a, b)).toBe(5);
    expect(colorDistance(b, a)).toBe(5);
  });
});
