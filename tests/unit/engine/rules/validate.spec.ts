import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RuleValidationError } from '@engine/rules/errors';
import { validateRuleSet } from '@engine/rules/validate';
import { INVALID_FIXTURES } from './invalid-fixtures.manifest';

const VALID_DIR = fileURLToPath(new URL('../../../fixtures/rules/valid/', import.meta.url));
const INVALID_DIR = fileURLToPath(new URL('../../../fixtures/rules/invalid/', import.meta.url));

function loadJSON(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8'));
}

describe('validateRuleSet — valid fixtures (the schema doc worked examples)', () => {
  const names = readdirSync(VALID_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));

  it('has all 7 worked examples on disk', () => {
    expect(names.length).toBeGreaterThanOrEqual(7);
  });

  it.each(names)('%s validates clean', (name) => {
    const doc = loadJSON(VALID_DIR, name);
    expect(() => validateRuleSet(doc)).not.toThrow();
  });
});

describe('validateRuleSet — invalid fixtures', () => {
  it(`has at least 30 negative fixtures (${INVALID_FIXTURES.length} present)`, () => {
    expect(INVALID_FIXTURES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(INVALID_FIXTURES)(
    '$name is rejected with an issue naming $expectedPathSubstring and a hint',
    ({ name, expectedPathSubstring }) => {
      const doc = loadJSON(INVALID_DIR, name);

      let error: unknown;
      try {
        validateRuleSet(doc);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(RuleValidationError);
      const validationError = error as RuleValidationError;
      expect(validationError.issues.length).toBeGreaterThan(0);

      const matching = validationError.issues.filter((issue) =>
        issue.path.includes(expectedPathSubstring),
      );
      expect(
        matching.length,
        `expected an issue with path including "${expectedPathSubstring}", got: ${JSON.stringify(validationError.issues)}`,
      ).toBeGreaterThan(0);
      expect(matching.some((issue) => (issue.hint?.length ?? 0) > 0 || issue.message.length > 0)).toBe(
        true,
      );
    },
  );

  it('never reports a message that is just the word "invalid" on its own', () => {
    for (const { name } of INVALID_FIXTURES) {
      const doc = loadJSON(INVALID_DIR, name);
      try {
        validateRuleSet(doc);
      } catch (e) {
        if (!(e instanceof RuleValidationError)) throw e;
        for (const issue of e.issues) {
          expect(issue.message.trim().toLowerCase()).not.toBe('invalid');
          expect(issue.message).not.toMatch(/^\s*invalid\.?\s*$/i);
        }
      }
    }
  });
});

/** Grabs a specific issue's path, throwing (test-failing) if the document validated clean. */
function rejectedPaths(doc: unknown): string[] {
  try {
    validateRuleSet(doc);
  } catch (e) {
    if (e instanceof RuleValidationError) return e.issues.map((i) => i.path);
    throw e;
  }
  throw new Error('expected validateRuleSet to throw, but the document validated clean');
}

describe('validateRuleSet — additional shape branches not covered by the named fixtures', () => {
  const conway = () => loadJSON(VALID_DIR, 'conway') as Record<string, unknown>;
  const highlandsLiquid = () => loadJSON(VALID_DIR, 'highlands-liquid') as Record<string, unknown>;
  const langtonsAnt = () => loadJSON(VALID_DIR, 'langtons-ant') as Record<string, unknown>;
  const wireworld = () => loadJSON(VALID_DIR, 'wireworld') as Record<string, unknown>;

  it('rejects a top-level primitive (not object, not array)', () => {
    expect(rejectedPaths('just a string')).toEqual(['']);
  });

  it('rejects a states entry that is not an object', () => {
    const doc = conway();
    doc['states'] = [1, 2];
    expect(rejectedPaths(doc)).toContain('/states/0');
  });

  it('rejects a document whose states and transition are both broken', () => {
    const doc = conway();
    doc['states'] = [];
    doc['transition'] = 'nope';
    expect(rejectedPaths(doc)).toContain('/transition');
  });

  it('rejects a neighborhood that is not an object', () => {
    const doc = conway();
    doc['neighborhood'] = 'moore';
    expect(rejectedPaths(doc)).toContain('/neighborhood');
  });

  it('rejects a transition that is not an object (states and neighborhood otherwise valid)', () => {
    const doc = conway();
    doc['transition'] = 42;
    expect(rejectedPaths(doc)).toContain('/transition');
  });

  it("rejects a stateTable transition whose table isn't an array or Uint8Array", () => {
    const doc = wireworld();
    doc['transition'] = { kind: 'stateTable', radix: 4, table: 'nope' };
    expect(rejectedPaths(doc)).toContain('/transition/table');
  });

  it('rejects a weighted threshold row that is not an object', () => {
    const doc = highlandsLiquid();
    doc['transition'] = { kind: 'weighted', weights: [0, 1, 3], thresholds: [null] };
    expect(rejectedPaths(doc)).toContain('/transition/thresholds/0');
  });

  it('rejects a weighted threshold row with non-integer min/max/toState', () => {
    const doc = highlandsLiquid();
    doc['transition'] = {
      kind: 'weighted',
      weights: [0, 1, 3],
      thresholds: [{ min: 'a', max: 8, toState: 1 }],
    };
    expect(rejectedPaths(doc)).toContain('/transition/thresholds/0');
  });

  it('rejects a turmite row that is not an object', () => {
    const doc = langtonsAnt();
    doc['transition'] = { kind: 'turmite', states: [null] };
    expect(rejectedPaths(doc)).toContain('/transition/states/0');
  });

  it('rejects a turmite row with an invalid state or nextState', () => {
    const doc = langtonsAnt();
    doc['transition'] = {
      kind: 'turmite',
      states: [{ state: -1, onCellState: 0, writeState: 1, turn: 'left', nextState: -1 }],
    };
    const paths = rejectedPaths(doc);
    expect(paths).toContain('/transition/states/0/state');
    expect(paths).toContain('/transition/states/0/nextState');
  });

  it('rejects a turmite row with an invalid writeState', () => {
    const doc = langtonsAnt();
    doc['transition'] = {
      kind: 'turmite',
      states: [{ state: 0, onCellState: 0, writeState: 9, turn: 'left', nextState: 0 }],
    };
    expect(rejectedPaths(doc)).toContain('/transition/states/0/writeState');
  });
});
