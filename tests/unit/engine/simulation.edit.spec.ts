import { describe, expect, it } from 'vitest';
import { BRIANS_BRAIN, CONWAY, HIGHLIFE } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import type { PaintOp, RuleSet } from '@engine/types';

function infiniteConway(): RuleSet {
  return { ...CONWAY, boundary: 'infinite' };
}

function cellsOf(pattern: string[]): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  pattern.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === 'O') out.push([x, y]);
    });
  });
  return out;
}

const GLIDER = cellsOf(['.O.', '..O', 'OOO']);
const BLOCK = cellsOf(['OO', 'OO']);

describe('Simulation.paint', () => {
  it('returns a ChangeSet of the same shape as step, reusing the same arrays', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    const painted = sim.paint([{ x: 1, y: 1, state: 1 }]);
    expect(painted.count).toBe(1);
    expect(painted.from[0]).toBe(0);
    expect(painted.to[0]).toBe(1);
    expect(sim.stats.population).toBe(1);
    expect(sim.tick).toBe(0);

    const stepped = sim.step();
    expect(stepped.coords).toBe(painted.coords);
    expect(stepped.from).toBe(painted.from);
    expect(stepped.to).toBe(painted.to);
  });

  it('skips no-ops and bounded out-of-range writes', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 8,
      height: 8,
    });
    sim.paint([{ x: 2, y: 2, state: 1 }]);
    const cs = sim.paint([
      { x: 2, y: 2, state: 1 },
      { x: 9, y: 0, state: 1 },
      { x: -1, y: 0, state: 1 },
    ]);
    expect(cs.count).toBe(0);
    expect(sim.stats.population).toBe(1);
  });

  it('rejects a state that is not in the current palette', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    expect(() => sim.paint([{ x: 0, y: 0, state: 2 }])).toThrow(/palette/);
  });

  it('a painted glider still translates by (1,1) in 4 generations', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    const ops: PaintOp[] = GLIDER.map(([x, y]) => ({ x, y, state: 1 }));
    sim.paint(ops);
    for (let i = 0; i < 4; i++) sim.step();
    const ref = new Simulation({ ruleset: infiniteConway() });
    for (const [x, y] of GLIDER) ref.set(x + 1, y + 1, 1);
    expect(sim.snapshot().chunkData).toEqual(ref.snapshot().chunkData);
  });
});

describe('Simulation.clear', () => {
  it('empties the grid without advancing the tick', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    sim.paint(BLOCK.map(([x, y]) => ({ x, y, state: 1 })));
    sim.step();
    const tick = sim.tick;
    sim.clear();
    expect(sim.tick).toBe(tick);
    expect(sim.stats.population).toBe(0);
    expect(sim.get(0, 0)).toBe(0);
    expect(sim.bounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('Simulation.seedRandom', () => {
  it('rejects a density outside [0, 1] and a sizeless infinite world', () => {
    const sized = new Simulation({ ruleset: CONWAY, width: 32, height: 32 });
    expect(() => sized.seedRandom(1.2, 1)).toThrow(/density/);
    expect(() => sized.seedRandom(-0.1, 1)).toThrow(/density/);
    const endless = new Simulation({ ruleset: infiniteConway() });
    expect(() => endless.seedRandom(0.5, 1)).toThrow(/width and height/);
  });
});

describe('Simulation.setRuleset', () => {
  it("throws, naming both palettes, when switching Conway → Brian's Brain without a migration", () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32 });
    sim.set(4, 4, 1);
    expect(() => sim.setRuleset(BRIANS_BRAIN)).toThrow(/Conway[\s\S]*Brian's Brain/);
    expect(sim.ruleset).toBe(CONWAY);
    expect(sim.get(4, 4)).toBe(1);
  });

  it("switches Conway → Brian's Brain with a migration, remapping live cells", () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32 });
    sim.set(4, 4, 1);
    sim.setRuleset(BRIANS_BRAIN, (s) => (s === 1 ? 1 : 0));
    expect(sim.ruleset).toBe(BRIANS_BRAIN);
    expect(sim.get(4, 4)).toBe(1);
    sim.step();
    expect(sim.get(4, 4)).toBe(2); // firing → refractory
  });

  it('switches Conway → HighLife without a migration: the palette matches, a block stays a block', () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32 });
    for (const [x, y] of BLOCK) sim.set(x + 8, y + 8, 1);
    sim.setRuleset(HIGHLIFE);
    expect(sim.ruleset).toBe(HIGHLIFE);
    sim.step();
    expect(sim.stats.population).toBe(4);
    expect(sim.get(8, 8)).toBe(1);
  });

  it('retiles live cells when the boundary mode changes', () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32 });
    sim.set(3, 3, 1);
    sim.setRuleset({ ...CONWAY, boundary: 'infinite' });
    expect(sim.ruleset.boundary).toBe('infinite');
    expect(sim.get(3, 3)).toBe(1);
  });

  it('refuses a finite boundary when the simulation has no width and height', () => {
    const sim = new Simulation({ ruleset: infiniteConway() });
    expect(() => sim.setRuleset(CONWAY)).toThrow(/width and height/);
  });
});
