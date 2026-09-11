import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '@server/app';
import {
  buildCatalogIndex,
  deriveUserPatternId,
  filterPatternSummaries,
  loadCuratedRecords,
  loadPatterns,
  parsePatternFile,
  type PatternSummary,
} from '@server/routes/patterns';
import { decodeRLE } from '@ui/tools/select';
import { BUILTIN_STAMPS } from '@ui/tools/stamp';

const FIXTURE_DIST = fileURLToPath(new URL('../../fixtures/server/dist-client', import.meta.url));
const REAL_PATTERNS_DIR = fileURLToPath(new URL('../../../patterns', import.meta.url));

const GLIDER_RLE = 'x = 3, y = 3\nbo$\n2bo$\n3o!';

describe('parsePatternFile (pure)', () => {
  it('extracts name, description, author and dimensions from RLE header comments', () => {
    const text = ['#N Glider', '#O Richard K. Guy, 1970', '#C The smallest spaceship.', 'x = 3, y = 3, rule = B3/S23', 'bo$', '2bo$', '3o!'].join(
      '\n',
    );
    const summary = parsePatternFile('glider', text, 'conway');
    expect(summary.id).toBe('glider');
    expect(summary.name).toBe('Glider');
    expect(summary.description).toBe('The smallest spaceship.');
    expect(summary.author).toBe('Richard K. Guy, 1970');
    expect(summary.ruleset).toBe('conway');
    expect(summary.width).toBe(3);
    expect(summary.height).toBe(3);
    expect(summary.origin).toBe('curated');
    expect(summary.rle).toBe('x = 3, y = 3\nbo$\n2bo$\n3o!');
  });

  it('joins multiple free-form #C lines with a space, and ignores SPDX provenance keys', () => {
    const text = ['#N Two-line', '#C First sentence.', '#C Second sentence.', 'x = 1, y = 1', 'o!'].join('\n');
    expect(parsePatternFile('x', text, 'conway').description).toBe('First sentence. Second sentence.');
  });

  it('prefers #C description: over provenance comments', () => {
    const text = [
      '#N Glider',
      '#C SPDX-License-Identifier: CC0-1.0',
      '#C source: https://example.com/glider',
      '#C description: The smallest spaceship.',
      'x = 3, y = 3',
      'bo$2bo$3o!',
    ].join('\n');
    expect(parsePatternFile('glider', text, 'conway').description).toBe('The smallest spaceship.');
  });

  it('omits author/description entirely when there is no #O/#C line', () => {
    const text = ['#N Bare', 'x = 1, y = 1', 'o!'].join('\n');
    const summary = parsePatternFile('bare', text, 'conway');
    expect(summary).not.toHaveProperty('author');
    expect(summary).not.toHaveProperty('description');
  });

  it('falls back to the file id as the name when there is no #N line', () => {
    const text = ['x = 1, y = 1', 'o!'].join('\n');
    expect(parsePatternFile('no-name-file', text, 'conway').name).toBe('no-name-file');
  });

  it('reads ruleset from #C ruleset: when the caller does not override', () => {
    const text = ['#N R', '#C ruleset: highlife', 'x = 1, y = 1', 'o!'].join('\n');
    expect(parsePatternFile('r', text).ruleset).toBe('highlife');
  });

  it('ignores comment tags it does not understand (e.g. #R)', () => {
    const text = ['#N Foo', '#R some-other-tag', 'x = 1, y = 1', 'o!'].join('\n');
    expect(() => parsePatternFile('foo', text, 'conway')).not.toThrow();
  });
});

describe('deriveUserPatternId (pure)', () => {
  it('slugifies a friendly name into a namespaced id', () => {
    expect(deriveUserPatternId('My Cool Glider')).toBe('user:my-cool-glider');
  });

  it('rejects a path-traversal attempt outright', () => {
    expect(deriveUserPatternId('../../etc/passwd')).toBeNull();
  });
});

