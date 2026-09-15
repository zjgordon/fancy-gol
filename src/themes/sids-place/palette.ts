/**
 * Sids-Place cell palette (P3-C-4) — terrain on parchment. State 1 is liquid,
 * state 2 is highland (Highlands/Liquid from ADR-001). Eight live hues stay
 * distinguishable under protanopia and deuteranopia (Default's light CVD eight,
 * rotated so those two land first). Wear is the age ramp: fresh ink is darker,
 * old marks fade into the fibre. Table lookup only.
 */
import { oklch, toHex } from '@shared/color';
import type { CellPalette } from '@render/types';

interface StateColor {
  readonly L: number;
  readonly C: number;
  readonly H: number;
}

/**
 * Default's light-backdrop CVD eight, rotated so Conway/liquid is deep water
 * and Highlands' highland is ochre earth.
 */
const LIVE: readonly StateColor[] = [
  { L: 0.15, C: 0.109, H: 264.4 },
  { L: 0.564, C: 0.16, H: 62.3 },
  { L: 0.382, C: 0.168, H: 316.6 },
  { L: 0.29, C: 0.17, H: 27.7 },
  { L: 0.465, C: 0.132, H: 182.2 },
  { L: 0.587, C: 0.122, H: 251.4 },
  { L: 0.646, C: 0.174, H: 135.9 },
  { L: 0.74, C: 0.073, H: 136.4 },
];

export const PALETTE_STATE_COUNT = 24;
export const AGE_RAMP_STEPS = 16;
const MIN_LIGHTNESS = 0.12;

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
    out.push({ L: lerp(0.48, 0.72, t), C: lerp(0.05, 0.015, t), H: 70 });
  }
  return out;
}

/** Fresh ink: darker than the worn steady colour. */
function birthColor(c: StateColor): StateColor {
  return { L: Math.max(MIN_LIGHTNESS, c.L * 0.78), C: c.C, H: c.H };
}

function rampRow(born: StateColor, steady: StateColor): readonly string[] {
  const row: string[] = [];
  const last = AGE_RAMP_STEPS - 1;
  for (let i = 0; i < AGE_RAMP_STEPS; i++) {
    const t = i / last;
    row.push(
      toHex(oklch(lerp(born.L, steady.L, t), lerp(born.C, steady.C, t), lerp(born.H, steady.H, t))),
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
    born: row[0] ?? '#1a120c',
    steady: row[last] ?? '#8a6a40',
  }));
}

export const SIDS_AGE_TABLE: readonly (readonly string[])[] = buildTable();
export const SIDS_STATE_RAMP: readonly StateRamp[] = rampsFromTable(SIDS_AGE_TABLE).slice(0, LIVE.length);

export function makeSidsPalette(backgroundHex: string): CellPalette {
  const lastAge = AGE_RAMP_STEPS - 1;
  const n = SIDS_AGE_TABLE.length;
  return (state, age) => {
    if (state === 0) return backgroundHex;
    const row = SIDS_AGE_TABLE[(state - 1) % n];
    if (!row) return backgroundHex;
    const step = age <= 0 ? 0 : age >= lastAge ? lastAge : age | 0;
    return row[step] ?? backgroundHex;
  };
}
