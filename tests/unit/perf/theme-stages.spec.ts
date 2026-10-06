import { describe, expect, it } from 'vitest';
import { THEME_IDS, createThemePassStack } from '@render/effects/library';
import { stagesForQuality } from '@render/effects/ctx';
import { STAGE_QUALITY, THEME_STAGES, type EffectStageName } from '../../perf/theme-stages';

const ORDER: readonly EffectStageName[] = ['background', 'effects', 'post'];

describe('browser-spec theme stage table (P3-E-1)', () => {
  it('lists exactly the themes the library ships', () => {
    expect(Object.keys(THEME_STAGES).sort()).toEqual([...THEME_IDS].sort());
  });

  it.each(THEME_IDS)('%s: table equals the stages of its real pass stack', (id) => {
    const stack = createThemePassStack(id);
    const actual = ORDER.filter((stage) => stack.some((pass) => pass.stage === stage));
    for (const pass of stack) pass.dispose();
    expect(THEME_STAGES[id]).toEqual(actual);
  });

  it('STAGE_QUALITY matches the governor ladder', () => {
    for (const stage of ORDER) {
      const q = STAGE_QUALITY[stage];
      expect(stagesForQuality(q)).toContain(stage);
      expect(stagesForQuality((q - 1) as 0 | 1 | 2)).not.toContain(stage);
    }
  });
});
