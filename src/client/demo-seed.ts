/**
 * The curated cold-start world (P2-G-1, extracted from the composition root).
 * Reset-to-seed paints this gun in the *active* ruleset's primary live state.
 */
import type { PaintOp, RuleSet, StateId } from '@shared/types';

export const WORLD_WIDTH = 256;
export const WORLD_HEIGHT = 192;
export const SEED = 0xc0ffee;
export const RUN_TPS = 30;
/** The cold-start camera move's duration — the phase doc's own "~1.2 s" figure. */
export const INTRO_CAMERA_MS = 1200;
/** Wide shot: the whole curated world, generously padded. */
export const WIDE_SHOT_RECT = { x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT };
/** Framed: a tighter crop around the gun and the space its early gliders cross. */
export const FRAMED_RECT = { x: -10, y: -10, width: 150, height: 115 };

/** LifeWiki's canonical Gosper glider gun RLE, decoded by hand: 36 live cells, x=0..35, y=0..8. */
export const GOSPER_GUN: ReadonlyArray<readonly [number, number]> = [
  [24, 0],
  [22, 1],
  [24, 1],
  [12, 2],
  [13, 2],
  [20, 2],
  [21, 2],
  [34, 2],
  [35, 2],
  [11, 3],
  [15, 3],
  [20, 3],
  [21, 3],
  [34, 3],
  [35, 3],
  [0, 4],
  [1, 4],
  [10, 4],
  [16, 4],
  [20, 4],
  [21, 4],
  [0, 5],
  [1, 5],
  [10, 5],
  [14, 5],
  [16, 5],
  [17, 5],
  [22, 5],
  [24, 5],
  [10, 6],
  [16, 6],
  [24, 6],
  [11, 7],
  [15, 7],
  [12, 8],
  [13, 8],
];

/** Paints the curated gun in `state` (the active ruleset's primary live state). */
export function gunOps(originX: number, originY: number, state: StateId): PaintOp[] {
  return GOSPER_GUN.map(([x, y]) => ({ x: x + originX, y: y + originY, state }));
}

/** First `countsAsAlive` state, or `1` if a ruleset somehow has none. */
export function primaryLiveState(rs: RuleSet): StateId {
  return rs.states.find((s) => s.countsAsAlive)?.id ?? 1;
}
