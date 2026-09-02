/**
 * Brian's Brain — the 3-state totalistic rule that the schema doc expresses with
 * `decayStates: 1` rather than as a Generations string. Same evolution as B2/S/G3.
 */
import { SCHEMA_VERSION } from '../schema';
import type { BuiltinRuleSet } from './types';

export const BRIANS_BRAIN: BuiltinRuleSet = {
  version: SCHEMA_VERSION,
  id: 'brians-brain',
  name: "Brian's Brain",
  description:
    'Three states: a dead cell with exactly 2 firing neighbours fires; a firing cell always becomes refractory; a refractory cell always returns to dead. No cell ever survives. Discovered by Brian Silverman.',
  author: 'Brian Silverman',
  year: 1994,
  states: [
    { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
    { id: 1, name: 'firing', kind: 'live', countsAsAlive: true },
    { id: 2, name: 'refractory', kind: 'decay', countsAsAlive: false },
  ],
  neighborhood: { kind: 'moore', radius: 1 },
  transition: { kind: 'totalistic', born: [2], survive: [], decayStates: 1 },
  boundary: 'toroidal',
  tags: ['chaotic', 'multi-state'],
};
