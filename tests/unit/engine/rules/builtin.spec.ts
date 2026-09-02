import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLOOMERANG,
  BUILTIN_RULESETS,
  CONWAY,
  generateWireWorldTable,
  getBuiltin,
  HIGHLANDS_GENERATIONS,
  HIGHLANDS_HEIGHT,
  HIGHLANDS_LIQUID,
  HIGHLANDS_SEED,
  HIGHLANDS_WIDTH,
  LIFE_WITHOUT_DEATH,
  SEEDS,
  STAR_WARS,
  WIREWORLD,
  wireWorldNext,
} from '@engine/rules/builtin';
import { fromNotation } from '@engine/rules/builtin/from-notation';
import { compileRule, type CompileStrategy, type CompiledRule } from '@engine/rules/compile';
import { validateRuleSet } from '@engine/rules/validate';
import { Mulberry32 } from '@engine/rng';
import type { RuleSetDocument } from '@engine/rules/schema';

const EXPECTED_STRATEGY: Record<string, CompileStrategy> = {
  conway: 'lut8',
  highlife: 'lut8',
  'day-and-night': 'lut8',
  seeds: 'lut8',
  replicator: 'lut8',
  diamoeba: 'lut8',
  maze: 'lut8',
  'two-by-two': 'lut8',
  'life-without-death': 'lut8',
  'brians-brain': 'lutN',
  wireworld: 'denseTable',
  'star-wars': 'lutN',
  bloomerang: 'closure',
  'highlands-liquid': 'closure',
};

const WIREWORLD_FIXTURE = fileURLToPath(
  new URL('../../../fixtures/rules/valid/wireworld.json', import.meta.url),
);

function nLive(count: number, size = 8): Uint8Array {
  const a = new Uint8Array(size);
  for (let i = 0; i < count; i++) a[i] = 1;
  return a;
}

/** Toroidal step using the compiled neighbourhood offsets. Test-only; the production stepper is P0-E-1. */
function stepToroidal(grid: Uint8Array, w: number, h: number, rule: CompiledRule): Uint8Array {
  const out = new Uint8Array(grid.length);
  const neighbours = new Uint8Array(rule.neighbourCount);
  for (let y = 0; y < h; y++) {
    const packed = rule.neighborhood.offsetsByParity[y & 1]!;
    for (let x = 0; x < w; x++) {
      for (let i = 0; i < rule.neighbourCount; i++) {
        const nx = (((x + packed[i * 2]!) % w) + w) % w;
        const ny = (((y + packed[i * 2 + 1]!) % h) + h) % h;
        neighbours[i] = grid[ny * w + nx]!;
      }
      out[y * w + x] = rule.next(grid[y * w + x]!, neighbours);
    }
  }
  return out;
}

function sameStateEdgeFraction(grid: Uint8Array, w: number, h: number): number {
  let same = 0;
  let total = 0;
  const dirs: Array<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const here = grid[y * w + x]!;
      for (const [dx, dy] of dirs) {
        const nx = (((x + dx) % w) + w) % w;
        const ny = (((y + dy) % h) + h) % h;
        total++;
        if (grid[ny * w + nx] === here) same++;
      }
    }
  }
  return same / total;
}

function paint(
  w: number,
  h: number,
  cells: Array<readonly [number, number]>,
  state = 1,
): Uint8Array {
  const grid = new Uint8Array(w * h);
  for (const [x, y] of cells) grid[y * w + x] = state;
  return grid;
}

function liveCells(grid: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] !== 0) n++;
  return n;
}

describe('BUILTIN_RULESETS catalogue', () => {
  it('ships every rule named in P0-D-5', () => {
    const ids = BUILTIN_RULESETS.map((r) => r.id);
    expect(ids).toEqual([
      'conway',
      'highlife',
      'day-and-night',
      'seeds',
      'replicator',
      'diamoeba',
      'maze',
      'two-by-two',
      'life-without-death',
      'brians-brain',
      'wireworld',
      'star-wars',
      'bloomerang',
      'highlands-liquid',
    ]);
  });

  it('ids are unique and getBuiltin round-trips', () => {
    const ids = BUILTIN_RULESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rs of BUILTIN_RULESETS) {
      expect(getBuiltin(rs.id)).toBe(rs);
    }
    expect(getBuiltin('no-such-rule')).toBeUndefined();
  });

  it.each(BUILTIN_RULESETS.map((r) => r.id))('%s validates, compiles, and has tags', (id) => {
    const rs = getBuiltin(id)!;
    expect(() => validateRuleSet(rs)).not.toThrow();
    const compiled = compileRule(rs);
    expect(compiled.strategy).toBe(EXPECTED_STRATEGY[id]);
    expect(rs.tags.length).toBeGreaterThan(0);
    expect(rs.name.length).toBeGreaterThan(0);
    expect((rs.description ?? '').length).toBeGreaterThan(20);
  });
});