describe('filterPatternSummaries (P2-B-4 AC1)', () => {
  function fake(id: string, extra: Partial<PatternSummary> = {}): PatternSummary {
    return {
      id,
      name: extra.name ?? id,
      aliases: extra.aliases ?? [],
      ...(extra.description !== undefined ? { description: extra.description } : {}),
      ...(extra.author !== undefined ? { author: extra.author } : {}),
      ruleset: extra.ruleset ?? 'conway',
      category: extra.category ?? 'still-life',
      tags: extra.tags ?? [],
      width: 3,
      height: 3,
      origin: extra.origin ?? 'curated',
    };
  }

  it('filters by ruleset, category, tag, and free-text q', () => {
    const all = [
      fake('glider', { name: 'Glider', category: 'spaceship', tags: ['staple'], author: 'Richard K. Guy' }),
      fake('block', { name: 'Block', tags: ['still'] }),
      fake('highlife-seed', { name: 'HighLife seed', ruleset: 'highlife', category: 'seed' }),
      fake('gosper-gun', { name: 'Gosper glider gun', category: 'gun', tags: ['p30'], description: 'A period-30 gun' }),
    ];
    expect(filterPatternSummaries(all, { ruleset: 'highlife' }).map((p) => p.id)).toEqual(['highlife-seed']);
    expect(filterPatternSummaries(all, { category: 'spaceship' }).map((p) => p.id)).toEqual(['glider']);
    expect(filterPatternSummaries(all, { tag: 'p30' }).map((p) => p.id)).toEqual(['gosper-gun']);
    expect(filterPatternSummaries(all, { q: 'gosp' }).map((p) => p.id)).toEqual(['gosper-gun']);
    expect(filterPatternSummaries(all, { q: 'guy' }).map((p) => p.id)).toEqual(['glider']);
  });

  it('filters 250 summaries in well under 20 ms', () => {
    const all = Array.from({ length: 250 }, (_, i) =>
      fake(`pat-${i}`, {
        name: i === 42 ? 'Gosper glider gun' : `Pattern ${i}`,
        ruleset: i === 42 ? 'conway' : i % 7 === 0 ? 'highlife' : 'conway',
        category: i % 3 === 0 ? 'oscillator' : 'still-life',
        tags: i % 5 === 0 ? ['p30'] : ['staple'],
      }),
    );
    const t0 = performance.now();
    const hits = filterPatternSummaries(all, { ruleset: 'conway', q: 'gosp' });
    const elapsed = performance.now() - t0;
    expect(hits.map((p) => p.id)).toEqual(['pat-42']);
    expect(elapsed).toBeLessThan(20);
  });
});

describe('loadPatterns', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gol-patterns-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads every .rle file in the directory, sorted by id', () => {
    writeFileSync(join(dir, 'b.rle'), '#N B\nx = 1, y = 1\no!');
    writeFileSync(join(dir, 'a.rle'), '#N A\nx = 1, y = 1\no!');
    writeFileSync(join(dir, 'ignored.txt'), 'not a pattern');
    const patterns = loadPatterns(dir);
    expect(patterns.map((p) => p.id)).toEqual(['a', 'b']);
    expect(patterns[0]).not.toHaveProperty('rle');
  });

  it('loads the real bundled patterns/ directory: the P2-B-1 seed set', () => {
    const patterns = loadPatterns(REAL_PATTERNS_DIR);
    expect(patterns.length).toBeGreaterThanOrEqual(40);
    const rulesets = new Set(patterns.map((p) => p.ruleset));
    expect(rulesets.size).toBeGreaterThanOrEqual(4);
    for (const p of patterns) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(p.origin).toBe('curated');
    }
  });

  it('never silently diverges from ui/tools/stamp.ts’s BUILTIN_STAMPS (same ten ids, same cells)', () => {
    const serverPatterns = loadCuratedRecords(REAL_PATTERNS_DIR);
    expect(serverPatterns.map((p) => p.summary.id)).toEqual(expect.arrayContaining([...BUILTIN_STAMPS.map((s) => s.id)]));

    for (const stamp of BUILTIN_STAMPS) {
      const serverPattern = serverPatterns.find((p) => p.summary.id === stamp.id);
      expect(serverPattern, `no server-side pattern for stamp "${stamp.id}"`).toBeDefined();
      const fromServer = decodeRLE(serverPattern!.rle);
      const fromStamp = decodeRLE(stamp.rle);
      expect(fromServer).toEqual(fromStamp);
    }
  });

  it('committed patterns/index.json matches a fresh walk of the catalogue', () => {
    const live = buildCatalogIndex(REAL_PATTERNS_DIR);
    const committed = JSON.parse(readFileSync(join(REAL_PATTERNS_DIR, 'index.json'), 'utf8')) as PatternSummary[];
    expect(committed.map((p) => p.id)).toEqual(live.map((p) => p.id));
  });
});

let server: Server;
let baseUrl: string;
let userPatternsDir: string;

beforeEach(async () => {
  userPatternsDir = mkdtempSync(join(tmpdir(), 'gol-user-patterns-'));
  const app = createApp({ distDir: FIXTURE_DIST, version: '9.9.9-test', userPatternsDir });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(userPatternsDir, { recursive: true, force: true });
});

