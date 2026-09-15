import { describe, expect, it } from 'vitest';
import { colorDistance, parseCssColor, simulateColorBlindness, type ColorBlindnessKind, type RGB } from '@shared/color';
import { BUILTIN_RULESETS } from '@engine/rules/builtin';
import {
  AGE_RAMP_STEPS,
  PALETTE_STATE_COUNT,
  VOID_AGE_TABLE,
  VOID_STATE_RAMP,
  makeVoidPalette,
  type StateRamp,
} from '@themes/void-walker/palette';
import { VOID_WALKER_TOKENS } from '@themes/void-walker/tokens';

const MIN_DISTINGUISHABLE_DISTANCE = 50;
const KINDS: readonly ColorBlindnessKind[] = ['protanopia', 'deuteranopia'];
const BG = VOID_WALKER_TOKENS.color.bg;

function steadyColors(ramp: readonly StateRamp[]): RGB[] {
  return ramp.map((entry) => {
    const rgb = parseCssColor(entry.steady);
    if (!rgb) throw new Error(`not a colour: ${entry.steady}`);
    return rgb;
  });
}

describe('Void-Walker ramp — distinguishable under CVD simulation (P3-C-5)', () => {
  it('has 8 live states', () => {
    expect(VOID_STATE_RAMP).toHaveLength(8);
  });

  it.each(KINDS)('every pair of states stays separated under simulated %s', (kind) => {
    const simulated = steadyColors(VOID_STATE_RAMP).map((rgb) => simulateColorBlindness(rgb, kind));
    let minDistance = Infinity;
    for (let i = 0; i < simulated.length; i++) {
      for (let j = i + 1; j < simulated.length; j++) {
        const a = simulated[i];
        const b = simulated[j];
        if (!a || !b) continue;
        minDistance = Math.min(minDistance, colorDistance(a, b));
      }
    }
    expect(minDistance).toBeGreaterThanOrEqual(MIN_DISTINGUISHABLE_DISTANCE);
  });

  it("a state's born colour is lighter than its steady colour (white-violet flare)", () => {
    for (const { born, steady } of VOID_STATE_RAMP) {
      const bornRgb = parseCssColor(born)!;
      const steadyRgb = parseCssColor(steady)!;
      const luma = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      expect(luma(bornRgb)).toBeGreaterThan(luma(steadyRgb));
    }
  });
});

describe('makeVoidPalette', () => {
  const palette = makeVoidPalette(BG);
  const lastAge = AGE_RAMP_STEPS - 1;

  it('renders the dead state as the canvas background', () => {
    expect(palette(0, 0)).toBe(BG);
    expect(palette(0, 999)).toBe(BG);
  });

  it('age is a real ramp: born, mid, and steady are distinct', () => {
    const born = palette(1, 0);
    const mid = palette(1, 7);
    const steady = palette(1, lastAge);
    expect(born).not.toBe(steady);
    expect(mid).not.toBe(born);
    expect(mid).not.toBe(steady);
  });

  it('covers every builtin ruleset state id without wrapping collisions', () => {
    const maxId = Math.max(...BUILTIN_RULESETS.map((rs) => rs.states.length - 1));
    expect(PALETTE_STATE_COUNT).toBeGreaterThanOrEqual(maxId);
    for (const rs of BUILTIN_RULESETS) {
      const colors = new Set<string>();
      for (const def of rs.states) {
        const hex = palette(def.id, lastAge);
        if (def.id === 0) {
          expect(hex).toBe(BG);
          continue;
        }
        colors.add(hex);
      }
      const liveCount = rs.states.filter((s) => s.id !== 0).length;
      expect(colors.size, rs.id).toBe(liveCount);
    }
  });

  it('state 1 flares white-violet then settles toward purple', () => {
    const born = parseCssColor(palette(1, 0))!;
    const steady = parseCssColor(palette(1, lastAge))!;
    expect(born.r + born.g + born.b).toBeGreaterThan(600);
    expect(steady.b).toBeGreaterThan(steady.g);
    expect(VOID_AGE_TABLE).toHaveLength(PALETTE_STATE_COUNT);
  });
});