describe('fromNotation optional metadata', () => {
  it('omits author and year when neither is given', () => {
    const rs = fromNotation({
      id: 'x',
      notation: 'B3/S23',
      name: 'X',
      description: 'd',
      tags: ['stable'],
    });
    expect(rs).not.toHaveProperty('author');
    expect(rs).not.toHaveProperty('year');
  });

  it('keeps a year without an author', () => {
    const rs = fromNotation({
      id: 'x',
      notation: 'B3/S23',
      name: 'X',
      description: 'd',
      year: 2001,
      tags: ['stable'],
    });
    expect(rs.year).toBe(2001);
    expect(rs).not.toHaveProperty('author');
  });
});

describe('published behavioural oracles', () => {
  it('Conway: a blinker has period 2; a block is a still life', () => {
    const rule = compileRule(CONWAY);
    const blinker0 = paint(5, 5, [
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    const blinker1 = stepToroidal(blinker0, 5, 5, rule);
    const blinker2 = stepToroidal(blinker1, 5, 5, rule);
    expect(blinker1).not.toEqual(blinker0);
    expect(blinker2).toEqual(blinker0);

    const block = paint(5, 5, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(stepToroidal(block, 5, 5, rule)).toEqual(block);
  });

  it('HighLife contains Conway plus B6: 6 neighbours births a cell', () => {
    const { next } = compileRule(getBuiltin('highlife')!);
    expect(next(0, nLive(3))).toBe(1);
    expect(next(0, nLive(6))).toBe(1); // the HighLife extra
    expect(compileRule(CONWAY).next(0, nLive(6))).toBe(0);
  });

  it('Day & Night is self-complementary at the origin: empty stays empty, full stays full', () => {
    const { next } = compileRule(getBuiltin('day-and-night')!);
    expect(next(0, nLive(0))).toBe(0);
    expect(next(1, nLive(8))).toBe(1);
    expect(next(0, nLive(3))).toBe(1); // B3
  });

  it('Seeds: a 2-cell domino explodes (more live cells at gen 1 than gen 0)', () => {
    const rule = compileRule(SEEDS);
    const seed = paint(9, 9, [
      [4, 4],
      [5, 4],
    ]);
    const next = stepToroidal(seed, 9, 9, rule);
    expect(liveCells(seed)).toBe(2);
    expect(liveCells(next)).toBeGreaterThan(2);
    expect(rule.next(1, nLive(0))).toBe(0); // never survives
    expect(rule.next(0, nLive(2))).toBe(1);
  });

  it('Replicator: odd neighbour counts are born/survive; even die', () => {
    const { next } = compileRule(getBuiltin('replicator')!);
    expect(next(0, nLive(1))).toBe(1);
    expect(next(0, nLive(2))).toBe(0);
    expect(next(1, nLive(3))).toBe(1);
    expect(next(1, nLive(0))).toBe(0);
  });

  it('Diamoeba: B35678/S5678 local cases', () => {
    const { next } = compileRule(getBuiltin('diamoeba')!);
    expect(next(0, nLive(3))).toBe(1);
    expect(next(0, nLive(4))).toBe(0);
    expect(next(1, nLive(5))).toBe(1);
    expect(next(1, nLive(4))).toBe(0);
  });

  it('Maze: a live cell with 1 neighbour survives (unlike Conway)', () => {
    const { next } = compileRule(getBuiltin('maze')!);
    expect(next(1, nLive(1))).toBe(1);
    expect(compileRule(CONWAY).next(1, nLive(1))).toBe(0);
    expect(next(0, nLive(3))).toBe(1);
  });

  it('2×2: survives on 1 and 5; born on 3 and 6', () => {
    const { next } = compileRule(getBuiltin('two-by-two')!);
    expect(next(1, nLive(1))).toBe(1);
    expect(next(1, nLive(5))).toBe(1);
    expect(next(1, nLive(3))).toBe(0); // unlike Conway, 3 is not a survive count
    expect(next(0, nLive(3))).toBe(1);
    expect(next(0, nLive(6))).toBe(1);
  });

  it('Life without Death: a single cell persists forever', () => {
    const rule = compileRule(LIFE_WITHOUT_DEATH);
    const one = paint(5, 5, [[2, 2]]);
    expect(stepToroidal(one, 5, 5, rule)).toEqual(one);
    expect(rule.next(1, nLive(0))).toBe(1);
  });

  it("Brian's Brain: firing → refractory → dead; birth on exactly 2", () => {
    const { next } = compileRule(getBuiltin('brians-brain')!);
    expect(next(0, nLive(2))).toBe(1);
    expect(next(1, nLive(8))).toBe(2);
    expect(next(2, nLive(8))).toBe(0);
  });

  it('WireWorld: the generator matches the schema fixture and the published head/tail/conductor cycle', () => {
    const generated = generateWireWorldTable();
    const fixture = JSON.parse(readFileSync(WIREWORLD_FIXTURE, 'utf8')) as RuleSetDocument;
    expect(fixture.transition.kind).toBe('stateTable');
    if (fixture.transition.kind !== 'stateTable') throw new Error('unreachable');
    expect(Array.from(generated)).toEqual(fixture.transition.table);

    expect(wireWorldNext(0, nLive(8))).toBe(0);
    expect(wireWorldNext(1, nLive(0))).toBe(2);
    expect(wireWorldNext(2, nLive(0))).toBe(3);
    expect(wireWorldNext(3, Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]))).toBe(1);
    expect(wireWorldNext(3, Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0]))).toBe(3);

    const compiled = compileRule(WIREWORLD);
    expect(compiled.next(1, nLive(0))).toBe(2);
    expect(compiled.next(3, Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]))).toBe(1);
  });

  it('Star Wars: B345/S2 then two generations of decay', () => {
    const { next } = compileRule(STAR_WARS);
    expect(next(0, nLive(3))).toBe(1);
    expect(next(0, nLive(2))).toBe(0);
    expect(next(1, nLive(2))).toBe(1);
    expect(next(1, nLive(0))).toBe(2);
    expect(next(2, nLive(0))).toBe(3);
    expect(next(3, nLive(0))).toBe(0);
  });

  it('Bloomerang: 24 states, birth on 3, a dying cell ages rather than vanishing', () => {
    expect(BLOOMERANG.states).toHaveLength(24);
    const { next, strategy } = compileRule(BLOOMERANG);
    expect(strategy).toBe('closure');
    expect(next(0, nLive(3))).toBe(1);
    expect(next(1, nLive(0))).toBe(2);
    expect(next(23, nLive(0))).toBe(0);
  });
});

