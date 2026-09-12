/**
 * Builtin catalogue projected to the shape `ui/` may see (P2-G-1).
 */
import { BUILTIN_RULESETS } from '@engine/rules/builtin';
import type { RulesetSummary } from '@ui/components/ruleset-picker';

export function builtinRulesetSummaries(): readonly RulesetSummary[] {
  return BUILTIN_RULESETS.map((rs) => ({
    id: rs.id,
    name: rs.name,
    ...(rs.description !== undefined ? { description: rs.description } : {}),
    ...(rs.notation !== undefined ? { notation: rs.notation } : {}),
    states: rs.states,
    tags: rs.tags,
  }));
}

export function userRulesetSummary(doc: {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly states: RulesetSummary['states'];
  readonly notation?: string;
  readonly tags?: readonly string[];
}): RulesetSummary {
  return {
    id: doc.id,
    name: doc.name,
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    ...(doc.notation !== undefined ? { notation: doc.notation } : {}),
    states: doc.states,
    tags: doc.tags && doc.tags.length > 0 ? doc.tags : ['yours'],
    origin: 'user',
  };
}
