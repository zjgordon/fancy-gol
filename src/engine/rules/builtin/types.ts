/**
 * Built-in rulesets are ordinary {@link RuleSetDocument}s plus the tags (and
 * optional year) Phase 2's library UI will filter on. They validate and compile
 * with the same pipeline as a user-authored rule — there is no privileged path.
 */
import type { RuleSetDocument } from '../schema';

export type BuiltinTag = 'chaotic' | 'stable' | 'explosive' | 'maze-like' | 'multi-state';

export interface BuiltinRuleSet extends RuleSetDocument {
  readonly tags: readonly BuiltinTag[];
  readonly year?: number;
}
