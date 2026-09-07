/**
 * `/api/rulesets` (ADR-002, P1-G-1): the built-in catalogue plus user-authored rulesets, stored
 * as JSON files (`store/file-store.ts`). Four routes:
 *
 *   GET    /api/rulesets       -> RulesetSummary[]  (builtin + user)
 *   GET    /api/rulesets/:id   -> RuleSetDocument
 *   POST   /api/rulesets       <- RuleSetDocument   -> { id }   (validated server-side)
 *   DELETE /api/rulesets/:id                                    (user rulesets only)
 *
 * ADR-009's boundary table annotates `server -> engine` as "validation only" — read here as
 * *purpose*, not a literal one-function allowlist: `getBuiltin`/`BUILTIN_RULESETS` are the exact
 * same canonical ruleset *data* `validateRuleSet` already reasons about, not simulation logic or
 * anything Pure-Logic-adjacent, and this task's own implementation note explicitly requires
 * "Builtins served from the engine" — there is no second, non-engine source for them to come
 * from without duplicating the catalogue.
 *
 * A submitted id is deliberately *rejected*, not silently sanitised, when it contains anything
 * outside a conservative safe set (letters, digits, spaces, `'`, `_`, `-`) — a slug is derived
 * from what's left *after* that check passes, never as a way to launder a path-traversal attempt
 * like `../../etc/passwd` into something merely differently-shaped. Every user id is stored
 * under a server-owned `user:` prefix (never trusting a client's own claim to already be
 * correctly namespaced), which also makes "is this a builtin or a user ruleset" a one-branch
 * question everywhere else in this file.
 */
import { Router } from 'express';
import express from 'express';
import { BUILTIN_RULESETS, getBuiltin } from '../../engine/rules/builtin/index.js';
import { RuleValidationError } from '../../engine/rules/errors.js';
import type { RuleSetDocument } from '../../engine/rules/schema.js';
import { validateRuleSet } from '../../engine/rules/validate.js';
import { isValidStoreId, type FileStore } from '../store/file-store.js';

/** Schema documents are small (a state palette, a transition spec) — nowhere near the sessions
 * route's 10mb (a 100k-cell grid's RLE). 64kB per this task's own figure, generous headroom over
 * every built-in ruleset's own serialised size. */
const BODY_LIMIT = '64kb';

const USER_PREFIX = 'user:';

/** What's accepted *before* slugifying — letters, digits, spaces, apostrophes, underscores and
 * hyphens only. No `.` or `/` in this set at all, so nothing matching it can ever be a
 * path-traversal attempt; an id containing either is rejected outright, never laundered. */
const RAW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '_-]{0,63}$/;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Derives the server-owned storage id for a submitted `RuleSetDocument.id`, or `null` if it's
 * unsafe (contains anything outside {@link RAW_ID_PATTERN}, e.g. `../../etc/passwd`) or reduces
 * to nothing once slugified (e.g. `"---"`). Exported for direct unit testing of this one
 * security-relevant decision, independent of the HTTP plumbing around it. */
export function deriveUserRulesetId(rawId: string): string | null {
  const local = rawId.startsWith(USER_PREFIX) ? rawId.slice(USER_PREFIX.length) : rawId;
  if (!RAW_ID_PATTERN.test(local)) return null;
  const slug = slugify(local);
  return slug ? `${USER_PREFIX}${slug}` : null;
}

export function isUserRulesetId(id: string): boolean {
  return id.startsWith(USER_PREFIX) && isValidStoreId(id);
}

export interface RulesetSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
}

function summarize(doc: Pick<RuleSetDocument, 'id' | 'name' | 'description' | 'author'>): RulesetSummary {
  return {
    id: doc.id,
    name: doc.name,
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    ...(doc.author !== undefined ? { author: doc.author } : {}),
  };
}

export function createRulesetsRouter(store: FileStore<RuleSetDocument>): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    store
      .list()
      .then(async (ids) => {
        const userDocs = await Promise.all(ids.map((id) => store.load(id)));
        const userSummaries = userDocs.filter((doc): doc is RuleSetDocument => doc !== null).map(summarize);
        res.json([...BUILTIN_RULESETS.map(summarize), ...userSummaries]);
      })
      .catch(next);
  });

  router.get('/:id', (req, res, next) => {
    const { id } = req.params;
    const builtin = getBuiltin(id);
    if (builtin) {
      res.json(builtin);
      return;
    }
    if (!isUserRulesetId(id)) {
      res.status(400).json({ error: 'invalid ruleset id' });
      return;
    }
    store
      .load(id)
      .then((doc) => {
        if (!doc) {
          res.status(404).json({ error: 'ruleset not found' });
          return;
        }
        res.json(doc);
      })
      .catch(next);
  });

  router.post('/', express.json({ limit: BODY_LIMIT }), (req, res, next) => {
    let validated: RuleSetDocument;
    try {
      validated = validateRuleSet(req.body);
    } catch (err) {
      if (err instanceof RuleValidationError) {
        res.status(400).json({ issues: err.issues });
        return;
      }
      next(err);
      return;
    }

    const id = deriveUserRulesetId(validated.id);
    if (!id) {
      res.status(400).json({ issues: [{ path: '/id', message: 'invalid ruleset id' }] });
      return;
    }

    store
      .save(id, { ...validated, id })
      .then(() => res.status(201).json({ id }))
      .catch(next);
  });

  router.delete('/:id', (req, res, next) => {
    const { id } = req.params;
    if (getBuiltin(id)) {
      res.status(403).json({ error: 'cannot delete a built-in ruleset' });
      return;
    }
    if (!isUserRulesetId(id)) {
      res.status(400).json({ error: 'invalid ruleset id' });
      return;
    }
    store
      .remove(id)
      .then((removed) => {
        res.status(removed ? 204 : 404).end();
      })
      .catch(next);
  });

  return router;
}
