import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '@server/app';
import { loadPatterns, parsePatternFile } from '@server/routes/patterns';
import { decodeRLE } from '@ui/tools/select';
import { BUILTIN_STAMPS } from '@ui/tools/stamp';

const FIXTURE_DIST = fileURLToPath(new URL('../../fixtures/server/dist-client', import.meta.url));
const REAL_PATTERNS_DIR = fileURLToPath(new URL('../../../patterns', import.meta.url));

describe('parsePatternFile (pure)', () => {
  it('extracts name, description, author and dimensions from RLE header comments', () => {
    const text = ['#N Glider', '#O Richard K. Guy, 1970', '#C The smallest spaceship.', 'x = 3, y = 3, rule = B3/S23', 'bo$', '2bo$', '3o!'].join(
      '\n',
    );
    const summary = parsePatternFile('glider', text, 'conway');
    expect(summary).toEqual({
      id: 'glider',
      name: 'Glider',
      description: 'The smallest spaceship.',
      author: 'Richard K. Guy, 1970',
      ruleset: 'conway',
      width: 3,
      height: 3,
      rle: 'x = 3, y = 3\nbo$\n2bo$\n3o!',
    });
  });

  it('joins multiple #C lines with a space', () => {
    const text = ['#N Two-line', '#C First sentence.', '#C Second sentence.', 'x = 1, y = 1', 'o!'].join('\n');
    expect(parsePatternFile('x', text, 'conway').description).toBe('First sentence. Second sentence.');
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

  it('ignores comment tags it does not understand (e.g. #R)', () => {
    const text = ['#N Foo', '#R some-other-tag', 'x = 1, y = 1', 'o!'].join('\n');
    expect(() => parsePatternFile('foo', text, 'conway')).not.toThrow();
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
  });

  it('loads the real bundled patterns/ directory: exactly the ten Phase 1 patterns (P1-G-2 AC1)', () => {
    const patterns = loadPatterns(REAL_PATTERNS_DIR);
    expect(patterns).toHaveLength(10);
    for (const p of patterns) {
      expect(p.ruleset).toBe('conway');
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }
  });

  it('never silently diverges from ui/tools/stamp.ts’s BUILTIN_STAMPS (same ten patterns, same cells)', () => {
    const serverPatterns = loadPatterns(REAL_PATTERNS_DIR);
    expect(serverPatterns.map((p) => p.id).sort()).toEqual([...BUILTIN_STAMPS.map((s) => s.id)].sort());

    for (const stamp of BUILTIN_STAMPS) {
      const serverPattern = serverPatterns.find((p) => p.id === stamp.id);
      expect(serverPattern, `no server-side pattern for stamp "${stamp.id}"`).toBeDefined();
      const fromServer = decodeRLE(serverPattern!.rle);
      const fromStamp = decodeRLE(stamp.rle);
      expect(fromServer).toEqual(fromStamp);
    }
  });
});

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const app = createApp({ distDir: FIXTURE_DIST, version: '9.9.9-test' });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('GET /api/patterns', () => {
  it('returns the ten Phase 1 patterns with complete metadata (P1-G-2 AC1)', async () => {
    const res = await fetch(`${baseUrl}/api/patterns`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(10);
    for (const pattern of body) {
      expect(typeof pattern['id']).toBe('string');
      expect(typeof pattern['name']).toBe('string');
      expect(typeof pattern['ruleset']).toBe('string');
      expect(typeof pattern['width']).toBe('number');
      expect(typeof pattern['height']).toBe('number');
      expect(typeof pattern['rle']).toBe('string');
    }
  });

  it('?ruleset=conway returns all ten (every Phase 1 pattern is Conway’s Life)', async () => {
    const res = await fetch(`${baseUrl}/api/patterns?ruleset=conway`);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(10);
  });

  it('?ruleset=<unknown> returns an empty array, not an error', async () => {
    const res = await fetch(`${baseUrl}/api/patterns?ruleset=highlife`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });

  it('responses are cacheable: Cache-Control and ETag are both present (P1-G-2 AC2)', async () => {
    const res = await fetch(`${baseUrl}/api/patterns`);
    expect(res.headers.get('cache-control')).toMatch(/public/);
    expect(res.headers.get('etag')).toBeTruthy();
  });

  it('a second identical request gets the same ETag (stable, deterministic content)', async () => {
    const first = await fetch(`${baseUrl}/api/patterns`);
    const second = await fetch(`${baseUrl}/api/patterns`);
    expect(first.headers.get('etag')).toBe(second.headers.get('etag'));
  });
});
