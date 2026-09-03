import { CONWAY } from '../../src/engine/rules/builtin/index.ts';
import { Simulation } from '../../src/engine/simulation.ts';
import type { RuleSet } from '../../src/engine/types.ts';

export const SOUP_SEED = 0x51e1d;

export function toroidalConway(): RuleSet {
  return { ...CONWAY, boundary: 'toroidal' };
}

export function soup(width: number, height: number, density: number, seed = SOUP_SEED): Simulation {
  const sim = new Simulation({
    ruleset: toroidalConway(),
    width,
    height,
    seed,
  });
  sim.seedRandom(density, seed);
  return sim;
}

export function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === 'function') g();
}
