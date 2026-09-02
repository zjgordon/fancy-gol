/**
 * WireWorld (Brian Silverman, 1987) as a generated dense 4-state, 8-neighbour
 * table. 4 × 4^8 = 262,144 entries — nobody hand-writes that; the generator is
 * the source of truth and is pinned against the schema-doc fixture.
 */
import { SCHEMA_VERSION } from '../schema';
import type { BuiltinRuleSet } from './types';

const RADIX = 4;
const NEIGHBOURS = 8;

/**
 * WireWorld next-state given the centre cell and its 8 neighbours in compiled
 * Moore-r1 offset order. Empty stays empty; head→tail→conductor; a conductor
 * becomes a head iff it has exactly 1 or 2 head neighbours.
 */
export function wireWorldNext(state: number, neighbourStates: ArrayLike<number>): number {
  if (state === 0) return 0;
  if (state === 1) return 2;
  if (state === 2) return 3;
  let heads = 0;
  for (let i = 0; i < neighbourStates.length; i++) {
    if (neighbourStates[i] === 1) heads++;
  }
  return heads === 1 || heads === 2 ? 1 : 3;
}

/** Build the dense table the compiler indexes as `state * 4^8 + Σ n_i * 4^i`. */
export function generateWireWorldTable(): Uint8Array {
  const combos = RADIX ** NEIGHBOURS;
  const table = new Uint8Array(RADIX * combos);
  const neighbours = new Uint8Array(NEIGHBOURS);
  for (let state = 0; state < RADIX; state++) {
    for (let combo = 0; combo < combos; combo++) {
      let n = combo;
      for (let i = 0; i < NEIGHBOURS; i++) {
        neighbours[i] = n % RADIX;
        n = (n / RADIX) | 0;
      }
      table[state * combos + combo] = wireWorldNext(state, neighbours);
    }
  }
  return table;
}

export const WIREWORLD: BuiltinRuleSet = {
  version: SCHEMA_VERSION,
  id: 'wireworld',
  name: 'WireWorld',
  description:
    'A 4-state digital-logic simulator: electrons (head/tail pairs) flow along conductor wires. Empty stays empty; a conductor becomes a head when exactly one or two neighbours are heads. Designed by Brian Silverman in 1987 and popularised by A. K. Dewdney.',
  author: 'Brian Silverman',
  year: 1987,
  states: [
    { id: 0, name: 'empty', kind: 'dead', countsAsAlive: false },
    { id: 1, name: 'electron-head', kind: 'live', countsAsAlive: true },
    { id: 2, name: 'electron-tail', kind: 'decay', countsAsAlive: false },
    { id: 3, name: 'conductor', kind: 'inert', countsAsAlive: false },
  ],
  neighborhood: { kind: 'moore', radius: 1 },
  transition: { kind: 'stateTable', radix: RADIX, table: generateWireWorldTable() },
  boundary: 'bounded',
  tags: ['multi-state', 'stable'],
};
