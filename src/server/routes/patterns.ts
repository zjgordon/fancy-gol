/**
 * `/api/patterns` (ADR-002, P1-G-2 skeleton, P2-B-1 seed): serves curated `.rle` files
 * from the repo-root `patterns/` directory.
 *
 *   GET /api/patterns?ruleset=<id> -> PatternSummary[]
 *
 * The ten Phase 1 stamps in `ui/tools/stamp.ts` remain an independent client copy (ADR-002:
 * the stamp tool works with the server unreachable). This router now also serves the rest of
 * the P2-B-1 seed catalogue. `tests/unit/server/patterns-route.spec.ts` still cross-checks
 * those ten ids against `BUILTIN_STAMPS` so the two copies cannot silently diverge.
 *
 * Ruleset is read from `#C ruleset:` (P2-B-1); P2-B-4 will add search/tags/pagination against
 * this same response shape.
 */
import { Router } from 'express';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATTERNS_DIR = fileURLToPath(new URL('../../../patterns', import.meta.url));

export interface PatternSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  /** Which ruleset this pattern is designed for — read from `#C ruleset:` when present. */
  readonly ruleset: string;
  readonly width: number;
  readonly height: number;
  /** Plain RLE text (the same minimal-codec-compatible shape `ui/tools/select.ts`'s
   * `decodeRLE` already reads), header comments stripped. */
  readonly rle: string;
}

/**
 * A hand-written reader for exactly the subset of the RLE format this task needs — `#N`/`#O`/`#C`
 * header comments and the `x = W, y = H` line — never a full decode into cells; a pattern's
 * *content* stays opaque RLE text all the way to the client, which already owns a real codec.
 * Not `ui/tools/select.ts`'s `decodeRLE`: `server/` may not import `ui/` (ADR-009).
 */
const PROVENANCE_C =
  /^(SPDX-|source:|verified:|ruleset:|category:|period:|speed:|heat:|aliases:|year:|tags:|description:)/i;

export function parsePatternFile(id: string, text: string, ruleset?: string): PatternSummary {
  let name = id;
  let author: string | undefined;
  const descriptionLines: string[] = [];
  const freeCommentLines: string[] = [];
  let fileRuleset: string | undefined;
  let width = 0;
  let height = 0;
  const bodyLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#N')) name = line.slice(2).trim() || name;
    else if (line.startsWith('#O')) author = line.slice(2).trim();
    else if (line.startsWith('#C ') || line.startsWith('#c ')) {
      const rest = line.slice(3).trim();
      if (rest.startsWith('description:')) {
        descriptionLines.push(rest.slice('description:'.length).trim());
      } else if (rest.startsWith('ruleset:')) {
        fileRuleset = rest.slice('ruleset:'.length).trim();
      } else if (!PROVENANCE_C.test(rest)) {
        freeCommentLines.push(rest);
      }
    } else if (line.startsWith('#')) continue; // other comment tags (e.g. #R) -- not needed yet
    else if (/^x\s*=/.test(line)) {
      const m = /^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/.exec(line);
      if (m) {
        width = Number(m[1]);
        height = Number(m[2]);
      }
    } else {
      bodyLines.push(line);
    }
  }

  const description =
    descriptionLines.length > 0
      ? descriptionLines.join(' ')
      : freeCommentLines.length > 0
        ? freeCommentLines.join(' ')
        : undefined;

  return {
    id,
    name,
    ...(description !== undefined ? { description } : {}),
    ...(author !== undefined && author !== '' ? { author } : {}),
    ruleset: ruleset ?? fileRuleset ?? 'conway',
    width,
    height,
    rle: `x = ${width}, y = ${height}\n${bodyLines.join('\n')}`,
  };
}

function listRleFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) listRleFiles(full, out);
    else if (extname(name) === '.rle') out.push(full);
  }
  return out;
}

export function loadPatterns(dir: string): readonly PatternSummary[] {
  return listRleFiles(dir)
    .map((filePath) => {
      const id = basename(filePath, '.rle');
      const text = readFileSync(filePath, 'utf8');
      return parsePatternFile(id, text);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Loads once at router creation, not per request — this is static content bundled with the
 * build, not a live store (unlike `rulesets.ts`/`sessions.ts`'s file-backed stores). `patterns`
 * defaults to the repo-root `patterns/` directory; overridable so a test uses a scratch fixture.
 */
export function createPatternsRouter(dir: string = DEFAULT_PATTERNS_DIR): Router {
  const patterns = loadPatterns(dir);
  const router = Router();

  router.get('/', (req, res) => {
    const { ruleset } = req.query;
    const filtered = typeof ruleset === 'string' ? patterns.filter((p) => p.ruleset === ruleset) : patterns;
    // Cacheable (this task's own acceptance criterion): Express sets a weak ETag on every JSON
    // response by default (`app.set('etag', 'weak')`, never disabled here); Cache-Control is the
    // one header that needs stating explicitly. An hour is generous for content that only ever
    // changes with a new build/deploy, never at runtime.
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(filtered);
  });

  return router;
}
