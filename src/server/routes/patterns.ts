/**
 * `/api/patterns` (ADR-002, P1-G-2 skeleton completed by P2-B-4):
 *
 *   GET    /api/patterns?ruleset=&q=&category=&tag=  → PatternSummary[]
 *   GET    /api/patterns/index.json                  → same (the committed catalogue index)
 *   GET    /api/patterns/:id                         → { meta, rle }
 *   POST   /api/patterns                             ← { name, rle, ruleset?, … } → { id }
 *
 * Curated `.rle` files are loaded once from the repo-root `patterns/` directory. User-saved
 * patterns live on the data volume (`data/patterns`, same FileStore as rulesets). The list
 * mixes both; `origin` is how the client tells them apart. List responses omit RLE bodies so
 * a 200-entry catalogue still filters in well under 20 ms; `GET /:id` is the body.
 *
 * The ten Phase 1 stamps in `ui/tools/stamp.ts` remain an independent client copy (ADR-002:
 * the stamp tool works with the server unreachable). `tests/unit/server/patterns-route.spec.ts`
 * still cross-checks those ten ids against `BUILTIN_STAMPS` so the two copies cannot silently
 * diverge.
 */
import { Router } from 'express';
import express from 'express';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogParseError, parseCatalogEntry } from '../../engine/patterns/catalog.js';
import { PatternParseError, decode } from '../../shared/rle.js';
import { isValidStoreId, type FileStore } from '../store/file-store.js';

const DEFAULT_PATTERNS_DIR = fileURLToPath(new URL('../../../patterns', import.meta.url));

/** A saved drawing's RLE is far smaller than a session's 10 MB share, but a 512² soup still
 * needs headroom. 1 MB is the cap — generous, and still a hard door. */
const BODY_LIMIT = '1mb';

const USER_PREFIX = 'user:';

const RAW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '_-]{0,63}$/;

export type PatternOrigin = 'curated' | 'user';

export interface PatternSummary {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly author?: string;
  readonly year?: number | null;
  readonly ruleset: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly population?: number;
  readonly period?: number | null;
  readonly speed?: string | null;
  readonly source?: string;
  readonly origin: PatternOrigin;
}

export interface PatternBody {
  readonly meta: PatternSummary;
  readonly rle: string;
}

export interface StoredUserPattern {
  readonly id: string;
  readonly name: string;
  readonly rle: string;
  readonly ruleset: string;
  readonly category: string;
  readonly description?: string;
  readonly tags: readonly string[];
}

export interface PatternQuery {
  readonly ruleset?: string;
  readonly category?: string;
  readonly tag?: string;
  readonly q?: string;
}

/**
 * A hand-written reader for exactly the subset of the RLE format the list/body split needs —
 * `#N`/`#O`/`#C` header comments and the `x = W, y = H` line — never a full decode into cells
 * unless the catalogue parser already did that. Not `ui/tools/select.ts`'s `decodeRLE`:
 * `server/` may not import `ui/` (ADR-009).
 */
const PROVENANCE_C =
  /^(SPDX-|source:|verified:|ruleset:|category:|period:|speed:|heat:|aliases:|year:|tags:|description:)/i;

export function parsePatternFile(id: string, text: string, ruleset?: string): PatternSummary & { rle: string } {
  let name = id;
  let author: string | undefined;
  const descriptionLines: string[] = [];
  const freeCommentLines: string[] = [];
  const aliases: string[] = [];
  const tags: string[] = [];
  let fileRuleset: string | undefined;
  let category = 'curiosity';
  let year: number | null | undefined;
  let period: number | null | undefined;
  let speed: string | null | undefined;
  let source: string | undefined;
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
      } else if (rest.startsWith('category:')) {
        category = rest.slice('category:'.length).trim() || category;
      } else if (rest.startsWith('aliases:')) {
        aliases.push(
          ...rest
            .slice('aliases:'.length)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      } else if (rest.startsWith('tags:')) {
        tags.push(
          ...rest
            .slice('tags:'.length)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      } else if (rest.startsWith('year:')) {
        const n = Number(rest.slice('year:'.length).trim());
        if (Number.isFinite(n)) year = n;
      } else if (rest.startsWith('period:')) {
        const raw = rest.slice('period:'.length).trim();
        period = raw === 'none' ? null : Number(raw);
      } else if (rest.startsWith('speed:')) {
        const raw = rest.slice('speed:'.length).trim();
        speed = !raw || raw === 'none' ? null : raw;
      } else if (rest.startsWith('source:')) {
        const raw = rest.slice('source:'.length).trim();
        if (raw) source = raw;
      } else if (!PROVENANCE_C.test(rest)) {
        freeCommentLines.push(rest);
      }
    } else if (line.startsWith('#')) continue;
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
    aliases,
    ...(description !== undefined ? { description } : {}),
    ...(author !== undefined && author !== '' ? { author } : {}),
    ...(year !== undefined ? { year } : {}),
    ruleset: ruleset ?? fileRuleset ?? 'conway',
    category,
    tags,
    width,
    height,
    ...(period !== undefined ? { period } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(source !== undefined ? { source } : {}),
    origin: 'curated',
    rle: `x = ${width}, y = ${height}\n${bodyLines.join('\n')}`,
  };
}

function listRleFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'thumbnails') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) listRleFiles(full, out);
    else if (extname(name) === '.rle') out.push(full);
  }
  return out;
}

interface CuratedRecord {
  readonly summary: PatternSummary;
  readonly rle: string;
}

function summaryFromCatalog(id: string, text: string): PatternSummary {
  const entry = parseCatalogEntry(id, text);
  return {
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases,
    description: entry.description,
    author: entry.discoverer,
    year: entry.year,
    ruleset: entry.ruleset,
    category: entry.category,
    tags: entry.tags,
    width: entry.width,
    height: entry.height,
    population: entry.population,
    period: entry.period,
    speed: entry.speed,
    source: entry.source,
    origin: 'curated',
  };
}

function dropRle(parsed: PatternSummary & { rle: string }): { summary: PatternSummary; rle: string } {
  const { rle, ...summary } = parsed;
  return { summary, rle };
}

export function loadCuratedRecords(dir: string): readonly CuratedRecord[] {
  return listRleFiles(dir)
    .map((filePath) => {
      const id = basename(filePath, '.rle');
      const text = readFileSync(filePath, 'utf8');
      const parsed = parsePatternFile(id, text);
      try {
        return { summary: summaryFromCatalog(id, text), rle: parsed.rle };
      } catch (err) {
        if (err instanceof CatalogParseError) return dropRle(parsed);
        throw err;
      }
    })
    .sort((a, b) => a.summary.id.localeCompare(b.summary.id));
}

/** Curated summaries only — the shape committed as `patterns/index.json`. */
export function buildCatalogIndex(dir: string): readonly PatternSummary[] {
  return loadCuratedRecords(dir).map((r) => r.summary);
}

export function loadPatterns(dir: string): readonly PatternSummary[] {
  return buildCatalogIndex(dir);
}

