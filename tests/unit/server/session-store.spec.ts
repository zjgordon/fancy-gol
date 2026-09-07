import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionDoc } from '@shared/session';
import { createFileSessionStore, isValidSessionId } from '@server/store/session-store';

function doc(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: 'x = 1, y = 1\no!',
    gridOrigin: { x: 0, y: 0 },
    tick: 0,
    seed: 1,
    camera: { originX: 0, originY: 0, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
    ...overrides,
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gol-session-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isValidSessionId', () => {
  it('accepts base64url ids in the expected length range', () => {
    expect(isValidSessionId('cFcZvYY9yg8')).toBe(true);
    expect(isValidSessionId('abcdef')).toBe(true);
  });

  it('rejects anything that could escape the storage directory or is malformed', () => {
    expect(isValidSessionId('../../etc/passwd')).toBe(false);
    expect(isValidSessionId('a/b')).toBe(false);
    expect(isValidSessionId('a.json')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('short')).toBe(false); // below the 6-char floor
    expect(isValidSessionId('x'.repeat(33))).toBe(false); // above the 32-char ceiling
  });
});

describe('createFileSessionStore', () => {
  it('does not create the directory until the first save', () => {
    createFileSessionStore(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('save() returns a valid id, and load() returns the exact document back', async () => {
    const store = createFileSessionStore(dir);
    const original = doc({ tick: 42 });
    const id = await store.save(original);
    expect(isValidSessionId(id)).toBe(true);
    await expect(store.load(id)).resolves.toEqual(original);
  });

  it('creates one JSON file per session, named by its id', async () => {
    const store = createFileSessionStore(dir);
    const id = await store.save(doc());
    expect(readdirSync(dir)).toEqual([`${id}.json`]);
  });

  it('load() returns null for an id that was never saved', async () => {
    const store = createFileSessionStore(dir);
    await expect(store.load('nonexistent1')).resolves.toBeNull();
  });

  it('load() returns null (never throws) for a malformed or path-traversal id', async () => {
    const store = createFileSessionStore(dir);
    await expect(store.load('../../etc/passwd')).resolves.toBeNull();
    await expect(store.load('a/b')).resolves.toBeNull();
  });

  it('load() returns null for a file that exists but is not a valid SessionDoc', async () => {
    const store = createFileSessionStore(dir);
    // Simulate corruption by saving, then overwriting the file with garbage.
    const id = await store.save(doc());
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, `${id}.json`), 'not json');
    await expect(store.load(id)).resolves.toBeNull();
  });

  it('two saves never collide on the same id', async () => {
    const store = createFileSessionStore(dir);
    const ids = await Promise.all(Array.from({ length: 20 }, () => store.save(doc())));
    expect(new Set(ids).size).toBe(20);
  });

  it('retries with a new id when the generator produces one that already exists on disk', async () => {
    const ids = ['taken-id-1', 'taken-id-1', 'fresh-id-1'];
    let call = 0;
    const store = createFileSessionStore(dir, { idGenerator: () => ids[call++] ?? 'unreachable' });

    const first = await store.save(doc());
    expect(first).toBe('taken-id-1');

    // The second save's generator collides once (the same id the first save already used) before
    // producing a fresh one -- proving the retry loop, not just that saves usually don't collide.
    const second = await store.save(doc({ tick: 2 }));
    expect(second).toBe('fresh-id-1');
    expect(call).toBe(3);
  });

  it('throws after exhausting every retry against a generator that never produces a free id', async () => {
    const store = createFileSessionStore(dir, { idGenerator: () => 'always-the-same-id' });
    await store.save(doc());
    await expect(store.save(doc({ tick: 2 }))).rejects.toThrow(/could not allocate a unique session id/);
  });
});
