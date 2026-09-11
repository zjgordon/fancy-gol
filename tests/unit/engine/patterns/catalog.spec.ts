import { describe, expect, it } from 'vitest';
import {
  CatalogParseError,
  parseCatalogEntry,
} from '@engine/patterns/catalog';
import { CATALOG_CATEGORIES, isCatalogCategory } from '@engine/patterns/catalog-types';

const BLOCK = [
  '#N Block',
  '#O unknown, 1970',
  '#C SPDX-License-Identifier: CC0-1.0',
  '#C source: https://conwaylife.com/wiki/Block',
  '#C ruleset: conway',
  '#C category: still-life',
  '#C period: 1',
  '#C heat: 0',
  '#C aliases: 2x2, square',
  '#C tags: still-life, staple',
  '#C year: 1970',
  '#C description: Four cells in a square.',
  'x = 2, y = 2, rule = B3/S23',
  '2o$2o!',
].join('\n');

describe('catalog-types', () => {
  it('lists every library category the seed set may use', () => {
    expect(CATALOG_CATEGORIES).toContain('still-life');
    expect(CATALOG_CATEGORIES).toContain('logic');
    expect(isCatalogCategory('still-life')).toBe(true);
    expect(isCatalogCategory('spaceship')).toBe(true);
    expect(isCatalogCategory('not-a-category')).toBe(false);
  });
});

describe('parseCatalogEntry', () => {
  it('reads metadata, population and a stable hash', () => {
    const entry = parseCatalogEntry('block', BLOCK);
    expect(entry.id).toBe('block');
    expect(entry.name).toBe('Block');
    expect(entry.discoverer).toBe('unknown');
    expect(entry.year).toBe(1970);
    expect(entry.ruleset).toBe('conway');
    expect(entry.category).toBe('still-life');
    expect(entry.width).toBe(2);
    expect(entry.height).toBe(2);
    expect(entry.population).toBe(4);
    expect(entry.period).toBe(1);
    expect(entry.speed).toBeNull();
    expect(entry.heat).toBe(0);
    expect(entry.aliases).toEqual(['2x2', 'square']);
    expect(entry.tags).toEqual(['still-life', 'staple']);
    expect(entry.source).toBe('https://conwaylife.com/wiki/Block');
    expect(entry.spdxLicense).toBe('CC0-1.0');
    expect(entry.description).toBe('Four cells in a square.');
    expect(entry.canonicalHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('treats period/speed/heat "none" as null', () => {
    const text = BLOCK.replace('#C period: 1', '#C period: none').replace('#C heat: 0', '#C heat: none') + '';
    const withSpeed = text.replace('#C heat: none', '#C speed: none\n#C heat: none');
    const entry = parseCatalogEntry('block', withSpeed);
    expect(entry.period).toBeNull();
    expect(entry.speed).toBeNull();
    expect(entry.heat).toBeNull();
  });

  it('accepts lowercase #c keys', () => {
    const text = BLOCK.replace('#C description: Four cells in a square.', '#c description: Four cells in a square.');
    expect(parseCatalogEntry('block', text).description).toBe('Four cells in a square.');
  });

  it('joins multiple description lines', () => {
    const text = BLOCK.replace(
      '#C description: Four cells in a square.',
      '#C description: Four cells.\n#C description: In a square.',
    );
    expect(parseCatalogEntry('block', text).description).toBe('Four cells. In a square.');
  });

  it('parses discoverer without a year', () => {
    const text = BLOCK.replace('#O unknown, 1970', '#O Brian Silverman').replace('#C year: 1970\n', '');
    const entry = parseCatalogEntry('block', text);
    expect(entry.discoverer).toBe('Brian Silverman');
    expect(entry.year).toBeNull();
  });

  it('rejects missing required fields and unknown categories', () => {
    expect(() => parseCatalogEntry('x', 'x = 1, y = 1\no!')).toThrow(CatalogParseError);
    expect(() => parseCatalogEntry('x', BLOCK.replace('#N Block', ''))).toThrow(/missing #N/);
    expect(() => parseCatalogEntry('x', BLOCK.replace('#O unknown, 1970', ''))).toThrow(/missing #O/);
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C source: https://conwaylife.com/wiki/Block', ''))).toThrow(
      /missing #C source/,
    );
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C SPDX-License-Identifier: CC0-1.0', ''))).toThrow(/SPDX/);
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C ruleset: conway', ''))).toThrow(/ruleset/);
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C category: still-life', ''))).toThrow(/category/);
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C category: still-life', '#C category: blob'))).toThrow(
      /unknown category/,
    );
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C description: Four cells in a square.', ''))).toThrow(
      /description/,
    );
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C period: 1', '#C period: potato'))).toThrow(/bad period/);
    expect(() => parseCatalogEntry('x', BLOCK.replace('#C heat: 0', '#C heat: potato'))).toThrow(/bad heat/);
  });
});
