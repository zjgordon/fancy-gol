/**
 * Catalogue schema (P2-B-1). Pure types plus the category allowlist the parser
 * and the later library panel both consume. No I/O — the engine never reads disk.
 */

export const CATALOG_CATEGORIES = [
  'still-life',
  'oscillator',
  'spaceship',
  'puffer',
  'rake',
  'gun',
  'methuselah',
  'wick',
  'agar',
  'reflector',
  'logic',
  'seed',
  'curiosity',
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export function isCatalogCategory(value: string): value is CatalogCategory {
  return (CATALOG_CATEGORIES as readonly string[]).includes(value);
}

/**
 * One library entry. Cell layout lives in the `.rle` file; this is the metadata
 * the index and the panel render. `canonicalHash` is P2-A-4's identity of the
 * live cells, not a hash of the prose.
 */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly ruleset: string;
  readonly category: CatalogCategory;
  readonly discoverer: string;
  readonly year: number | null;
  readonly width: number;
  readonly height: number;
  readonly population: number;
  readonly period: number | null;
  readonly speed: string | null;
  readonly heat: number | null;
  readonly description: string;
  readonly source: string;
  readonly tags: readonly string[];
  readonly canonicalHash: string;
  readonly spdxLicense: string;
}
