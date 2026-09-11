import { describe, expect, it } from 'vitest';
import {
  LIBRARY_OFFLINE_NOTICE,
  bundledCatalog,
  fetchPatternRle,
  loadPatternCatalog,
  stampsFromCatalog,
} from '../../../src/client/pattern-catalog';
import { BUILTIN_STAMPS } from '@ui/tools/stamp';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('bundledCatalog', () => {
  it('is the ten Phase 1 stamps, origin bundled, with RLE already attached', () => {
    const bundled = bundledCatalog();
    expect(bundled).toHaveLength(BUILTIN_STAMPS.length);
    expect(bundled.every((p) => p.origin === 'bundled' && typeof p.rle === 'string')).toBe(true);
    expect(stampsFromCatalog(bundled).map((s) => s.id)).toEqual(BUILTIN_STAMPS.map((s) => s.id));
  });
});

describe('loadPatternCatalog', () => {
  it('uses the API list when it is reachable, preserving user vs curated origin', async () => {
    const result = await loadPatternCatalog({
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse([
            { id: 'glider', name: 'Glider', origin: 'curated', ruleset: 'conway', category: 'spaceship', tags: [], aliases: [], width: 3, height: 3 },
            { id: 'user:mine', name: 'Mine', origin: 'user', ruleset: 'conway', category: 'curiosity', tags: [], aliases: [], width: 3, height: 3 },
          ]),
        ),
    });
    expect(result.source).toBe('api');
    expect(result.patterns.map((p) => p.origin)).toEqual(['curated', 'user']);
  });

  it('falls back to the bundled starter set when fetch throws', async () => {
    const result = await loadPatternCatalog({
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(result.source).toBe('bundled');
    expect(result.patterns).toHaveLength(BUILTIN_STAMPS.length);
    expect(LIBRARY_OFFLINE_NOTICE).toMatch(/unreachable/);
  });

  it('falls back when the API is unhappy', async () => {
    const result = await loadPatternCatalog({ fetchImpl: () => Promise.resolve(jsonResponse({ error: 'nope' }, 503)) });
    expect(result.source).toBe('bundled');
  });
});

describe('fetchPatternRle', () => {
  it('reads rle from GET /api/patterns/:id', async () => {
    const rle = await fetchPatternRle('glider', (url) => {
      expect(url).toBe('/api/patterns/glider');
      return Promise.resolve(jsonResponse({ meta: { id: 'glider' }, rle: 'x = 3, y = 3\nbo$2bo$3o!' }));
    });
    expect(rle).toContain('3o!');
  });
});
