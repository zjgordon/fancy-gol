/**
 * Highlands / Liquid — the inception document's "Rule-God Status" weighted
 * terrain example. Neighbour sums (highlands weigh 3, liquid 1) pick the next
 * state independently of the cell's own state; random soup settles into
 * land/water banding. Highland's floor is 15 so a straight land/water wall is
 * stable: the liquid-side cell sees sum 14 (3 highland + 5 liquid) and stays
 * liquid; the 11–24 floor of an earlier draft let highland eat the boundary.
 */
import { SCHEMA_VERSION } from '../schema';
import type { BuiltinRuleSet } from './types';

export const HIGHLANDS_LIQUID: BuiltinRuleSet = {
  version: SCHEMA_VERSION,
  id: 'highlands-liquid',
  name: 'Highlands / Liquid',
  description:
    "A weighted terrain rule: every cell's next state is decided by the weighted sum of its neighbours (highlands count for more than liquid), independent of the cell's own current state. From random noise this settles into recognisable land/water banding.",
  states: [
    { id: 0, name: 'void', kind: 'dead', countsAsAlive: false },
    { id: 1, name: 'liquid', kind: 'live', countsAsAlive: true },
    { id: 2, name: 'highland', kind: 'live', countsAsAlive: true },
  ],
  neighborhood: { kind: 'moore', radius: 1 },
  transition: {
    kind: 'weighted',
    weights: [0, 1, 3],
    thresholds: [
      { min: 0, max: 6, toState: 0 },
      { min: 7, max: 14, toState: 1 },
      { min: 15, max: 24, toState: 2 },
    ],
  },
  boundary: 'toroidal',
  tags: ['multi-state', 'stable'],
};

/**
 * Documented soup seed for the banding demonstration. `Mulberry32(HIGHLANDS_SEED)`
 * filling a 32×32 torus: void/liquid/highland with probabilities 1/4, 3/8, 3/8.
 * After 200 generations the same-state Moore-edge fraction rises above the
 * random-soup baseline — land and water have banded.
 */
export const HIGHLANDS_SEED = 0x51eed;
export const HIGHLANDS_WIDTH = 32;
export const HIGHLANDS_HEIGHT = 32;
export const HIGHLANDS_GENERATIONS = 200;