describe('Highlands / Liquid banding (documented seed, 200 generations)', () => {
  it('Mulberry32(0x51eed) 32×32 soup clusters into land/water bands', () => {
    const rule = compileRule(HIGHLANDS_LIQUID);
    const rng = new Mulberry32(HIGHLANDS_SEED);
    const w = HIGHLANDS_WIDTH;
    const h = HIGHLANDS_HEIGHT;
    const start = new Uint8Array(w * h);
    for (let i = 0; i < start.length; i++) {
      const r = rng.next();
      start[i] = r < 0.25 ? 0 : r < 0.625 ? 1 : 2;
    }
    const startFrac = sameStateEdgeFraction(start, w, h);

    let grid: Uint8Array<ArrayBufferLike> = start;
    for (let g = 0; g < HIGHLANDS_GENERATIONS; g++) {
      grid = stepToroidal(grid, w, h, rule);
    }

    const endFrac = sameStateEdgeFraction(grid, w, h);
    const voidC = grid.filter((s) => s === 0).length;
    const liquidC = grid.filter((s) => s === 1).length;
    const highlandC = grid.filter((s) => s === 2).length;

    // All three terrains survive — it does not collapse to a single state.
    expect(voidC).toBeGreaterThan(0);
    expect(liquidC).toBeGreaterThan(0);
    expect(highlandC).toBeGreaterThan(0);
    // Same-state Moore edges rise: neighbouring cells agree more, i.e. they have banded.
    expect(endFrac).toBeGreaterThan(startFrac);
    expect(endFrac).toBeGreaterThan(0.7);
  });
});
