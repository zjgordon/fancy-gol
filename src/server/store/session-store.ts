/**
 * File-backed storage for shared sessions (P1-F-2's "fall back to a server-stored session with a
 * short id" — ADR-002's `POST /api/sessions ← SessionDoc → { id, shareUrl }` /
 * `GET /api/sessions/:id → SessionDoc`). "Persistence is file-backed JSON on a mounted volume —
 * no database" (ADR-002's consequences) — one JSON file per session, named by its id, under a
 * directory created on first use.
 *
 * Unlike P1-G-1's future ruleset store (ids a *user* proposes, so it needs an atomic
 * temp-file-then-rename update path to survive a concurrent write to the *same* id), a shared
 * session's id is always server-generated and a session is create-only — there is no `PUT`
 * in ADR-002's contract, so the only concurrency hazard is two saves colliding on the same
 * randomly-generated id, and the OS's own atomic exclusive-create (`wx`) flag already prevents
 * that without a rename dance.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// Relative + `.js`, not `@shared/session`: `tsconfig.server.json` compiles this with plain `tsc`
// for a `node dist/server/index.js` runtime (no bundler to rewrite path aliases at emit time,
// unlike the client/worker builds, which go through Vite — `worker/*.ts` gets away with
// `@shared`/`@engine` only because Vite bundles it) — an alias specifier would be emitted
// verbatim and fail to resolve, and Node's ESM loader needs a resolvable extension on a relative
// specifier regardless (`index.ts`'s own `./app.js` established this convention).
import { migrateSessionDoc, type SessionDoc } from '../../shared/session.js';

/** Base64url alphabet only — anything else (a `.` or `/`, say) could escape `dir` when joined
 * into a file path, the same path-traversal discipline P1-G-1's own note already names for
 * user-supplied ruleset ids. A session id is always server-generated on `save()`, but `load()`'s
 * id comes straight from a URL param — untrusted input, checked here rather than trusted. */
const ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

export function isValidSessionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function generateId(): string {
  // 8 random bytes -> 11 base64url characters, ~64 bits of entropy — plenty for an unguessable
  // share link that is not protecting a secret, only avoiding casual enumeration.
  return randomBytes(8).toString('base64url');
}

export interface SessionStore {
  /** Persists `doc` under a newly-generated id and returns it. */
  save(doc: SessionDoc): Promise<string>;
  /** `null` for an unknown, malformed, or corrupt-on-disk id — never a thrown error for
   * something a client can trigger just by guessing a URL. */
  load(id: string): Promise<SessionDoc | null>;
}

const MAX_ID_ATTEMPTS = 5;

export interface SessionStoreOptions {
  /** Defaults to the real random generator. Injected so a test can force the collision-retry
   * path (and its exhaustion) deterministically instead of hoping for a 64-bit coincidence. */
  readonly idGenerator?: () => string;
}

/** `dir` is created (recursively) on first `save()`, not at construction — a store that's only
 * ever `load()`-ed (the far more common request) never needs write access to the volume at all. */
export function createFileSessionStore(dir: string, options: SessionStoreOptions = {}): SessionStore {
  const idGenerator = options.idGenerator ?? generateId;

  function pathFor(id: string): string {
    return join(dir, `${id}.json`);
  }

  async function save(doc: SessionDoc): Promise<string> {
    await mkdir(dir, { recursive: true });
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const id = idGenerator();
      try {
        // 'wx': atomically fail with EEXIST rather than silently overwrite a previous id
        // collision — astronomically unlikely at 64 bits, checked anyway rather than trusted.
        await writeFile(pathFor(id), JSON.stringify(doc), { flag: 'wx' });
        return id;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
    throw new Error(`could not allocate a unique session id after ${MAX_ID_ATTEMPTS} attempts`);
  }

  async function load(id: string): Promise<SessionDoc | null> {
    if (!isValidSessionId(id)) return null;
    try {
      const raw = await readFile(pathFor(id), 'utf8');
      return migrateSessionDoc(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  return { save, load };
}
