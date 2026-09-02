import { describe, expect, it } from 'vitest';
import { RuleValidationError } from '@engine/rules/errors';
import { formatRuleNotation, parseRuleNotation } from '@engine/rules/parse';
import type { Neighborhood, RuleSet } from '@engine/types';

interface Expected {
  born: number[];
  survive: number[];
  states?: number; // omit for plain totalistic (2)
  neighborhood?: Neighborhood;
}

const MOORE: Neighborhood = { kind: 'moore', radius: 1 };
const VN: Neighborhood = { kind: 'vonNeumann', radius: 1 };
const HEX: Neighborhood = { kind: 'hex' };

const CASES: Array<[string, Expected]> = [
  ['B3/S23', { born: [3], survive: [2, 3] }],
  ['b3/s23', { born: [3], survive: [2, 3] }],
  ['B3/S23V', { born: [3], survive: [2, 3], neighborhood: VN }],
  ['B2/S34H', { born: [2], survive: [3, 4], neighborhood: HEX }],
  ['b36/s23h', { born: [3, 6], survive: [2, 3], neighborhood: HEX }],
  ['B3/S23/G3', { born: [3], survive: [2, 3], states: 3 }],
  ['B3/S23/G4', { born: [3], survive: [2, 3], states: 4 }],
  ['B2/S/G3', { born: [2], survive: [], states: 3 }],
  ['23/3', { born: [3], survive: [2, 3] }],
  ['23/3V', { born: [3], survive: [2, 3], neighborhood: VN }],
  ['2/3H', { born: [3], survive: [2], neighborhood: HEX }],
  ['3/4/5', { born: [4], survive: [3], states: 5 }],
  ['/2/3', { born: [2], survive: [], states: 3 }],
  ['0/2/3', { born: [2], survive: [0], states: 3 }],
  ['B36/S23', { born: [3, 6], survive: [2, 3] }], // HighLife
  ['B2/S', { born: [2], survive: [] }], // Seeds
  ['B3678/S34678', { born: [3, 6, 7, 8], survive: [3, 4, 6, 7, 8] }], // Day & Night
  ['B1357/S1357', { born: [1, 3, 5, 7], survive: [1, 3, 5, 7] }], // Replicator
  ['B35678/S5678', { born: [3, 5, 6, 7, 8], survive: [5, 6, 7, 8] }], // Diamoeba
  ['B3/S12345', { born: [3], survive: [1, 2, 3, 4, 5] }], // Maze
  ['B36/S125', { born: [3, 6], survive: [1, 2, 5] }], // 2x2
  ['B3/S012345678', { born: [3], survive: [0, 1, 2, 3, 4, 5, 6, 7, 8] }], // Life without Death
  ['B234/S', { born: [2, 3, 4], survive: [] }],
  ['B/S23', { born: [], survive: [2, 3] }],
  ['B45678/S2345', { born: [4, 5, 6, 7, 8], survive: [2, 3, 4, 5] }],
  ['B3/S23/G8', { born: [3], survive: [2, 3], states: 8 }],
  ['13/2/4', { born: [2], survive: [1, 3], states: 4 }],
];

describe('parseRuleNotation — table-driven', () => {
  it('covers at least 25 notation strings', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(CASES)('parses %s', (input, expected) => {
    const rs = parseRuleNotation(input);
    expect(rs.transition).toMatchObject({
      kind: expected.states !== undefined ? 'generations' : 'totalistic',
      born: expected.born,
      survive: expected.survive,
      ...(expected.states !== undefined ? { states: expected.states } : {}),
    });
    expect(rs.neighborhood).toEqual(expected.neighborhood ?? MOORE);
    expect(rs.states).toHaveLength(expected.states ?? 2);
    expect(rs.states[0]).toMatchObject({ id: 0, kind: 'dead' });
  });
});

describe('parseRuleNotation / formatRuleNotation — round trip', () => {
  it.each(CASES.map(([input]) => input))('%s canonicalises idempotently', (input) => {
    const once = formatRuleNotation(parseRuleNotation(input));
    const twice = formatRuleNotation(parseRuleNotation(once));
    expect(twice).toBe(once);
  });

  it('B3/S23 canonicalises to exactly "B3/S23"', () => {
    expect(formatRuleNotation(parseRuleNotation('b3/s23'))).toBe('B3/S23');
  });

  it('legacy "23/3" canonicalises to the B/S form "B3/S23"', () => {
    expect(formatRuleNotation(parseRuleNotation('23/3'))).toBe('B3/S23');
  });

  it('Golly-order "3/4/5" canonicalises to "B4/S3/G5"', () => {
    expect(formatRuleNotation(parseRuleNotation('3/4/5'))).toBe('B4/S3/G5');
  });

  it('formatRuleNotation rejects a non-totalistic RuleSet', () => {
    const rs: RuleSet = {
      id: 'x',
      name: 'x',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: MOORE,
      transition: { kind: 'stateTable', radix: 2, table: new Uint8Array(2 * 2 ** 8) },
      boundary: 'toroidal',
    };
    expect(() => formatRuleNotation(rs)).toThrow(RuleValidationError);
  });
});

describe('parseRuleNotation — ambiguous or unsupported input', () => {
  function expectRejected(input: string): RuleValidationError {
    let error: unknown;
    try {
      parseRuleNotation(input);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RuleValidationError);
    const validationError = error as RuleValidationError;
    expect(validationError.issues[0]?.hint).toContain('supported forms');
    return validationError;
  }

  it('rejects empty input, echoing it', () => {
    const error = expectRejected('');
    expect(error.message).toContain('""');
  });

  it('rejects whitespace-only input, echoing it', () => {
    const error = expectRejected('   ');
    expect(error.message).toContain('"   "');
  });

  it.each(['B2ci/S12', 'B2/S1c2', 'B3S23', '1/2/3/4', 'xyz', 'B3/S23/S3'])(
    'rejects %s, echoing the input verbatim',
    (input) => {
      const error = expectRejected(input);
      expect(error.message).toContain(input);
    },
  );

  it('names Hensel notation specifically as not supported until Phase 2', () => {
    const error = expectRejected('B2ci/S12');
    expect(error.message.toLowerCase()).toContain('hensel');
    expect(error.message).toContain('Phase 2');
  });
});
