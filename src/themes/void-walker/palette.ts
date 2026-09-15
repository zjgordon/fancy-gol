/**
 * Void-Walker cell palette (P3-C-5) — newborn cells flare white-violet, then
 * settle to a cool purple whose intensity falls with age. Eight live hues stay
 * distinguishable under protanopia and deuteranopia (Default's dark CVD eight,
 * Conway already violet). Table lookup only.
 */
import { oklch, toHex } from '@shared/color';
import type { CellPalette } from '@render/types';

interface StateColor {
  readonly L: number;
  readonly C: number;
  readonly H: number;
}

/** Default's dark-backdrop CVD eight — state 1 is already the violet Conway cell. */
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
    out.push({ L: lerp(0.42, 0.14, t), C: lerp(0.08, 0.02, t), H: 280 });
  }
  return out;
}

/** White-violet flare: high L, low C, hue pulled toward 300°. */
function birthColor(c: StateColor): StateColor {
  return { L: MAX_LIGHTNESS, C: Math.max(0.03, c.C * 0.22), H: lerp(c.H, 300, 0.45) };
}

function rampRow(born: StateColor, steady: StateColor): readonly string[] {
  const row: string[] = [];
  const last = AGE_RAMP_STEPS - 1;
  for (let i = 0; i < AGE_RAMP_STEPS; i++) {
    const t = i / last;
    const hueT = t < 0.4 ? t / 0.4 : 1;
    row.push(
      toHex(
        oklch(
          lerp(born.L, steady.L, t),
          lerp(born.C, steady.C, t),
          lerp(born.H, steady.H, hueT),
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
    born: row[0] ?? '#f4edff',
    steady: row[last] ?? '#3a2060',
  }));
}

export const VOID_AGE_TABLE: readonly (readonly string[])[] = buildTable();
export const VOID_STATE_RAMP: readonly StateRamp[] = rampsFromTable(VOID_AGE_TABLE).slice(0, LIVE.length);

export function makeVoidPalette(backgroundHex: string): CellPalette {
  const lastAge = AGE_RAMP_STEPS - 1;
  const n = VOID_AGE_TABLE.length;
  return (state, age) => {
    if (state === 0) return backgroundHex;
    const row = VOID_AGE_TABLE[(state - 1) % n];
    if (!row) return backgroundHex;
    const step = age <= 0 ? 0 : age >= lastAge ? lastAge : age | 0;
    return row[step] ?? backgroundHex;
  };
}
