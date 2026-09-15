/**
 * Default cell palette (P1-E-3 / P3-C-1) — OKLCH-derived, computed once at module load into
 * plain sRGB hex. `palette(state, age)` is a table lookup: no colour maths per call.
 *
 * Eight live hues (states 1–8) are CVD-tuned against both protanopia and deuteranopia. States
 * 9–24 cover Bloomerang's generations trail as a monotonic fade toward the canvas background —
 * a decay, not eight wrapping hues. Age is 16 precomputed steps from a 1-frame birth pop to
 * steady. The age buffer stays off for Default (performance reference); the ramp is still
 * exact when a caller passes age.
 */
import { oklch, toHex } from '@shared/color';
import type { CellPalette } from '@render/types';

interface StateColor {
  readonly L: number;
  readonly C: number;
  readonly H: number;
}

/** Tuned for a near-black backdrop (`DEFAULT_DARK_TOKENS.color.bg`). */
const DARK_LIVE: readonly StateColor[] = [
  { L: 0.5, C: 0.102, H: 267.9 },
  { L: 0.68, C: 0.19, H: 319.7 },
  { L: 0.549, C: 0.188, H: 33.5 },
  { L: 0.784, C: 0.168, H: 165.5 },
  { L: 0.732, C: 0.19, H: 126.2 },
  { L: 0.818, C: 0.12, H: 231.7 },
  { L: 0.891, C: 0.169, H: 63.8 },
  { L: 0.96, C: 0.05, H: 124.0 },
];

/** Tuned for a near-white backdrop (`DEFAULT_LIGHT_TOKENS.color.bg`). */
const LIGHT_LIVE: readonly StateColor[] = [
  { L: 0.15, C: 0.109, H: 264.4 },
  { L: 0.382, C: 0.168, H: 316.6 },
  { L: 0.29, C: 0.17, H: 27.7 },
  { L: 0.465, C: 0.132, H: 182.2 },
  { L: 0.564, C: 0.16, H: 62.3 },
  { L: 0.587, C: 0.122, H: 251.4 },
  { L: 0.646, C: 0.174, H: 135.9 },
  { L: 0.74, C: 0.073, H: 136.4 },
];

/** Bloomerang is 24 states (id 0..23). Live hues cover 1–8; the rest are decay. */
export const PALETTE_STATE_COUNT = 24;
export const AGE_RAMP_STEPS = 16;
const BIRTH_LIGHTNESS_BOOST = 0.12;
const MAX_LIGHTNESS = 0.98;

export interface StateRamp {
  readonly born: string;
  readonly steady: string;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function decayColors(dark: boolean, count: number): StateColor[] {
  const out: StateColor[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    out.push(
      dark
        ? { L: lerp(0.46, 0.2, t), C: lerp(0.04, 0.01, t), H: 255 }
        : { L: lerp(0.44, 0.74, t), C: lerp(0.045, 0.012, t), H: 255 },
    );
  }
  return out;
}

function birthColor(c: StateColor): StateColor {
  return { L: Math.min(MAX_LIGHTNESS, c.L + BIRTH_LIGHTNESS_BOOST), C: c.C, H: c.H };
}

function rampRow(born: StateColor, steady: StateColor): readonly string[] {
  const row: string[] = [];
  const last = AGE_RAMP_STEPS - 1;
  for (let i = 0; i < AGE_RAMP_STEPS; i++) {
    const t = i / last;
    row.push(toHex(oklch(lerp(born.L, steady.L, t), lerp(born.C, steady.C, t), steady.H)));
  }
  return row;
}

function buildTable(live: readonly StateColor[], dark: boolean): readonly (readonly string[])[] {
  const extra = decayColors(dark, PALETTE_STATE_COUNT - live.length);
  const colors = [...live, ...extra];
  return colors.map((steady) => rampRow(birthColor(steady), steady));
}

function rampsFromTable(table: readonly (readonly string[])[]): readonly StateRamp[] {
  const last = AGE_RAMP_STEPS - 1;
  return table.map((row) => ({
    born: row[0] ?? '#000000',
    steady: row[last] ?? '#000000',
  }));
}

export const DARK_AGE_TABLE: readonly (readonly string[])[] = buildTable(DARK_LIVE, true);
export const LIGHT_AGE_TABLE: readonly (readonly string[])[] = buildTable(LIGHT_LIVE, false);

/** Eight live `{born, steady}` pairs — CVD tests run on these. */
export const DARK_STATE_RAMP: readonly StateRamp[] = rampsFromTable(DARK_AGE_TABLE).slice(0, DARK_LIVE.length);

/** Same, for the light variant. */
export const LIGHT_STATE_RAMP: readonly StateRamp[] = rampsFromTable(LIGHT_AGE_TABLE).slice(0, LIGHT_LIVE.length);

/**
 * Allocation-free `CellPalette`. State 0 is always the canvas background. States wrap at
 * {@link PALETTE_STATE_COUNT} so a rule with more states still paints, never crashes.
 */
export function makeDefaultPalette(table: readonly (readonly string[])[], backgroundHex: string): CellPalette {
  const lastAge = AGE_RAMP_STEPS - 1;
  const n = table.length;
  return (state, age) => {
    if (state === 0) return backgroundHex;
    const row = table[(state - 1) % n];
    if (!row) return backgroundHex;
    const step = age <= 0 ? 0 : age >= lastAge ? lastAge : age | 0;
    return row[step] ?? backgroundHex;
  };
}
