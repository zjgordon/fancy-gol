/**
 * A generic file-backed key/value store (P1-G-1): one JSON file per id, under a directory
 * created on first write. Generic over the stored value's type so a future store (patterns,
 * P1-G-2) can reuse it without re-deriving the same temp-file-then-rename dance.
 *
 * Unlike P1-F-2's `session-store.ts` (server-generated ids, create-only — a share is never
 * edited, so the OS's atomic exclusive-create flag was enough), `save()` here is an *upsert*:
 * a user re-submitting the same ruleset id is a real, expected case (editing and re-saving), and
 * this task's own acceptance criterion requires that a concurrent write never corrupts the file.
 * `writeFile` alone offers no such guarantee — a reader can observe a partially-written file
 * mid-write. Writing to a uniquely-named temp file first, then `rename()`-ing it into place,
 * gets the guarantee for free: POSIX (and Windows, since Node 12) `rename` onto an existing path
 * is atomic, so any concurrent reader always sees either the complete old file or the complete
 * new one, never a torn write.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Deliberately permissive (letters, digits, `_`, `-`, `:`) but closed over exactly that set —
 * `.` and `/` are never in it, so no id this accepts can ever escape `dir` when joined into a
 * path, the same discipline `session-store.ts`'s own `isValidSessionId` applies to its narrower
 * id shape. Callers layer their own stricter, domain-specific rules (`rulesets.ts`'s slugifying)
 * on top; this is the last line of defence, not the only one. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,99}$/;

export function isValidStoreId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export interface FileStore<T> {
  /** Every id currently stored, in no particular order. */
  list(): Promise<readonly string[]>;
  /** `null` for an unknown, malformed, or corrupt-on-disk id — never a thrown error for
   * something a caller can trigger just by asking about the wrong id. */
  load(id: string): Promise<T | null>;
  /** Creates or atomically replaces `id`'s stored value. */
  save(id: string, value: T): Promise<void>;
  /** `true` iff a file existed and was removed. */
  remove(id: string): Promise<boolean>;
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/** `dir` is created (recursively) on first `save()`, not at construction — a store that's only
 * ever read never needs write access to the volume at all (`session-store.ts`'s own note). */
export function createFileStore<T>(dir: string): FileStore<T> {
  function pathFor(id: string): string {
    return join(dir, `${id}.json`);
  }

  async function list(): Promise<readonly string[]> {
    try {
      const entries = await readdir(dir);
      return entries.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
  }

  async function load(id: string): Promise<T | null> {
    if (!isValidStoreId(id)) return null;
    try {
      return JSON.parse(await readFile(pathFor(id), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  async function save(id: string, value: T): Promise<void> {
    if (!isValidStoreId(id)) throw new RangeError(`invalid store id: "${id}"`);
    await mkdir(dir, { recursive: true });
    // A random suffix, not a fixed `.tmp` name: two concurrent saves to *different* ids already
    // can't collide (different final paths), but this also keeps two concurrent saves to the
    // *same* id from racing on one shared temp file while each writes and renames independently.
    const tmpPath = join(dir, `.${id}.${randomBytes(4).toString('hex')}.tmp`);
    await writeFile(tmpPath, JSON.stringify(value));
    await rename(tmpPath, pathFor(id));
  }

  async function remove(id: string): Promise<boolean> {
    if (!isValidStoreId(id)) return false;
    try {
      await rm(pathFor(id));
      return true;
    } catch (err) {
      if (isEnoent(err)) return false;
      throw err;
    }
  }

  return { list, load, save, remove };
}
