import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compileNeighborhood } from '@engine/neighborhood';
import { Mulberry32 } from '@engine/rng';
import {
  compileRule,
  DENSE_TABLE_BUDGET,
  LUT_N_MAX_NEIGHBOURS,
  LUT_N_MAX_STATES,
  selectCompileStrategy,
  type CompileStrategy,
  type CompiledRule,
} from '@engine/rules/compile';
import { RuleValidationError } from '@engine/rules/errors';
import { parseRuleNotation } from '@engine/rules/parse';
import { validateRuleSet } from '@engine/rules/validate';
import type { RuleSet, RuleSet as RS } from '@engine/types';
import type { RuleSetDocument } from '@engine/rules/schema';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/rules/valid/', import.meta.url));

function loadFixture(id: string): RuleSetDocument {
  return validateRuleSet(JSON.parse(readFileSync(`${FIXTURES_DIR}${id}.json`, 'utf8')));
}

function asRuleSet(doc: RuleSetDocument): RuleSet {
  return doc;
}

const FIXTURE_STRATEGY: Record<string, CompileStrategy> = {
  conway: 'lut8',
  seeds: 'lut8',
  'brians-brain': 'lutN',
  'generations-demo': 'lutN',
  wireworld: 'denseTable',
  'highlands-liquid': 'closure',
  'langtons-ant': 'closure',
};

/** Life-family notations that P0-D-5 will ship as builtins — pin the strategy now. */
const NOTATION_STRATEGY: Array<[string, CompileStrategy]> = [
  ['B3/S23', 'lut8'], // Conway
  ['B36/S23', 'lut8'], // HighLife
  ['B3678/S34678', 'lut8'], // Day & Night
  ['B2/S', 'lut8'], // Seeds
  ['B1357/S1357', 'lut8'], // Replicator
  ['B35678/S5678', 'lut8'], // Diamoeba
  ['B3/S12345', 'lut8'], // Maze
  ['B36/S125', 'lut8'], // 2×2
  ['B3/S012345678', 'lut8'], // Life without Death
  ['B345/S2/G4', 'lutN'], // Star Wars
  ['B34678/S234/G24', 'closure'], // Bloomerang: 24 states exceeds lutN's 8-state cap
  ['B3/S23V', 'lutN'], // von Neumann — not Moore, so not lut8
  ['B2/S34H', 'lutN'], // hex
];

afterEach(() => {
  compileRule.cache.clear();
});

describe('selectCompileStrategy / fixture strategy', () => {
  it.each(Object.entries(FIXTURE_STRATEGY))('%s compiles as %s', (id, strategy) => {
    const rs = asRuleSet(loadFixture(id));
    const compiled = compileRule(rs);
    expect(compiled.strategy).toBe(strategy);
    expect(selectCompileStrategy(rs, compiled.neighbourCount)).toBe(strategy);
  });

  it.each(NOTATION_STRATEGY)('%s → %s', (notation, strategy) => {
    const rs = parseRuleNotation(notation);
    expect(compileRule(rs).strategy).toBe(strategy);
  });

  it('an oversized stateTable (over the 4 MiB budget) falls through to closure', () => {
    const offsets = Array.from({ length: LUT_N_MAX_NEIGHBOURS + 1 }, (_, i) => [i + 1, 0] as const);
    const rs: RS = {
      id: 'huge-table',
      name: 'huge-table',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'custom', offsets },
      transition: { kind: 'stateTable', radix: 2, table: new Uint8Array(2) },
      boundary: 'infinite',
    };
    const neighbourCount = compileNeighborhood(rs.neighborhood).count;
    expect(neighbourCount).toBeGreaterThan(LUT_N_MAX_NEIGHBOURS);
    expect(LUT_N_MAX_STATES).toBe(8);
    expect(selectCompileStrategy(rs, neighbourCount)).toBe('closure');
    expect(DENSE_TABLE_BUDGET).toBe(4 * 1024 * 1024);
  });

  it('a 3-state stateTable whose combos fit but bytes do not exceeds the budget', () => {
    // 3^13 = 1,594,323 ≤ 4 MiB; 3^13 * 3 = 4,782,969 > 4 MiB — hits the
    // post-multiply check rather than the per-neighbour early-out.
    const offsets = Array.from({ length: 13 }, (_, i) => [i + 1, 0] as const);
    const rs: RS = {
      id: 'just-over',
      name: 'just-over',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'a', kind: 'live', countsAsAlive: true },
        { id: 2, name: 'b', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'custom', offsets },
      transition: { kind: 'stateTable', radix: 3, table: new Uint8Array(3) },
      boundary: 'infinite',
    };
    expect(selectCompileStrategy(rs, 13)).toBe('closure');
  });

  it('a 2-state totalistic custom neighbourhood with >24 offsets is closure', () => {
    const offsets = Array.from({ length: 30 }, (_, i) => [i + 1, 0] as const);
    const rs: RS = {
      id: 'wide',
      name: 'wide',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'custom', offsets },
      transition: { kind: 'totalistic', born: [2], survive: [2, 3] },
      boundary: 'infinite',
    };
    expect(compileRule(rs).strategy).toBe('closure');
  });
});

