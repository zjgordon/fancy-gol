import { describe, expect, it } from 'vitest';
import { colorDistance, parseCssColor, simulateColorBlindness, type ColorBlindnessKind, type RGB } from '@shared/color';
import { BUILTIN_RULESETS } from '@engine/rules/builtin';
import {
  AGE_RAMP_STEPS,
  DARK_AGE_TABLE,
  DARK_STATE_RAMP,
  LIGHT_STATE_RAMP,
  PALETTE_STATE_COUNT,
  makeDefaultPalette,
  type StateRamp,
} from '@themes/default/palette';

/** A palette is only as useful as its *weakest* pair — this is deliberately more conservative
 * than either ramp's measured worst case (dark ~71, light ~59 under both simulated conditions),
 * leaving margin for the difference between this project's own oklch()/simulateColorBlindness()
 * and whatever exact values were used while hand-tuning the palette in `palette.ts`'s own header
 * note. A documented approximation (see `shared/color.ts`'s own header) — not a substitute for
 * testing with real colour-vision-deficient users. */
const MIN_DISTINGUISHABLE_DISTANCE = 50;
const KINDS: readonly ColorBlindnessKind[] = ['protanopia', 'deuteranopia'];

function steadyColors(ramp: readonly StateRamp[]): RGB[] {
  return ramp.map((entry) => {
    const rgb = parseCssColor(entry.steady);
    if (!rgb) throw new Error(`not a colour: ${entry.steady}`);
    return rgb;
  });
}

describe.each([
  ['dark', DARK_STATE_RAMP],
  ['light', LIGHT_STATE_RAMP],
] as const)('Default theme %s ramp — distinguishable under CVD simulation (P1-E-3 AC2)', (_name, ramp) => {
  it('has 8 states', () => {
    expect(ramp).toHaveLength(8);
  });

  it.each(KINDS)('every pair of states stays separated under simulated %s', (kind) => {
    const simulated = steadyColors(ramp).map((rgb) => simulateColorBlindness(rgb, kind));
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

  it('every state is also distinct under ordinary (non-simulated) vision', () => {
    const colors = steadyColors(ramp);
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const a = colors[i];
        const b = colors[j];
        if (!a || !b) continue;
        expect(colorDistance(a, b)).toBeGreaterThan(0);
      }
    }
  });

  it("a state's born colour is lighter than its steady colour (the birth pop)", () => {
    for (const { born, steady } of ramp) {
      const bornRgb = parseCssColor(born)!;
      const steadyRgb = parseCssColor(steady)!;
      const luma = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      expect(luma(bornRgb)).toBeGreaterThanOrEqual(luma(steadyRgb));
    }
  });
});

describe('makeDefaultPalette', () => {
  const bg = '#0e0f11';
  const palette = makeDefaultPalette(DARK_AGE_TABLE, bg);
  const lastAge = AGE_RAMP_STEPS - 1;

  it('renders the dead state (0) as the background colour, at any age', () => {
    expect(palette(0, 0)).toBe(bg);
    expect(palette(0, 999)).toBe(bg);
  });

  it("renders a just-born cell (age <= 0) with its ramp's brighter born colour", () => {
    expect(palette(1, 0)).toBe(DARK_STATE_RAMP[0]?.born);
  });

  it('renders a settled cell at the last age step with its ramp colour', () => {
    expect(palette(1, lastAge)).toBe(DARK_STATE_RAMP[0]?.steady);
    expect(palette(1, 500)).toBe(DARK_STATE_RAMP[0]?.steady);
  });

  it('age is a real ramp: born, mid, and steady are distinct steps', () => {
    const born = palette(1, 0);
    const mid = palette(1, 4);
    const steady = palette(1, lastAge);
    expect(born).not.toBe(steady);
    expect(mid).not.toBe(born);
    expect(mid).not.toBe(steady);
  });

  it('maps each of the 8 live states to its own ramp entry', () => {
    for (let state = 1; state <= 8; state++) {
      expect(palette(state, lastAge)).toBe(DARK_STATE_RAMP[state - 1]?.steady);
    }
  });

  it('covers every builtin ruleset state id without wrapping collisions inside the catalogue', () => {
    const maxId = Math.max(...BUILTIN_RULESETS.map((rs) => rs.states.length - 1));
    expect(PALETTE_STATE_COUNT).toBeGreaterThanOrEqual(maxId);
    for (const rs of BUILTIN_RULESETS) {
      const colors = new Set<string>();
      for (const def of rs.states) {
        const hex = palette(def.id, lastAge);
        expect(typeof hex).toBe('string');
        if (def.id === 0) {
          expect(hex).toBe(bg);
          continue;
        }
        colors.add(hex);
      }
      const liveCount = rs.states.filter((s) => s.id !== 0).length;
      expect(colors.size, rs.id).toBe(liveCount);
    }
  });

  it('wraps rather than crashing for a state beyond the table, never a silent blank', () => {
    expect(() => palette(PALETTE_STATE_COUNT + 1, 1)).not.toThrow();
    expect(palette(PALETTE_STATE_COUNT + 1, lastAge)).toBe(DARK_STATE_RAMP[0]?.steady);
    expect(typeof palette(PALETTE_STATE_COUNT + 1, 1)).toBe('string');
  });

  it('is a pure array lookup: identical calls are referentially the same string', () => {
    expect(palette(3, 1)).toBe(palette(3, 1));
  });
});
