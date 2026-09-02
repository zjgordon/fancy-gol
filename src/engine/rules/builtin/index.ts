/**
 * The built-in ruleset catalogue. Every entry is a complete, validated,
 * compilable `RuleSetDocument` plus the tags Phase 2's library will filter on.
 */
import { BRIANS_BRAIN } from './brians-brain';
import { BLOOMERANG, STAR_WARS } from './generations';
import { HIGHLANDS_LIQUID } from './highlands';
import { LIFE_FAMILY } from './life';
import type { BuiltinRuleSet } from './types';
import { WIREWORLD } from './wireworld';

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

export type { BuiltinRuleSet, BuiltinTag } from './types';
export { BRIANS_BRAIN } from './brians-brain';
export { BLOOMERANG, STAR_WARS } from './generations';
export {
  HIGHLANDS_GENERATIONS,
  HIGHLANDS_HEIGHT,
  HIGHLANDS_LIQUID,
  HIGHLANDS_SEED,
  HIGHLANDS_WIDTH,
} from './highlands';
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
} from './life';
export { generateWireWorldTable, WIREWORLD, wireWorldNext } from './wireworld';