describe('lut8 — Conway and Seeds oracles', () => {
  it("Conway's lut8 is the classic 2×9 table", () => {
    const compiled = compileRule(asRuleSet(loadFixture('conway')));
    expect(compiled.strategy).toBe('lut8');
    expect(compiled.table).toEqual(
      // dead: born at 3; live: survive at 2, 3
      Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]),
    );
  });

  it("Seeds' lut8 is born-at-2, never survive", () => {
    const compiled = compileRule(asRuleSet(loadFixture('seeds')));
    expect(compiled.table).toEqual(
      Uint8Array.from([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it('Conway next() matches the published B3/S23 cases', () => {
    const { next } = compileRule(asRuleSet(loadFixture('conway')));
    const n = (live: number, rest = 0) => {
      const a = new Uint8Array(8);
      for (let i = 0; i < live; i++) a[i] = 1;
      for (let i = live; i < 8; i++) a[i] = rest;
      return a;
    };
    expect(next(0, n(3))).toBe(1); // birth
    expect(next(0, n(2))).toBe(0);
    expect(next(1, n(2))).toBe(1); // survive
    expect(next(1, n(3))).toBe(1);
    expect(next(1, n(1))).toBe(0); // loneliness
    expect(next(1, n(4))).toBe(0); // overcrowding
  });
});

describe("lutN — Brian's Brain and Generations", () => {
  it("Brian's Brain: fire with 2, then refractory, then dead", () => {
    const { next } = compileRule(asRuleSet(loadFixture('brians-brain')));
    const twoLive = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0]);
    const none = new Uint8Array(8);
    expect(next(0, twoLive)).toBe(1);
    expect(next(0, none)).toBe(0);
    expect(next(1, twoLive)).toBe(2); // never survives
    expect(next(1, none)).toBe(2);
    expect(next(2, twoLive)).toBe(0);
    expect(next(2, none)).toBe(0);
  });

  it('generations demo: dying cells age through fading before death', () => {
    const { next } = compileRule(asRuleSet(loadFixture('generations-demo')));
    const three = Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0]);
    const two = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0]);
    const none = new Uint8Array(8);
    expect(next(0, three)).toBe(1);
    expect(next(1, two)).toBe(1); // survive
    expect(next(1, none)).toBe(2); // age to fading
    expect(next(2, none)).toBe(0); // fading → dead
  });
});

describe('denseTable — WireWorld', () => {
  it('empty stays empty, head→tail→conductor, conductor fires on 1 or 2 heads', () => {
    const compiled = compileRule(asRuleSet(loadFixture('wireworld')));
    expect(compiled.strategy).toBe('denseTable');
    expect(compiled.table?.length).toBe(4 * 4 ** 8);

    const empty = new Uint8Array(8);
    const oneHead = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]);
    const twoHeads = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0]);
    const threeHeads = Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0]);

    expect(compiled.next(0, empty)).toBe(0);
    expect(compiled.next(1, empty)).toBe(2); // head → tail
    expect(compiled.next(2, empty)).toBe(3); // tail → conductor
    expect(compiled.next(3, oneHead)).toBe(1);
    expect(compiled.next(3, twoHeads)).toBe(1);
    expect(compiled.next(3, threeHeads)).toBe(3);
    expect(compiled.next(3, empty)).toBe(3);
  });
});

