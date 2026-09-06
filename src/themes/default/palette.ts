/**
 * The Default theme's 8-state cell palette (P1-E-3) — OKLCH-derived, computed once at module
 * load into plain sRGB hex (`shared/color.ts`'s `oklch`/`toHex`; "no colour library at runtime").
 * "Computed at build time" in this project has no generalised meaning outside
 * `scripts/gen-thumbnails.mjs`'s narrow pattern-thumbnail case, so this is the honest equivalent
 * available today: the OKLCH→sRGB conversion runs exactly once, when this module is evaluated,
 * producing the same plain hex strings a real build-time codegen step would — `palette()` itself
 * never touches `oklch`/`toHex` per call, per state, or per frame.
 *
 * Lightness is the *primary* channel separating the eight states, hue the secondary one — plain
 * hue rotation (evenly spaced around the wheel) is exactly what collapses under red-green colour
 * vision deficiency, since several hues on the wheel sit on the very axis protanopia/deuteranopia
 * removes. Both `DARK_STATE_COLORS` and `LIGHT_STATE_COLORS` were tuned (random search over
 * lightness/chroma/hue, maximising the worst-case pairwise distance after simulating both
 * conditions with `shared/color.ts`'s `simulateColorBlindness`) until the *weakest* pair under
 * either simulation cleared a wide margin — verified in
 * `tests/unit/themes/default/palette.spec.ts` (this task's second acceptance criterion), not
 * merely asserted here.
 */
import { oklch, toHex } from '@shared/color';
import type { CellPalette } from '@render/types';

interface StateColor {
  readonly L: number;
  readonly C: number;
  readonly H: number;
}

/** Tuned for a near-black backdrop (`DEFAULT_DARK_TOKENS.color.bg`): lightness climbs from 0.50
 * to 0.96 so every state reads clearly against the dark canvas. */
const DARK_STATE_COLORS: readonly StateColor[] = [
  { L: 0.5, C: 0.102, H: 267.9 },
  { L: 0.68, C: 0.19, H: 319.7 },
  { L: 0.549, C: 0.188, H: 33.5 },
  { L: 0.784, C: 0.168, H: 165.5 },
  { L: 0.732, C: 0.19, H: 126.2 },
  { L: 0.818, C: 0.12, H: 231.7 },
  { L: 0.891, C: 0.169, H: 63.8 },
  { L: 0.96, C: 0.05, H: 124.0 },
];

/** Tuned for a near-white backdrop (`DEFAULT_LIGHT_TOKENS.color.bg`): lightness stays in 0.15-0.65
 * so every state reads clearly against the light canvas. */
const LIGHT_STATE_COLORS: readonly StateColor[] = [
  { L: 0.15, C: 0.109, H: 264.4 },
  { L: 0.382, C: 0.168, H: 316.6 },
  { L: 0.29, C: 0.17, H: 27.7 },
  { L: 0.465, C: 0.132, H: 182.2 },
  { L: 0.564, C: 0.16, H: 62.3 },
  { L: 0.587, C: 0.122, H: 251.4 },
  { L: 0.646, C: 0.174, H: 135.9 },
  { L: 0.74, C: 0.073, H: 136.4 },
];

/** How much lighter a just-born cell's OKLCH `L` is than its steady-state colour, for the
 * implementation note's "1-frame birth brightness pop". Clamped so a state already near maximum
 * lightness (state 8) doesn't try to exceed white. */
const BIRTH_LIGHTNESS_BOOST = 0.12;
const MAX_LIGHTNESS = 0.98;

export interface StateRamp {
  readonly born: string;
  readonly steady: string;
}

function buildRamp(colors: readonly StateColor[]): readonly StateRamp[] {
  return colors.map(({ L, C, H }) => ({
    steady: toHex(oklch(L, C, H)),
    born: toHex(oklch(Math.min(MAX_LIGHTNESS, L + BIRTH_LIGHTNESS_BOOST), C, H)),
  }));
}

/** The eight `{born, steady}` hex pairs for the dark variant, computed once at import time.
 * Exported so `palette.spec.ts` can run the colourblindness check directly against these values. */
export const DARK_STATE_RAMP: readonly StateRamp[] = buildRamp(DARK_STATE_COLORS);

/** Same, for the light variant. */
export const LIGHT_STATE_RAMP: readonly StateRamp[] = buildRamp(LIGHT_STATE_COLORS);

/**
 * Builds a `CellPalette` (`render/types.ts`'s `(state, age) => string`) over a precomputed ramp:
 * a plain array index per call, no allocation, no colour maths — this is what "it must be the
 * fastest theme" (this task's third acceptance criterion) actually rests on structurally.
 * `state` 0 (dead) always renders as `backgroundHex`, matching the existing convention
 * `client/main.ts`'s own thumbnail renderer already uses. A state beyond the ramp's length wraps
 * rather than throwing mid-frame — a rule with more live states than this theme anticipated still
 * gets *a* legible colour, never a crash (this project's "failure mode is a legible message, never
 * a silent no-op" standard, applied to the one case that's a rendering concern, not an error).
 */
export function makeDefaultPalette(ramp: readonly StateRamp[], backgroundHex: string): CellPalette {
  return (state, age) => {
    if (state === 0) return backgroundHex;
    const entry = ramp[(state - 1) % ramp.length];
    if (!entry) return backgroundHex;
    return age <= 0 ? entry.born : entry.steady;
  };
}
