import { describe, expect, it } from 'vitest';
import { validateRuleSet } from '@engine/rules/validate';
import {
  applyBornSurvive,
  applyNotation,
  DEFAULT_RANDOMISE,
  documentFromUnknown,
  emptyLifeDocument,
  formatNotation,
  guessTemperament,
  mergeDocument,
  mulberry32,
  parseNotation,
  randomiseDocument,
  temperamentLine,
  toggleCount,
  viewsAgree,
} from '@ui/panels/ruleset-studio/model';

const CONWAY = emptyLifeDocument();

describe('notation', () => {
  it('round-trips Conway and HighLife, including a von Neumann suffix', () => {
    expect(formatNotation(CONWAY)).toBe('B3/S23');
    expect(parseNotation('B36/S23')).toEqual({
      born: [3, 6],
      survive: [2, 3],
      generations: null,
      suffix: null,
    });
    const high = applyNotation(CONWAY, 'B36/S23');
    expect(high?.transition.born).toEqual([3, 6]);
    expect(formatNotation(high!)).toBe('B36/S23');
    const vn = applyNotation(CONWAY, 'B2/S34V');
    expect(vn?.neighborhood).toEqual({ kind: 'vonNeumann', radius: 1 });
    expect(formatNotation(vn!)).toBe('B2/S34V');
  });

  it('rejects Hensel and empty strings', () => {
    expect(parseNotation('B2ci/S12')).toBeNull();
    expect(parseNotation('')).toBeNull();
  });
});

describe('viewsAgree', () => {
  it('holds after chip, notation, and JSON edits of the same HighLife change', () => {
    const fromChips = applyBornSurvive(CONWAY, 'born', toggleCount(CONWAY.transition.born, 6));
    const fromNotation = applyNotation(CONWAY, 'B36/S23')!;
    const fromJson = documentFromUnknown(
      mergeDocument(CONWAY, applyBornSurvive(CONWAY, 'born', [3, 6])),
    )!;
    expect(formatNotation(fromChips)).toBe('B36/S23');
    expect(formatNotation(fromNotation)).toBe('B36/S23');
    expect(formatNotation(fromJson)).toBe('B36/S23');
    expect(viewsAgree(fromChips, 'B36/S23', mergeDocument({}, fromJson))).toBe(true);
  });
});

describe('randomiseDocument', () => {
  it('produces a valid, compilable ruleset 100 times out of 100', () => {
    for (let i = 0; i < 100; i++) {
      const doc = randomiseDocument(CONWAY, DEFAULT_RANDOMISE, mulberry32(i + 1));
      expect(() => validateRuleSet(mergeDocument({}, doc))).not.toThrow();
      expect(doc.transition.born.every((n) => n >= 0 && n <= 8)).toBe(true);
      expect(doc.transition.survive.every((n) => n >= 0 && n <= 8)).toBe(true);
    }
  });

  it('guesses a temperament the catalogue would recognise', () => {
    expect(guessTemperament(CONWAY)).toBe('stable');
    expect(temperamentLine('explosive')).toContain('explosive');
    const seeds = applyNotation(CONWAY, 'B2/S')!;
    expect(guessTemperament(seeds)).toBe('explosive');
  });
});
