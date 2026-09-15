/**
 * Hand-drawn tile irregularity (P3-C-4). Deterministic in world coordinates so
 * panning away and back cannot shimmer — the same cell is always the same wobble.
 */
import type { CellTileShape } from '@render/types';

/** Inset / offset as a fraction of one cell. */
const INSET_SPAN = 0.16;
const OFFSET_SPAN = 0.07;

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return h >>> 0;
}

export function sidsTileShape(x: number, y: number): CellTileShape {
  const h = hash2(x, y);
  const u = (h & 1023) / 1023;
  const v = ((h >>> 10) & 1023) / 1023;
  const w = ((h >>> 20) & 1023) / 1023;
  return {
    inset: u * INSET_SPAN,
    ox: (v - 0.5) * 2 * OFFSET_SPAN,
    oy: (w - 0.5) * 2 * OFFSET_SPAN,
  };
}
