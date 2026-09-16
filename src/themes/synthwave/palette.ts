/**
 * Synthwave cell palette (P3-C-6) — neon cells whose age walks toward cyan.
 * Eight live hues stay distinguishable under protanopia and deuteranopia
 * (this theme is the "everything is pink" risk — CVD spacing is load-bearing).
 * Table lookup only.
 */
import { oklch, toHex } from '@shared/color';
import type { CellPalette } from '@render/types';

interface StateColor {
  readonly L: number;
  readonly C: number;
  readonly H: number;
}

/**
 * Steady colours: Default's dark CVD eight verbatim (proven under protanopia /
 * deuteranopia). Birth pulls hue toward magenta; the ramp walks back to these
 * steadies so age still reads as a light show without collapsing to pink.
 */
const LIVE: readonly StateColor[] = [
  { L: 0.5, C: 0.102, H: 267.9 },
  { L: 0.68, C: 0.19, H: 319.7 },
  { L: 0.549, C: 0.188, H: 33.5 },
  { L: 0.784, C: 0.168, H: 165.5 },
  { L: 0.732, C: 0.19, H: 126.2 },
  { L: 0.818, C: 0.12, H: 231.7 },
  { L: 0.891, C: 0.169, H: 63.8 },
  { L: 0.96, C: 0.05, H: 124.0 },
];

export const PALETTE_STATE_COUNT = 24;
export const AGE_RAMP_STEPS = 16;
const MAX_LIGHTNESS = 0.98;
/** Birth hues sit this many degrees toward magenta from their steady colour. */
export const AGE_HUE_SWING = 100;

export interface StateRamp {
  readonly born: string;
  readonly steady: string;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function decayColors(count: number): StateColor[] {
  const out: StateColor[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    out.push({ L: lerp(0.4, 0.14, t), C: lerp(0.1, 0.03, t), H: lerp(320, 200, t) });
  }
  return out;
}

/** Hot neon birth: high L, lower chroma (avoids sRGB clip), hue toward magenta. */
function birthColor(c: StateColor): StateColor {
  return {
    L: MAX_LIGHTNESS,
    C: Math.min(0.11, Math.max(0.05, c.C * 0.45)),
    H: (c.H - AGE_HUE_SWING + 360) % 360,
  };
}

function rampRow(born: StateColor, steady: StateColor): readonly string[] {
  const row: string[] = [];
  const last = AGE_RAMP_STEPS - 1;
  for (let i = 0; i < AGE_RAMP_STEPS; i++) {
    const t = i / last;
    // Shortest-path hue lerp so the magenta→cyan walk never jumps the long way.
    let dH = steady.H - born.H;
    if (dH > 180) dH -= 360;
    if (dH < -180) dH += 360;
    row.push(
      toHex(
        oklch(
          lerp(born.L, steady.L, t),
          lerp(born.C, steady.C, t),
          (born.H + dH * t + 360) % 360,
        ),
      ),
    );
  }
  return row;
}

function buildTable(): readonly (readonly string[])[] {
  const colors = [...LIVE, ...decayColors(PALETTE_STATE_COUNT - LIVE.length)];
  return colors.map((steady) => rampRow(birthColor(steady), steady));
}

function rampsFromTable(table: readonly (readonly string[])[]): readonly StateRamp[] {
  const last = AGE_RAMP_STEPS - 1;
  return table.map((row) => ({
    born: row[0] ?? '#ff7aee',
    steady: row[last] ?? '#2ee6d6',
  }));
}

export const SYNTH_AGE_TABLE: readonly (readonly string[])[] = buildTable();
export const SYNTH_STATE_RAMP: readonly StateRamp[] = rampsFromTable(SYNTH_AGE_TABLE).slice(0, LIVE.length);

export function makeSynthPalette(backgroundHex: string): CellPalette {
  const lastAge = AGE_RAMP_STEPS - 1;
  const n = SYNTH_AGE_TABLE.length;
  return (state, age) => {
    if (state === 0) return backgroundHex;
    const row = SYNTH_AGE_TABLE[(state - 1) % n];
    if (!row) return backgroundHex;
    const step = age <= 0 ? 0 : age >= lastAge ? lastAge : age | 0;
    return row[step] ?? backgroundHex;
  };
}