describe('GET /api/patterns', () => {
  it('returns the seed catalogue with complete metadata and no RLE bodies', async () => {
    const res = await fetch(`${baseUrl}/api/patterns`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(40);
    for (const pattern of body) {
      expect(typeof pattern['id']).toBe('string');
      expect(typeof pattern['name']).toBe('string');
      expect(typeof pattern['ruleset']).toBe('string');
      expect(typeof pattern['width']).toBe('number');
      expect(typeof pattern['height']).toBe('number');
      expect(pattern['origin']).toBe('curated');
      expect(pattern).not.toHaveProperty('rle');
    }
    const gosper = body.find((p) => p['id'] === 'gosper-gun');
    expect(gosper?.['author']).toBe('Bill Gosper');
    expect(gosper?.['year']).toBe(1970);
    expect(gosper?.['period']).toBe(30);
    expect(typeof gosper?.['source']).toBe('string');
    expect(gosper?.['source']).toMatch(/^https?:\/\//);
  });

  it('GET /api/patterns/index.json is the same list', async () => {
    const a = await fetch(`${baseUrl}/api/patterns`);
    const b = await fetch(`${baseUrl}/api/patterns/index.json`);
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual(await a.json());
  });

  it('?ruleset=conway returns only Conway patterns, and at least the Phase 1 ten', async () => {
    const res = await fetch(`${baseUrl}/api/patterns?ruleset=conway`);
    const body = (await res.json()) as Array<{ ruleset: string }>;
    expect(body.length).toBeGreaterThanOrEqual(10);
    expect(body.every((p) => p.ruleset === 'conway')).toBe(true);
  });

  it('?ruleset=highlife returns the HighLife seed, not an empty list', async () => {
    const res = await fetch(`${baseUrl}/api/patterns?ruleset=highlife`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('?q=gosp finds the Gosper glider gun', async () => {
    const res = await fetch(`${baseUrl}/api/patterns?q=gosp`);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((p) => p.id === 'gosper-gun')).toBe(true);
  });

  it('?ruleset=<unknown> returns an empty array, not an error', async () => {
    const res = await fetch(`${baseUrl}/api/patterns?ruleset=not-a-ruleset`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });

  it('list responses are private/no-store so a POST is visible on the next GET', async () => {
    const res = await fetch(`${baseUrl}/api/patterns`);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('GET /api/patterns/:id', () => {
  it('returns { meta, rle } for a curated pattern, cacheable', async () => {
    const res = await fetch(`${baseUrl}/api/patterns/glider`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/public/);
    const body = (await res.json()) as { meta: { id: string; origin: string }; rle: string };
    expect(body.meta.id).toBe('glider');
    expect(body.meta.origin).toBe('curated');
    expect(body.rle).toContain('3o!');
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/patterns/not-a-pattern`);
    expect(res.status).toBe(404);
  });

  it('returns 400, not 404, for a path-traversal id', async () => {
    const res = await fetch(`${baseUrl}/api/patterns/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/patterns', () => {
  it('stores a valid pattern and lists it alongside curated ones, origin=user', async () => {
    const post = await fetch(`${baseUrl}/api/patterns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My Glider', rle: GLIDER_RLE, ruleset: 'conway' }),
    });
    expect(post.status).toBe(201);
    const { id } = (await post.json()) as { id: string };
    expect(id).toBe('user:my-glider');

    const list = (await (await fetch(`${baseUrl}/api/patterns`)).json()) as Array<{ id: string; origin: string }>;
    const saved = list.find((p) => p.id === id);
    expect(saved).toBeDefined();
    expect(saved!.origin).toBe('user');
    expect(list.some((p) => p.origin === 'curated')).toBe(true);

    const body = await fetch(`${baseUrl}/api/patterns/${encodeURIComponent(id)}`);
    expect(body.status).toBe(200);
    const payload = (await body.json()) as { meta: { origin: string }; rle: string };
    expect(payload.meta.origin).toBe('user');
    expect(payload.rle).toContain('3o!');
  });

  it('rejects invalid RLE with 400', async () => {
    const res = await fetch(`${baseUrl}/api/patterns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope', rle: 'this is not rle' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a path-traversal id with 400', async () => {
    const res = await fetch(`${baseUrl}/api/patterns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', id: '../../etc/passwd', rle: GLIDER_RLE }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a body over the size limit', async () => {
    const res = await fetch(`${baseUrl}/api/patterns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Huge', rle: 'x = 1, y = 1\n' + 'o'.repeat(1_200_000) + '!' }),
    });
    expect(res.status).toBe(413);
  });
});
