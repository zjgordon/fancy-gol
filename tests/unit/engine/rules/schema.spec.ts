import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuleSetDocument } from '@engine/rules/schema';
import { SCHEMA_VERSION } from '@engine/rules/schema';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/rules/valid/', import.meta.url));

const FIXTURE_IDS = [
  'conway',
  'seeds',
  'brians-brain',
  'generations-demo',
  'wireworld',
  'highlands-liquid',
  'langtons-ant',
] as const;

function loadFixture(id: string): RuleSetDocument {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${id}.json`, 'utf8')) as RuleSetDocument;
}

describe('docs/ruleset-schema.md worked examples', () => {
  it.each(FIXTURE_IDS)('%s is a complete, well-shaped RuleSetDocument', (id) => {
    const doc = loadFixture(id);

    expect(doc.version).toBe(SCHEMA_VERSION);
    expect(doc.id).toBe(id);
    expect(typeof doc.name).toBe('string');
    expect(doc.name.length).toBeGreaterThan(0);
    expect(Array.isArray(doc.states)).toBe(true);
    expect(doc.states.length).toBeGreaterThan(0);
    expect(['bounded', 'toroidal', 'infinite']).toContain(doc.boundary);
    expect(doc.neighborhood).toBeTruthy();
    expect(doc.transition).toBeTruthy();

    // Exactly one 'dead' state, at id 0, and ids contiguous from 0 (P0-D-2 will enforce this
    // for real; this pins the fixtures to the rule now so D-2's validator has nothing to fix).
    const deadStates = doc.states.filter((s) => s.kind === 'dead');
    expect(deadStates).toHaveLength(1);
    expect(deadStates[0]?.id).toBe(0);
    const ids = [...doc.states.map((s) => s.id)].sort((a, b) => a - b);
    expect(ids).toEqual(doc.states.map((_, i) => i));
  });

  it('conway is a 2-state totalistic Moore-r1 rule', () => {
    const doc = loadFixture('conway');
    expect(doc.neighborhood).toEqual({ kind: 'moore', radius: 1 });
    expect(doc.transition).toEqual({ kind: 'totalistic', born: [3], survive: [2, 3] });
  });

  it("brian's brain declares one decay state", () => {
    const doc = loadFixture('brians-brain');
    expect(doc.transition).toMatchObject({ kind: 'totalistic', decayStates: 1 });
    expect(doc.states).toHaveLength(3);
  });

  it('the generations demo declares 3 states', () => {
    const doc = loadFixture('generations-demo');
    expect(doc.transition).toMatchObject({ kind: 'generations', states: 3 });
  });

  it("wireworld's dense table has exactly states * radix**neighbourCount entries", () => {
    const doc = loadFixture('wireworld');
    expect(doc.transition.kind).toBe('stateTable');
    if (doc.transition.kind !== 'stateTable') throw new Error('unreachable');
    expect(doc.transition.radix).toBe(4);
    expect(doc.states).toHaveLength(4);
    expect(doc.transition.table).toHaveLength(4 * 4 ** 8);
  });

  it('highlands-liquid weights one entry per state and covers the full weighted-sum range', () => {
    const doc = loadFixture('highlands-liquid');
    expect(doc.transition.kind).toBe('weighted');
    if (doc.transition.kind !== 'weighted') throw new Error('unreachable');
    expect(doc.transition.weights).toHaveLength(doc.states.length);
    const maxWeight = Math.max(...doc.transition.weights);
    const maxSum = maxWeight * 8; // Moore r=1 has 8 neighbours
    const covered = doc.transition.thresholds.some((t) => t.min <= maxSum && maxSum <= t.max);
    expect(covered).toBe(true);
  });

  it("langton's ant is a single-machine-state turmite with a rule for both cell colours", () => {
    const doc = loadFixture('langtons-ant');
    expect(doc.transition.kind).toBe('turmite');
    if (doc.transition.kind !== 'turmite') throw new Error('unreachable');
    expect(doc.transition.states).toHaveLength(2);
    const onCellStates = [...doc.transition.states.map((row) => row.onCellState)].sort();
    expect(onCellStates).toEqual([0, 1]);
  });
});
