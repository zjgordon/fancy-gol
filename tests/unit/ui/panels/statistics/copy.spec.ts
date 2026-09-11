import { describe, expect, it } from 'vitest';
import {
  describeCycleFinding,
  formatBbox,
  formatCentroid,
  formatCount,
  formatDensity,
  formatHash,
  formatSigned,
} from '@ui/panels/statistics/copy';

describe('statistics copy', () => {
  it('names oscillators, spaceships, and guns in plain language', () => {
    expect(
      describeCycleFinding({ kind: 'oscillator', period: 30, detectedAt: 412, displacement: { x: 0, y: 0 } }),
    ).toBe('Period 30 oscillator detected at generation 412');
    expect(
      describeCycleFinding({ kind: 'spaceship', period: 4, detectedAt: 20, displacement: { x: 1, y: 1 } }),
    ).toBe('Period 4 spaceship detected at generation 20 (Δ1, Δ1)');
    expect(
      describeCycleFinding({ kind: 'windowed', period: 30, detectedAt: 90, displacement: { x: 0, y: 0 } }),
    ).toBe('Period 30 gun detected at generation 90');
  });

  it('formats counts, density, hashes, and geometry without a locale decimal trap', () => {
    expect(formatCount(1234)).toBe((1234).toLocaleString('en-US'));
    expect(formatSigned(12)).toBe('+12');
    expect(formatSigned(-3)).toBe('-3');
    expect(formatDensity(0.25)).toBe('25.0%');
    expect(formatHash(-1)).toBe('ffffffff');
    expect(formatBbox({ x: 2, y: 3, width: 4, height: 5 })).toBe('4×5 at (2, 3)');
    expect(formatBbox({ x: 0, y: 0, width: 0, height: 0 })).toBe('empty');
    expect(formatCentroid({ x: 1.5, y: -2 })).toBe('(1.50, -2.00)');
  });
});
