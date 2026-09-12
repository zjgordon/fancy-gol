import { describe, expect, it } from 'vitest';
import { builtinRulesetSummaries, userRulesetSummary } from '@client/ruleset-summaries';
import { CONWAY } from '@engine/rules/builtin';

describe('ruleset summaries', () => {
  it('projects builtins and tags a user document as yours', () => {
    expect(builtinRulesetSummaries().some((e) => e.id === 'conway')).toBe(true);
    const summary = userRulesetSummary({
      id: 'user:spark',
      name: 'Spark',
      description: 'A tiny rule',
      states: CONWAY.states,
      notation: 'B3/S23',
    });
    expect(summary.origin).toBe('user');
    expect(summary.tags).toEqual(['yours']);
    expect(summary.notation).toBe('B3/S23');
  });
});
