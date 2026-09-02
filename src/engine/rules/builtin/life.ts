/**
 * Two-state outer-totalistic Life-like rules, all Moore r=1. Digits come from
 * {@link parseRuleNotation}; names, years and tags are the catalogue's.
 *
 * Citations follow LifeWiki / Golly's standard attributions.
 */
import { fromNotation } from './from-notation';

export const CONWAY = fromNotation({
  id: 'conway',
  notation: 'B3/S23',
  name: "Conway's Game of Life",
  description:
    'The original: a dead cell is born with exactly 3 live neighbours and a live cell survives with 2 or 3. Still lifes, oscillators and spaceships — including the glider — all live here.',
  author: 'John H. Conway',
  year: 1970,
  tags: ['stable'],
});

export const HIGHLIFE = fromNotation({
  id: 'highlife',
  notation: 'B36/S23',
  name: 'HighLife',
  description:
    'Conway plus birth-on-6. Famous for a small, naturally-occurring replicator; otherwise Life-like, with the same still lifes and a slightly more chaotic soup.',
  author: 'Nathan Thompson',
  year: 1994,
  tags: ['chaotic'],
});

export const DAY_AND_NIGHT = fromNotation({
  id: 'day-and-night',
  notation: 'B3678/S34678',
  name: 'Day & Night',
  description:
    'A self-complementary Life-like rule: swapping live and dead cells (and inverting the neighbourhood count) yields the same evolution. Stable regions of both phases coexist.',
  author: 'Nathan Thompson',
  year: 1997,
  tags: ['stable'],
});

export const SEEDS = fromNotation({
  id: 'seeds',
  notation: 'B2/S',
  name: 'Seeds',
  description:
    'Every live cell dies each generation; a dead cell with exactly 2 live neighbours is born. Explosive from almost any seed — a 2-cell domino already takes off.',
  author: 'Brian Silverman',
  tags: ['explosive'],
});

export const REPLICATOR = fromNotation({
  id: 'replicator',
  notation: 'B1357/S1357',
  name: 'Replicator',
  description:
    'The Moore-neighbourhood Fredkin/replicator rule: birth and survival on odd neighbour counts. Every finite pattern eventually tiles copies of itself across the plane.',
  tags: ['explosive'],
});

export const DIAMOEBA = fromNotation({
  id: 'diamoeba',
  notation: 'B35678/S5678',
  name: 'Diamoeba',
  description:
    'Diamond-shaped amoebae that grow, pinch, and sometimes emit glider-like wisps. Chaotic at large scale; discovered by Dean Hickerson.',
  author: 'Dean Hickerson',
  year: 1993,
  tags: ['chaotic'],
});

export const MAZE = fromNotation({
  id: 'maze',
  notation: 'B3/S12345',
  name: 'Maze',
  description:
    'Life-like birth, but cells survive on 1–5 neighbours. Random soup freezes into labyrinthine corridors — the maze-like tag in the catalogue is literal.',
  tags: ['maze-like'],
});

export const TWO_BY_TWO = fromNotation({
  id: 'two-by-two',
  notation: 'B36/S125',
  name: '2×2',
  description:
    'Named for its 2×2 block still-life family. A Life-like rule with unusual survival on 1 and 5; oscillators and spaceships exist, but soups tend toward chaos.',
  author: 'David Bell',
  year: 1994,
  tags: ['chaotic'],
});

export const LIFE_WITHOUT_DEATH = fromNotation({
  id: 'life-without-death',
  notation: 'B3/S012345678',
  name: 'Life without Death',
  description:
    'Cells are born as in Conway but never die (S0–S8). Also called Inkspot or Flakes: a live cell is a permanent stain, and patterns grow into coral-like mazes.',
  tags: ['maze-like'],
});

export const LIFE_FAMILY = [
  CONWAY,
  HIGHLIFE,
  DAY_AND_NIGHT,
  SEEDS,
  REPLICATOR,
  DIAMOEBA,
  MAZE,
  TWO_BY_TWO,
  LIFE_WITHOUT_DEATH,
] as const;
