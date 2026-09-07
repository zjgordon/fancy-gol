/**
 * `/api/patterns` (ADR-002, P1-G-2 "skeleton"): serves the ten Phase 1 patterns from `.rle`
 * files under the repo-root `patterns/` directory.
 *
 *   GET /api/patterns?ruleset=<id> -> PatternSummary[]
 *
 * These are the exact same ten patterns `ui/tools/stamp.ts`'s `BUILTIN_STAMPS` already ships —
 * independently duplicated here on disk, not read from that module or generated from it: ADR-002
 * requires the client to keep its own bundled copy so the stamp tool works with the server
 * unreachable ("the app must be fully functional... a bundled starter pattern set ships in the
 * client bundle"), so this is a second, server-side source of the same content, not a refactor
 * of the first. `tests/unit/server/patterns-route.spec.ts` decodes both copies and cross-checks
 * every one resolves to the identical set of live cells, so the two can never silently diverge.
 *
 * "The query interface Phase 2 will fill out": `ruleset` is the only filter today (every one of
 * these ten is a classic Conway's-Life pattern, so all ten answer `?ruleset=conway`); Phase 2's
 * P2-B-4 (server pattern routes, complete) adds search/tags/pagination against this same
 * response shape — "establish the response shape now so the client never changes" (this task's
 * own words) is why `PatternSummary` is written to grow, not to be replaced.
 */
import { Router } from 'express';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATTERNS_DIR = fileURLToPath(new URL('../../../patterns', import.meta.url));

export interface PatternSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  /** Which ruleset this pattern is designed for — a hardcoded tag today (every Phase 1 pattern
   * is Conway's Life), a real field once Phase 2 stores patterns for other rulesets too. */
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
export function parsePatternFile(id: string, text: string, ruleset: string): PatternSummary {
  let name = id;
  let author: string | undefined;
  const descriptionLines: string[] = [];
  let width = 0;
  let height = 0;
  const bodyLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#N ')) name = line.slice(3).trim();
    else if (line.startsWith('#O ')) author = line.slice(3).trim();
    else if (line.startsWith('#C ')) descriptionLines.push(line.slice(3).trim());
    else if (line.startsWith('#')) continue; // other comment tags (e.g. #R) -- not needed yet
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

  return {
    id,
    name,
    ...(descriptionLines.length > 0 ? { description: descriptionLines.join(' ') } : {}),
    ...(author !== undefined ? { author } : {}),
    ruleset,
    width,
    height,
    rle: `x = ${width}, y = ${height}\n${bodyLines.join('\n')}`,
  };
}

/** Every Phase 1 pattern is a Conway's-Life classic — a single hardcoded tag until Phase 2 stores
 * the ruleset a pattern actually belongs to alongside it. */
const DEFAULT_RULESET_TAG = 'conway';

export function loadPatterns(dir: string): readonly PatternSummary[] {
  return readdirSync(dir)
    .filter((name) => extname(name) === '.rle')
    .map((fileName) => {
      const id = fileName.slice(0, -'.rle'.length);
      const text = readFileSync(join(dir, fileName), 'utf8');
      return parsePatternFile(id, text, DEFAULT_RULESET_TAG);
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
