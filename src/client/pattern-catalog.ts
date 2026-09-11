/**
 * P2-B-4 — load the pattern catalogue from `/api/patterns`, falling back to the ten bundled
 * stamps when the server is unreachable (ADR-002: network features degrade, they do not break).
 *
 * Lives in `client/` because it talks to the network. The picker in `ui/` only renders whatever
 * list it is given.
 */
import { BUILTIN_STAMPS, type StampDefinition } from '@ui/tools/stamp';

export const LIBRARY_OFFLINE_NOTICE = 'Library is using the bundled starter set — the server is unreachable.';

export type PatternOrigin = 'curated' | 'user' | 'bundled';

export interface CatalogPattern {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly author?: string;
  readonly ruleset: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly origin: PatternOrigin;
  readonly rle?: string;
}

export type CatalogSource = 'api' | 'bundled';

export interface CatalogLoad {
  readonly patterns: readonly CatalogPattern[];
  readonly source: CatalogSource;
}

export function bundledCatalog(stamps: readonly StampDefinition[] = BUILTIN_STAMPS): CatalogPattern[] {
  return stamps.map((s) => ({
    id: s.id,
    name: s.name,
    aliases: [],
    ruleset: 'conway',
    category: 'curiosity',
    tags: [],
    width: 0,
    height: 0,
    origin: 'bundled',
    rle: s.rle,
  }));
}

function isCatalogPattern(raw: unknown): raw is CatalogPattern {
  if (raw === null || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return typeof o['id'] === 'string' && typeof o['name'] === 'string';
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function loadPatternCatalog(options: {
  readonly fetchImpl?: FetchLike;
  readonly bundled?: readonly StampDefinition[];
} = {}): Promise<CatalogLoad> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fallback = bundledCatalog(options.bundled);
  try {
    const res = await fetchImpl('/api/patterns');
    if (!res.ok) return { patterns: fallback, source: 'bundled' };
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { patterns: fallback, source: 'bundled' };
    const patterns = body.filter(isCatalogPattern).map((p) => ({
      ...p,
      aliases: Array.isArray(p.aliases) ? p.aliases : [],
      tags: Array.isArray(p.tags) ? p.tags : [],
      ruleset: typeof p.ruleset === 'string' ? p.ruleset : 'conway',
      category: typeof p.category === 'string' ? p.category : 'curiosity',
      width: typeof p.width === 'number' ? p.width : 0,
      height: typeof p.height === 'number' ? p.height : 0,
      origin: p.origin === 'user' || p.origin === 'curated' || p.origin === 'bundled' ? p.origin : 'curated',
    }));
    if (patterns.length === 0) return { patterns: fallback, source: 'bundled' };
    return { patterns, source: 'api' };
  } catch {
    return { patterns: fallback, source: 'bundled' };
  }
}

export async function fetchPatternRle(id: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl(`/api/patterns/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`pattern ${id} not found`);
  const body: unknown = await res.json();
  if (body === null || typeof body !== 'object') throw new Error(`pattern ${id} has no body`);
  const rle = (body as { rle?: unknown }).rle;
  if (typeof rle !== 'string' || rle.length === 0) throw new Error(`pattern ${id} has no rle`);
  return rle;
}

export function stampsFromCatalog(patterns: readonly CatalogPattern[]): StampDefinition[] {
  return patterns
    .filter((p): p is CatalogPattern & { rle: string } => typeof p.rle === 'string' && p.rle.length > 0)
    .map((p) => ({ id: p.id, name: p.name, rle: p.rle }));
}
