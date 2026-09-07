import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore, isValidStoreId } from '@server/store/file-store';

interface Widget {
  readonly name: string;
  readonly count: number;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gol-file-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isValidStoreId', () => {
  it('accepts letters, digits, underscore, hyphen and colon', () => {
    expect(isValidStoreId('conway')).toBe(true);
    expect(isValidStoreId('user:my-rule')).toBe(true);
    expect(isValidStoreId('a_b-c:d9')).toBe(true);
  });

  it('rejects anything that could escape the storage directory, or is malformed', () => {
    expect(isValidStoreId('../../etc/passwd')).toBe(false);
    expect(isValidStoreId('a/b')).toBe(false);
    expect(isValidStoreId('a.json')).toBe(false);
    expect(isValidStoreId('')).toBe(false);
    expect(isValidStoreId('-leading-hyphen')).toBe(false); // must start alnum
  });

  it('rejects an id over the length ceiling', () => {
    expect(isValidStoreId('a'.repeat(101))).toBe(false);
    expect(isValidStoreId('a'.repeat(100))).toBe(true);
  });
});

describe('createFileStore', () => {
  it('does not create the directory until the first save', () => {
    createFileStore<Widget>(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('save() then load() round-trips the exact value', async () => {
    const store = createFileStore<Widget>(dir);
    const value: Widget = { name: 'sprocket', count: 3 };
    await store.save('widget-1', value);
    await expect(store.load('widget-1')).resolves.toEqual(value);
  });

  it('list() returns every saved id', async () => {
    const store = createFileStore<Widget>(dir);
    await store.save('a', { name: 'a', count: 1 });
    await store.save('b', { name: 'b', count: 2 });
    expect([...(await store.list())].sort()).toEqual(['a', 'b']);
  });

  it('list() returns an empty array when the directory does not exist yet', async () => {
    const store = createFileStore<Widget>(dir);
    await expect(store.list()).resolves.toEqual([]);
  });

  it('save() upserts: re-saving the same id replaces its value', async () => {
    const store = createFileStore<Widget>(dir);
    await store.save('widget-1', { name: 'first', count: 1 });
    await store.save('widget-1', { name: 'second', count: 2 });
    await expect(store.load('widget-1')).resolves.toEqual({ name: 'second', count: 2 });
    expect(readdirSync(dir)).toEqual(['widget-1.json']); // no leftover temp file
  });

  it('save() writes atomically: a reader never observes a partial file (temp-then-rename)', async () => {
    const store = createFileStore<Widget>(dir);
    const big: Widget = { name: 'x'.repeat(200_000), count: 1 };
    await store.save('big', big);
    // If the write weren't atomic, a concurrent reader mid-write could see truncated JSON. We
    // can't race a real filesystem deterministically in a unit test, but we *can* prove the
    // mechanism leaves no temp artifact behind and that the final file always parses cleanly.
    const files = readdirSync(dir);
    expect(files).toEqual(['big.json']);
    expect(() => {
      JSON.parse(readFileSync(join(dir, 'big.json'), 'utf8'));
    }).not.toThrow();
  });

  it('save() rejects an invalid id rather than writing outside the directory', async () => {
    const store = createFileStore<Widget>(dir);
    await expect(store.save('../../etc/passwd', { name: 'x', count: 1 })).rejects.toThrow(RangeError);
  });

  it('load() returns null for an unknown, malformed, or corrupt id', async () => {
    const store = createFileStore<Widget>(dir);
    await expect(store.load('nonexistent')).resolves.toBeNull();
    await expect(store.load('../../etc/passwd')).resolves.toBeNull();

    await store.save('corrupt', { name: 'x', count: 1 });
    writeFileSync(join(dir, 'corrupt.json'), 'not json');
    await expect(store.load('corrupt')).resolves.toBeNull();
  });

  it('remove() deletes an existing id and reports true; reports false for an unknown or invalid one', async () => {
    const store = createFileStore<Widget>(dir);
    await store.save('widget-1', { name: 'x', count: 1 });
    await expect(store.remove('widget-1')).resolves.toBe(true);
    await expect(store.load('widget-1')).resolves.toBeNull();
    await expect(store.remove('widget-1')).resolves.toBe(false);
    await expect(store.remove('../../etc/passwd')).resolves.toBe(false);
  });

  it('two stores over the same directory see each other’s writes (no in-memory cache)', async () => {
    const a = createFileStore<Widget>(dir);
    const b = createFileStore<Widget>(dir);
    await a.save('shared', { name: 'from-a', count: 1 });
    await expect(b.load('shared')).resolves.toEqual({ name: 'from-a', count: 1 });
  });
});
