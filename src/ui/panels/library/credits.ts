/**
 * Pattern-collection credits (P2-B-3 / README §3.9). Mirrors the per-source
 * table in `patterns/SOURCES.md` so the dialog can render terms without
 * fetching or parsing markdown at runtime. The unit test fails if a table
 * row lands in SOURCES.md that is not listed here.
 */

export interface PatternCollectionCredit {
  readonly source: string;
  readonly what: string;
  readonly class: 'A' | 'B' | 'C';
  readonly terms: string;
}

export const PATTERN_COLLECTION_CREDITS: readonly PatternCollectionCredit[] = [
  {
    source: 'LifeWiki (conwaylife.com)',
    what: 'Facts: names, discoverers, years, periods, speeds, layouts',
    class: 'B',
    terms:
      'Structured data from the main, Property, Lexeme, and EntitySchema namespaces is CC0; wiki prose is BY-SA and is not used here. Footer verified 2026-09-11.',
  },
  {
    source: 'LifeWiki + Mathematics and Construction book RLEs',
    what: 'Additional Conway facts (space rake, puffer 2, twin bees, New gun 1, switch-engine family, Semi-Snark)',
    class: 'B',
    terms:
      'Same LifeWiki footer as the seed set. Book pages publish RLE as structured pattern data; descriptions are original.',
  },
  {
    source: 'WireWorld (Brian Silverman, 1987)',
    what: 'Canonical diode layout as a historical configuration',
    class: 'B',
    terms: 'Configuration treated as fact; description original.',
  },
  {
    source: 'fancy-gol P2-B-5',
    what: "Class A barcodes, WireWorld gate sketches, Highlands documented soup, Brian's Brain ships found by search",
    class: 'A',
    terms: 'Originated here, CC0.',
  },
];
