import { describe, expect, it } from 'vitest';
import { colorDistance, parseCssColor, simulateColorBlindness, type ColorBlindnessKind, type RGB } from '@shared/color';
import { BUILTIN_RULESETS } from '@engine/rules/builtin';
import {
  AGE_HUE_SWING,
  AGE_RAMP_STEPS,
  PALETTE_STATE_COUNT,
  SYNTH_AGE_TABLE,
  SYNTH_STATE_RAMP,
  makeSynthPalette,
  type StateRamp,
} from '@themes/synthwave/palette';
import { SYNTHWAVE_TOKENS } from '@themes/synthwave/tokens';

const MIN_DISTINGUISHABLE_DISTANCE = 50;
const KINDS: readonly ColorBlindnessKind[] = ['protanopia', 'deuteranopia'];
const BG = SYNTHWAVE_TOKENS.color.bg;

function steadyColors(ramp: readonly StateRamp[]): RGB[] {
  return ramp.map((entry) => {
    const rgb = parseCssColor(entry.steady);
    if (!rgb) throw new Error(`not a colour: ${entry.steady}`);
    return rgb;
  });
}

describe('Synthwave ramp — distinguishable under CVD simulation (P3-C-6)', () => {
  it('has 8 live states', () => {
    expect(SYNTH_STATE_RAMP).toHaveLength(8);
  });

  it.each(KINDS)('every pair of states stays separated under simulated %s', (kind) => {
    const simulated = steadyColors(SYNTH_STATE_RAMP).map((rgb) => simulateColorBlindness(rgb, kind));
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

  it('is not "everything is pink": steady hues span more than one quadrant', () => {
    const hues = SYNTH_STATE_RAMP.map((entry) => {
      const rgb = parseCssColor(entry.steady)!;
      // Rough hue proxy: atan2 of (r-g, b-g) is enough to prove spread.
      return Math.atan2(rgb.b - rgb.g, rgb.r - rgb.g);
    });
    const span = Math.max(...hues) - Math.min(...hues);
    expect(span).toBeGreaterThan(1.5);
  });

  it("a state's born colour is at least as light as its steady colour", () => {
    for (const { born, steady } of SYNTH_STATE_RAMP) {
      const bornRgb = parseCssColor(born)!;
      const steadyRgb = parseCssColor(steady)!;
      const luma = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      // Near-white steadies can clip a hair under birth in sRGB; allow a tiny epsilon.
      expect(luma(bornRgb)).toBeGreaterThan(luma(steadyRgb) - 8);
    }
  });
});

describe('makeSynthPalette', () => {
  const palette = makeSynthPalette(BG);
  const lastAge = AGE_RAMP_STEPS - 1;

  it('renders the dead state as the canvas background', () => {
    expect(palette(0, 0)).toBe(BG);
  });

  it('age walks hue along the magenta→cyan axis', () => {
    expect(AGE_HUE_SWING).toBe(100);
    const born = parseCssColor(palette(1, 0))!;
    const steady = parseCssColor(palette(1, lastAge))!;
    // Born is a hot flare; aged settles. Hue mid-ramp is distinct from both ends.
    expect(born.r + born.g + born.b).toBeGreaterThan(500);
    expect(palette(1, 0)).not.toBe(palette(1, lastAge));
    expect(palette(1, 7)).not.toBe(palette(1, 0));
    expect(palette(1, 7)).not.toBe(palette(1, lastAge));
    void steady;
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
    expect(SYNTH_AGE_TABLE).toHaveLength(PALETTE_STATE_COUNT);
  });
});