export function filterPatternSummaries(
  patterns: readonly PatternSummary[],
  query: PatternQuery,
): PatternSummary[] {
  const ruleset = query.ruleset?.trim();
  const category = query.category?.trim();
  const tag = query.tag?.trim().toLowerCase();
  const q = query.q?.trim().toLowerCase();
  return patterns.filter((p) => {
    if (ruleset && p.ruleset !== ruleset) return false;
    if (category && p.category !== category) return false;
    if (tag && !p.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (q) {
      const hay = [p.id, p.name, p.author ?? '', p.description ?? '', ...p.aliases, ...p.tags]
        .join('\n')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveUserPatternId(rawId: string): string | null {
  const local = rawId.startsWith(USER_PREFIX) ? rawId.slice(USER_PREFIX.length) : rawId;
  if (!RAW_ID_PATTERN.test(local)) return null;
  const slug = slugify(local);
  return slug ? `${USER_PREFIX}${slug}` : null;
}

export function isUserPatternId(id: string): boolean {
  return id.startsWith(USER_PREFIX) && isValidStoreId(id);
}

/** Curated ids (`glider`, `gosper-gun`) plus `user:` store ids. Anything else is a 400. */
export function isSafePatternId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id) || isUserPatternId(id);
}

function queryOf(query: Record<string, unknown>): PatternQuery {
  const str = (key: string): string | undefined => {
    const v = query[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const result: { ruleset?: string; category?: string; tag?: string; q?: string } = {};
  const ruleset = str('ruleset');
  const category = str('category');
  const tag = str('tag');
  const q = str('q');
  if (ruleset) result.ruleset = ruleset;
  if (category) result.category = category;
  if (tag) result.tag = tag;
  if (q) result.q = q;
  return result;
}

function userSummary(doc: StoredUserPattern): PatternSummary {
  let width = 0;
  let height = 0;
  let population: number | undefined;
  try {
    const decoded = decode(doc.rle);
    width = decoded.width;
    height = decoded.height;
    population = decoded.cells.reduce((n, c) => n + (c.state !== 0 ? 1 : 0), 0);
  } catch {
    /* stored body was valid at POST; a corrupt file still lists, dimensions stay 0 */
  }
  return {
    id: doc.id,
    name: doc.name,
    aliases: [],
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    ruleset: doc.ruleset,
    category: doc.category,
    tags: doc.tags,
    width,
    height,
    ...(population !== undefined ? { population } : {}),
    origin: 'user',
  };
}

function parsePostBody(raw: unknown): { name: string; rle: string; ruleset: string; category: string; description?: string; tags: string[]; idHint: string } | { error: string } {
  if (raw === null || typeof raw !== 'object') return { error: 'body must be a JSON object' };
  const body = raw as Record<string, unknown>;
  if (typeof body['name'] !== 'string' || body['name'].trim() === '') return { error: 'name is required' };
  if (typeof body['rle'] !== 'string' || body['rle'].trim() === '') return { error: 'rle is required' };
  const name = body['name'].trim();
  const rle = body['rle'];
  const ruleset = typeof body['ruleset'] === 'string' && body['ruleset'].trim() ? body['ruleset'].trim() : 'conway';
  const category = typeof body['category'] === 'string' && body['category'].trim() ? body['category'].trim() : 'curiosity';
  const description = typeof body['description'] === 'string' && body['description'].trim() ? body['description'].trim() : undefined;
  const tags = Array.isArray(body['tags'])
    ? body['tags'].filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
    : [];
  const idHint = typeof body['id'] === 'string' && body['id'].trim() ? body['id'].trim() : name;
  return { name, rle, ruleset, category, tags, idHint, ...(description !== undefined ? { description } : {}) };
}

export interface CreatePatternsRouterOptions {
  readonly dir?: string;
  readonly store?: FileStore<StoredUserPattern>;
}

/**
 * Curated patterns load once at router creation. User patterns are read per request from the
 * volume so a POST is visible on the next GET without a restart.
 */
export function createPatternsRouter(dirOrOpts: string | CreatePatternsRouterOptions = DEFAULT_PATTERNS_DIR): Router {
  const opts: CreatePatternsRouterOptions = typeof dirOrOpts === 'string' ? { dir: dirOrOpts } : dirOrOpts;
  const dir = opts.dir ?? DEFAULT_PATTERNS_DIR;
  const store = opts.store;
  const curated = loadCuratedRecords(dir);
  const byId = new Map(curated.map((r) => [r.summary.id, r]));
  const curatedSummaries = curated.map((r) => r.summary);
  const router = Router();

  async function mergedList(query: PatternQuery): Promise<PatternSummary[]> {
    let user: PatternSummary[] = [];
    if (store) {
      const ids = await store.list();
      const docs = await Promise.all(ids.map((id) => store.load(id)));
      user = docs.filter((d): d is StoredUserPattern => d !== null).map(userSummary);
    }
    return filterPatternSummaries([...curatedSummaries, ...user], query);
  }

  const sendIndex: express.RequestHandler = (req, res, next) => {
    mergedList(queryOf(req.query as Record<string, unknown>))
      .then((list) => {
        res.set('Cache-Control', 'private, no-store');
        res.json(list);
      })
      .catch(next);
  };

  router.get('/', sendIndex);
  router.get('/index.json', sendIndex);

  router.get('/:id', (req, res, next) => {
    const { id } = req.params;
    const curatedHit = byId.get(id);
    if (curatedHit) {
      res.set('Cache-Control', 'public, max-age=3600');
      res.json({ meta: curatedHit.summary, rle: curatedHit.rle } satisfies PatternBody);
      return;
    }
    if (!isSafePatternId(id)) {
      res.status(400).json({ error: 'invalid pattern id' });
      return;
    }
    if (!isUserPatternId(id) || !store) {
      res.status(404).json({ error: 'pattern not found' });
      return;
    }
    store
      .load(id)
      .then((doc) => {
        if (!doc) {
          res.status(404).json({ error: 'pattern not found' });
          return;
        }
        res.set('Cache-Control', 'private, no-store');
        res.json({ meta: userSummary(doc), rle: doc.rle } satisfies PatternBody);
      })
      .catch(next);
  });

  router.post('/', express.json({ limit: BODY_LIMIT }), (req, res, next) => {
    if (!store) {
      res.status(503).json({ error: 'user pattern store is not configured' });
      return;
    }
    const parsed = parsePostBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    let decoded;
    try {
      decoded = decode(parsed.rle);
    } catch (err) {
      const hint = err instanceof PatternParseError ? err.hint : err instanceof Error ? err.message : 'invalid RLE';
      res.status(400).json({ error: 'invalid RLE', hint });
      return;
    }
    if (!decoded.cells.some((c) => c.state !== 0)) {
      res.status(400).json({ error: 'pattern has no live cells' });
      return;
    }
    const id = deriveUserPatternId(parsed.idHint);
    if (!id) {
      res.status(400).json({ error: 'invalid pattern id' });
      return;
    }
    if (byId.has(id)) {
      res.status(400).json({ error: 'cannot overwrite a curated pattern' });
      return;
    }
    const doc: StoredUserPattern = {
      id,
      name: parsed.name,
      rle: parsed.rle,
      ruleset: parsed.ruleset,
      category: parsed.category,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      tags: parsed.tags,
    };
    store
      .save(id, doc)
      .then(() => res.status(201).json({ id }))
      .catch(next);
  });

  return router;
}
