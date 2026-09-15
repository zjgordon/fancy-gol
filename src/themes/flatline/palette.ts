/**
 * Flatline cell palette (P3-C-3) — phosphor flash on birth, then the tube's hue.
 * Eight live hues stay distinguishable under protanopia and deuteranopia (the
 * Default CVD eight, with Conway's live cell rotated to amber-gold). States
 * 9–24 are a generations decay trail in the active phosphor. Table lookup only.
 */
import { oklch, toHex } from '@shared/color';
import type { CellPalette } from '@render/types';
import { phosphorHue, type PhosphorKind } from './tokens';

interface StateColor {
  readonly L: number;
  readonly C: number;
  readonly H: number;
}

/**
 * Same eight CVD-spaced hues as Default, rotated so state 1 is amber-gold —
 * the phosphor the theme is about — without collapsing multi-state rules.
 */
const LIVE: readonly StateColor[] = [
  { L: 0.891, C: 0.169, H: 63.8 },
  { L: 0.68, C: 0.19, H: 319.7 },
  { L: 0.549, C: 0.188, H: 33.5 },
  { L: 0.5, C: 0.102, H: 267.9 },
  { L: 0.732, C: 0.19, H: 126.2 },
  { L: 0.818, C: 0.12, H: 231.7 },
  { L: 0.784, C: 0.168, H: 165.5 },
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

function decayColors(count: number, hue: number): StateColor[] {
  const out: StateColor[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    out.push({ L: lerp(0.42, 0.14, t), C: lerp(0.08, 0.02, t), H: hue });
  }
  return out;
}

/** Phosphor spike: high L, low C, then the ramp carries into the steady colour. */
function birthColor(c: StateColor): StateColor {
  return { L: MAX_LIGHTNESS, C: Math.max(0.02, c.C * 0.12), H: c.H };
}

function rampRow(born: StateColor, steady: StateColor): readonly string[] {
  const row: string[] = [];
  const last = AGE_RAMP_STEPS - 1;
  for (let i = 0; i < AGE_RAMP_STEPS; i++) {
    const t = i / last;
    row.push(
      toHex(
        oklch(
          lerp(born.L, steady.L, t),
          lerp(born.C, steady.C, t),
          lerp(born.H, steady.H, t),
        ),
      ),
    );
  }
  return row;
}

function buildTable(hue: number): readonly (readonly string[])[] {
  const colors = [...LIVE, ...decayColors(PALETTE_STATE_COUNT - LIVE.length, hue)];
  return colors.map((steady) => rampRow(birthColor(steady), steady));
}

function rampsFromTable(table: readonly (readonly string[])[]): readonly StateRamp[] {
  const last = AGE_RAMP_STEPS - 1;
  return table.map((row) => ({
    born: row[0] ?? '#ffffff',
    steady: row[last] ?? '#3a2800',
  }));
}

const TABLE_CACHE = new Map<PhosphorKind, readonly (readonly string[])[]>();

export function flatlineAgeTable(kind: PhosphorKind = 'amber'): readonly (readonly string[])[] {
  let table = TABLE_CACHE.get(kind);
  if (!table) {
    table = buildTable(phosphorHue(kind));
    TABLE_CACHE.set(kind, table);
  }
  return table;
}

export const FLATLINE_AGE_TABLE: readonly (readonly string[])[] = flatlineAgeTable('amber');
export const FLATLINE_STATE_RAMP: readonly StateRamp[] = rampsFromTable(FLATLINE_AGE_TABLE).slice(
  0,
  LIVE.length,
);

export function makeFlatlinePalette(
  backgroundHex: string,
  kind: PhosphorKind = 'amber',
): CellPalette {
  const table = flatlineAgeTable(kind);
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
