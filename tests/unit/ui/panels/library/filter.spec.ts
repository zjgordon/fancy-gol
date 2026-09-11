import { describe, expect, it } from 'vitest';
import {
  attributionLine,
  filterLibrary,
  sizeBucket,
  type LibraryEntry,
} from '@ui/panels/library/filter';

function entry(partial: Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'name'>): LibraryEntry {
  return {
    aliases: [],
    ruleset: 'conway',
    category: 'curiosity',
    tags: [],
    width: 3,
    height: 3,
    origin: 'curated',
    ...partial,
  };
}

const CATALOGUE: readonly LibraryEntry[] = [
  entry({
    id: 'gosper-gun',
    name: 'Gosper glider gun',
    author: 'Bill Gosper',
    year: 1970,
    category: 'gun',
    tags: ['gun', 'conway'],
    width: 36,
    height: 9,
    period: 30,
    source: 'https://conwaylife.com/wiki/Gosper_glider_gun',
  }),
  entry({
    id: 'queen-bee-shuttle',
    name: 'Queen bee shuttle',
    author: 'Bill Gosper',
    year: 1970,
    category: 'oscillator',
    tags: ['oscillator', 'shuttle'],
    width: 22,
    height: 7,
    period: 30,
  }),
  entry({
    id: 'glider',
    name: 'Glider',
    author: 'Richard K. Guy',
    year: 1970,
    category: 'spaceship',
    tags: ['spaceship'],
    period: 4,
  }),
  entry({
    id: 'wireworld-diode',
    name: 'Diode',
    ruleset: 'wireworld',
    category: 'logic',
    tags: ['logic', 'wireworld'],
    author: 'Brian Silverman',
    year: 1987,
  }),
  entry({
    id: 'block',
    name: 'Block',
    category: 'still-life',
    tags: ['still-life'],
    width: 2,
    height: 2,
    period: null,
    author: 'unknown',
    year: 1970,
  }),
];

describe('filterLibrary', () => {
  it('finds the Gosper glider gun from "gosp"', () => {
    const hits = filterLibrary(CATALOGUE, {
      ruleset: 'conway',
      category: '',
      tag: '',
      size: 'any',
      period: '',
      query: 'gosp',
    });
    expect(hits[0]?.item.id).toBe('gosper-gun');
  });

  it('finds period-30 oscillators (and guns) from "p30"', () => {
    const hits = filterLibrary(CATALOGUE, {
      ruleset: 'conway',
      category: '',
      tag: '',
      size: 'any',
      period: '',
      query: 'p30',
    });
    expect(hits.map((h) => h.item.id).sort()).toEqual(['gosper-gun', 'queen-bee-shuttle']);
  });

  it('defaults to the active ruleset so WireWorld hides Conway', () => {
    const hits = filterLibrary(CATALOGUE, {
      ruleset: 'wireworld',
      category: '',
      tag: '',
      size: 'any',
      period: '',
      query: '',
    });
    expect(hits.map((h) => h.item.id)).toEqual(['wireworld-diode']);
  });

  it('filters by category, tag, size, and period', () => {
    expect(
      filterLibrary(CATALOGUE, {
        ruleset: 'conway',
        category: 'spaceship',
        tag: '',
        size: 'any',
        period: '',
        query: '',
      }).map((h) => h.item.id),
    ).toEqual(['glider']);
    expect(
      filterLibrary(CATALOGUE, {
        ruleset: 'conway',
        category: '',
        tag: 'shuttle',
        size: 'any',
        period: '',
        query: '',
      }).map((h) => h.item.id),
    ).toEqual(['queen-bee-shuttle']);
    expect(
      filterLibrary(CATALOGUE, {
        ruleset: 'conway',
        category: '',
        tag: '',
        size: 'tiny',
        period: '',
        query: '',
      }).map((h) => h.item.id),
    ).toEqual(['block', 'glider']);
    expect(
      filterLibrary(CATALOGUE, {
        ruleset: 'conway',
        category: '',
        tag: '',
        size: 'any',
        period: '30',
        query: '',
      }).map((h) => h.item.id).sort(),
    ).toEqual(['gosper-gun', 'queen-bee-shuttle']);
  });
});

describe('attributionLine / sizeBucket', () => {
  it('shows discoverer and year together when both exist', () => {
    expect(attributionLine(CATALOGUE[0]!)).toBe('Bill Gosper, 1970');
    expect(attributionLine(entry({ id: 'x', name: 'X' }))).toBe('');
  });

  it('buckets bounding boxes', () => {
    expect(sizeBucket(2, 2)).toBe('tiny');
    expect(sizeBucket(10, 4)).toBe('small');
    expect(sizeBucket(36, 9)).toBe('medium');
    expect(sizeBucket(80, 20)).toBe('large');
  });
});
