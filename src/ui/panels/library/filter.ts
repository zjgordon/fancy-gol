/**
 * Library query (P2-B-3). Structured filters first, then one shared fuzzy
 * pass across name / alias / discoverer / description / period tags.
 * Pure: the panel owns the DOM; this file only ranks.
 */
import { rankFuzzy, type RankedFuzzy } from '@ui/search/fuzzy';

export const LIBRARY_CATEGORIES = [
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

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export type LibrarySizeBucket = 'any' | 'tiny' | 'small' | 'medium' | 'large';

export interface LibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly author?: string;
  readonly year?: number | null;
  readonly ruleset: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly period?: number | null;
  readonly source?: string;
  readonly origin: string;
}

export interface LibraryFilters {
  readonly ruleset: string;
  readonly category: string;
  readonly tag: string;
  readonly size: LibrarySizeBucket;
  readonly period: string;
  readonly query: string;
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  ruleset: '',
  category: '',
  tag: '',
  size: 'any',
  period: '',
  query: '',
};

export function sizeBucket(width: number, height: number): Exclude<LibrarySizeBucket, 'any'> {
  const span = Math.max(width, height);
  if (span <= 5) return 'tiny';
  if (span <= 15) return 'small';
  if (span <= 40) return 'medium';
  return 'large';
}

export function periodLabel(period: number | null | undefined): string {
  if (period === null || period === undefined) return '';
  return `p${period}`;
}

export function searchFields(entry: LibraryEntry): readonly string[] {
  return [
    entry.name,
    ...entry.aliases,
    entry.author ?? '',
    entry.description ?? '',
    entry.id,
    ...entry.tags,
    periodLabel(entry.period),
    entry.period != null ? String(entry.period) : '',
  ];
}

function matchesStructured(entry: LibraryEntry, filters: LibraryFilters): boolean {
  if (filters.ruleset && entry.ruleset !== filters.ruleset) return false;
  if (filters.category && entry.category !== filters.category) return false;
  if (filters.tag && !entry.tags.some((t) => t.toLowerCase() === filters.tag.toLowerCase())) return false;
  if (filters.size !== 'any' && sizeBucket(entry.width, entry.height) !== filters.size) return false;
  if (filters.period) {
    const want = filters.period.trim().toLowerCase();
    const label = periodLabel(entry.period).toLowerCase();
    const raw = entry.period != null ? String(entry.period) : '';
    if (want === 'still' || want === 'still-life') {
      if (entry.period !== null && entry.period !== undefined) return false;
    } else if (label !== want && raw !== want && `p${raw}` !== want) {
      return false;
    }
  }
  return true;
}

export function filterLibrary(
  entries: readonly LibraryEntry[],
  filters: LibraryFilters,
): RankedFuzzy<LibraryEntry>[] {
  const structured = entries.filter((e) => matchesStructured(e, filters));
  return rankFuzzy(filters.query, structured, searchFields);
}

export function uniqueRulesets(entries: readonly LibraryEntry[]): string[] {
  return [...new Set(entries.map((e) => e.ruleset))].sort();
}

export function uniqueTags(entries: readonly LibraryEntry[], ruleset: string): string[] {
  const tags = new Set<string>();
  for (const e of entries) {
    if (ruleset && e.ruleset !== ruleset) continue;
    for (const t of e.tags) tags.add(t);
  }
  return [...tags].sort();
}

export function uniquePeriods(entries: readonly LibraryEntry[], ruleset: string): number[] {
  const periods = new Set<number>();
  for (const e of entries) {
    if (ruleset && e.ruleset !== ruleset) continue;
    if (e.period != null) periods.add(e.period);
  }
  return [...periods].sort((a, b) => a - b);
}

export function attributionLine(entry: LibraryEntry): string {
  const who = entry.author?.trim();
  if (!who) return '';
  if (entry.year != null) return `${who}, ${entry.year}`;
  return who;
}