describe('closure — weighted and turmite', () => {
  it('highlands/liquid is decided only by the weighted neighbour sum', () => {
    const { next, strategy } = compileRule(asRuleSet(loadFixture('highlands-liquid')));
    expect(strategy).toBe('closure');
    const voidN = new Uint8Array(8);
    const liquidN = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]); // sum 8 → liquid
    const highlandN = Uint8Array.from([2, 2, 2, 2, 2, 2, 2, 2]); // sum 24 → highland
    expect(next(0, voidN)).toBe(0);
    expect(next(2, voidN)).toBe(0); // own state is ignored
    expect(next(0, liquidN)).toBe(1);
    expect(next(0, highlandN)).toBe(2);
  });

  it('an unmatched weighted sum leaves the cell in its current state', () => {
    const rs: RS = {
      id: 'gap',
      name: 'gap',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'moore', radius: 1 },
      transition: {
        kind: 'weighted',
        weights: [0, 1],
        thresholds: [{ min: 8, max: 8, toState: 1 }], // only a full ring of live
      },
      boundary: 'infinite',
    };
    const { next } = compileRule(rs);
    expect(next(1, new Uint8Array(8))).toBe(1); // sum 0, no row → stay
    expect(next(0, Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]))).toBe(1);
  });

  it("Langton's ant cells are identity; the turmite table is packed for the agent", () => {
    const compiled = compileRule(asRuleSet(loadFixture('langtons-ant')));
    expect(compiled.strategy).toBe('closure');
    expect(compiled.next(0, new Uint8Array(8))).toBe(0);
    expect(compiled.next(1, new Uint8Array(8))).toBe(1);
    expect(compiled.turmite).toBeDefined();
    const t = compiled.turmite!;
    expect(t.rows).toHaveLength(2);
    expect(t.machineStateCount).toBe(1);
    expect(t.lookup[0 * compiled.stateCount + 0]).toBe(0); // white → right/flip black
    expect(t.lookup[0 * compiled.stateCount + 1]).toBe(1); // black → left/flip white
  });
});

describe('flags: stillLifeStates, stableWhenIsolated, isOuterTotalistic', () => {
  it('Conway: empty space is stable; an isolated live cell is not a still life', () => {
    const c = compileRule(asRuleSet(loadFixture('conway')));
    expect(c.stableWhenIsolated).toBe(true);
    expect([...c.stillLifeStates]).toEqual([0]);
    expect(c.isOuterTotalistic).toBe(true);
    expect(c.usesRandomness).toBe(false);
    expect(c.maxRadius).toBe(1);
  });

  it('Life without Death: isolated live cells persist (S0)', () => {
    const c = compileRule(parseRuleNotation('B3/S012345678'));
    expect(c.stableWhenIsolated).toBe(true);
    expect(c.stillLifeStates.has(0)).toBe(true);
    expect(c.stillLifeStates.has(1)).toBe(true);
  });

  it('B0/S23 spontaneously fills empty space, so isolated interiors cannot be skipped', () => {
    const c = compileRule(parseRuleNotation('B0/S23'));
    expect(c.stableWhenIsolated).toBe(false);
    expect(c.stillLifeStates.has(0)).toBe(false);
  });

  it('WireWorld is not outer-totalistic; empty is stable', () => {
    const c = compileRule(asRuleSet(loadFixture('wireworld')));
    expect(c.isOuterTotalistic).toBe(false);
    expect(c.stableWhenIsolated).toBe(true);
  });
});

