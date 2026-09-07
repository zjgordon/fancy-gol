/**
 * The built-in ruleset catalogue. Every entry is a complete, validated,
 * compilable `RuleSetDocument` plus the tags Phase 2's library will filter on.
 */
import { BRIANS_BRAIN } from './brians-brain.js';
import { BLOOMERANG, STAR_WARS } from './generations.js';
import { HIGHLANDS_LIQUID } from './highlands.js';
import { LIFE_FAMILY } from './life.js';
import type { BuiltinRuleSet } from './types.js';
import { WIREWORLD } from './wireworld.js';

export const BUILTIN_RULESETS: readonly BuiltinRuleSet[] = [
  ...LIFE_FAMILY,
  BRIANS_BRAIN,
  WIREWORLD,
  STAR_WARS,
  BLOOMERANG,
  HIGHLANDS_LIQUID,
];

const BY_ID = new Map(BUILTIN_RULESETS.map((rs) => [rs.id, rs]));

/** Lookup a builtin by its stable `id`, or `undefined` if it is not in the catalogue. */
export function getBuiltin(id: string): BuiltinRuleSet | undefined {
  return BY_ID.get(id);
}

export type { BuiltinRuleSet, BuiltinTag } from './types.js';
export { BRIANS_BRAIN } from './brians-brain.js';
export { BLOOMERANG, STAR_WARS } from './generations.js';
export {
  HIGHLANDS_GENERATIONS,
  HIGHLANDS_HEIGHT,
  HIGHLANDS_LIQUID,
  HIGHLANDS_SEED,
  HIGHLANDS_WIDTH,
} from './highlands.js';
export {
  CONWAY,
  DAY_AND_NIGHT,
  DIAMOEBA,
  HIGHLIFE,
  LIFE_WITHOUT_DEATH,
  MAZE,
  REPLICATOR,
  SEEDS,
  TWO_BY_TWO,
} from './life.js';
export { generateWireWorldTable, WIREWORLD, wireWorldNext } from './wireworld.js';
