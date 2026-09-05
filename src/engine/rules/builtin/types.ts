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
  /** The Life-family B/S(/G) notation this rule was defined from, e.g. `"B3/S23"` — present only
   * for `fromNotation()`-built rules (P1-D-4's ruleset picker shows it when available; a
   * state-table/weighted-threshold rule like WireWorld or Highlands/Liquid has no such notation
   * and leaves this undefined rather than fabricate one). */
  readonly notation?: string;
}