describe('cache', () => {
  it('returns the same artefact for the same RuleSet object', () => {
    const rs = parseRuleNotation('B3/S23');
    const a = compileRule(rs);
    const b = compileRule(rs);
    expect(a).toBe(b);
    compileRule.cache.clear();
    const c = compileRule(rs);
    expect(c).not.toBe(a);
    expect(c.table).toEqual(a.table);
  });

  it('compiling Conway 10,000 times takes < 50 ms thanks to the cache', () => {
    const rs = parseRuleNotation('B3/S23');
    compileRule.cache.clear();
    compileRule(rs); // miss, then 9,999 hits
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) compileRule(rs);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  it('forced-strategy compiles are not stored in the auto cache', () => {
    const rs = parseRuleNotation('B3/S23');
    const forced = compileRule(rs, { forceStrategy: 'closure' });
    const auto = compileRule(rs);
    expect(forced.strategy).toBe('closure');
    expect(auto.strategy).toBe('lut8');
    expect(auto).not.toBe(forced);
  });

  it('forcing a LUT the rule does not qualify for throws', () => {
    const rs = asRuleSet(loadFixture('highlands-liquid'));
    expect(() => compileRule(rs, { forceStrategy: 'lut8' })).toThrow(RuleValidationError);
  });
});

describe('edge cases the happy-path fixtures do not reach', () => {
  it('compiles a stateTable that is already a Uint8Array without copying', () => {
    const table = new Uint8Array(2 * 2 ** 4); // von Neumann r=1, 2 states
    table[0] = 1;
    const rs: RS = {
      id: 'vn-table',
      name: 'vn-table',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'vonNeumann', radius: 1 },
      transition: { kind: 'stateTable', radix: 2, table },
      boundary: 'infinite',
    };
    const compiled = compileRule(rs);
    expect(compiled.strategy).toBe('denseTable');
    expect(compiled.table).toBe(table);
    expect(compiled.next(0, new Uint8Array(4))).toBe(1);
  });

  it('out-of-range born digits are ignored; out-of-range neighbour states count as dead', () => {
    const rs: RS = {
      id: 'messy',
      name: 'messy',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'moore', radius: 1 },
      transition: { kind: 'totalistic', born: [-1, 3, 99], survive: [2] },
      boundary: 'infinite',
    };
    const { next } = compileRule(rs);
    expect(next(0, Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0]))).toBe(1);
    expect(next(0, Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9]))).toBe(0);
    expect(next(99, new Uint8Array(8))).toBe(0); // LUT miss → dead
  });

  it('a palette with no countsAsAlive state still compiles (tally is always 0)', () => {
    const rs: RS = {
      id: 'inert',
      name: 'inert',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'ghost', kind: 'inert', countsAsAlive: false },
      ],
      neighborhood: { kind: 'moore', radius: 1 },
      transition: { kind: 'totalistic', born: [0], survive: [0], decayStates: 1 },
      boundary: 'infinite',
    };
    const compiled = compileRule(rs);
    expect(compiled.strategy).toBe('lut8');
    expect(compiled.next(0, new Uint8Array(8))).toBe(1); // B0
  });

  it('a 2-state generations rule has no decay chain', () => {
    const { next, strategy } = compileRule(parseRuleNotation('B3/S23/G2'));
    expect(strategy).toBe('lutN');
    expect(next(1, new Uint8Array(8))).toBe(0);
  });

  it('a weighted lookup with an unknown neighbour state treats its weight as 0', () => {
    const rs: RS = {
      id: 'w',
      name: 'w',
      states: [
        { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'moore', radius: 1 },
      transition: {
        kind: 'weighted',
        weights: [0, 1],
        thresholds: [{ min: 0, max: 0, toState: 0 }],
      },
      boundary: 'infinite',
    };
    expect(compileRule(rs).next(1, Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9]))).toBe(0);
  });

  it('a two-machine-state turmite packs both rows and ignores an out-of-range cell', () => {
    const rs: RS = {
      id: 'tur',
      name: 'tur',
      states: [
        { id: 0, name: 'white', kind: 'dead', countsAsAlive: false },
        { id: 1, name: 'black', kind: 'live', countsAsAlive: true },
      ],
      neighborhood: { kind: 'moore', radius: 1 },
      transition: {
        kind: 'turmite',
        states: [
          { state: 0, onCellState: 0, writeState: 1, turn: 'right', nextState: 1 },
          { state: 1, onCellState: 1, writeState: 0, turn: 'left', nextState: 0 },
          { state: 0, onCellState: 99, writeState: 0, turn: 'none', nextState: 0 },
        ],
      },
      boundary: 'infinite',
    };
    const t = compileRule(rs).turmite;
    expect(t?.machineStateCount).toBe(2);
    expect(t?.lookup[0]).toBe(0);
    expect(t?.lookup[1 * 2 + 1]).toBe(1);
  });
});

describe('equivalence: closure vs chosen fast strategy, 50,000 random inputs', () => {
  const EQUIV_FIXTURES = [
    'conway',
    'seeds',
    'brians-brain',
    'generations-demo',
    'wireworld',
    'highlands-liquid',
  ];

  it.each(EQUIV_FIXTURES)('%s: auto.next === closure.next', (id) => {
    const rs = asRuleSet(loadFixture(id));
    const auto = compileRule(rs);
    const closure = compileRule(rs, { forceStrategy: 'closure' });
    assertEquivalent(auto, closure, 0xc0ffee ^ id.length);
  });

  it.each(NOTATION_STRATEGY.map(([n]) => n))('%s: auto.next === closure.next', (notation) => {
    const rs = parseRuleNotation(notation);
    const auto = compileRule(rs);
    const closure = compileRule(rs, { forceStrategy: 'closure' });
    assertEquivalent(auto, closure, 0x9e3779b9 ^ notation.length);
  });
});

function assertEquivalent(fast: CompiledRule, closure: CompiledRule, seed: number): void {
  const rng = new Mulberry32(seed >>> 0);
  const n = fast.neighbourCount;
  const states = fast.stateCount;
  const neighbours = new Uint8Array(n);
  for (let i = 0; i < 50_000; i++) {
    const state = rng.nextInt(states);
    for (let k = 0; k < n; k++) neighbours[k] = rng.nextInt(states);
    expect(fast.next(state, neighbours), `mismatch at sample ${i}, state ${state}`).toBe(
      closure.next(state, neighbours),
    );
  }
}
