import { describe, expect, it } from 'vitest';
import { BUILTIN_RULESETS } from '@engine/rules/builtin';
import { builtinRulesetSummaries } from '@client/ruleset-summaries';

describe('builtinRulesetSummaries', () => {
  it('projects every builtin without leaking engine-only fields', () => {
    const summaries = builtinRulesetSummaries();
    expect(summaries).toHaveLength(BUILTIN_RULESETS.length);
    expect(summaries[0]?.id).toBe(BUILTIN_RULESETS[0]?.id);
    expect(summaries[0]).toHaveProperty('states');
    expect(summaries[0]).not.toHaveProperty('transition');
  });
});
