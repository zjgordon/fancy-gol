/**
 * `/api/sessions` (ADR-002, P1-F-2's server-backed fallback): `POST` validates and stores a
 * `SessionDoc`, returning `{ id, shareUrl }`; `GET /:id` returns it back. The only two operations
 * ADR-002's contract names — no update, no delete, no listing (nothing here is a user's saved
 * work to manage, only a link someone shared once).
 */
import { Router } from 'express';
import express from 'express';
// Relative + `.js`, not `@shared/session` — see `../store/session-store.ts`'s own note on why:
// plain `tsc` (this file's build, `tsconfig.server.json`) emits an alias specifier verbatim
// (unlike the Vite-bundled client/worker builds), and Node's ESM loader needs a resolvable
// extension on a relative specifier (`index.ts`'s own `./app.js` established this convention).
import { migrateSessionDoc } from '../../shared/session.js';
import type { SessionStore } from '../store/session-store.js';

/**
 * A 100k-live-cell soup's RLE, plus the rest of a `SessionDoc`'s JSON overhead, can run to
 * several hundred kB uncompressed — this is exactly the case that sends a share here instead of
 * the URL fragment, so the limit is generous, not P1-G-1's much smaller 64 kB (a hand-authored
 * ruleset document, a different and far smaller kind of body).
 */
const BODY_LIMIT = '10mb';

export function createSessionsRouter(store: SessionStore): Router {
  const router = Router();
  router.use(express.json({ limit: BODY_LIMIT }));

  router.post('/', (req, res, next) => {
    const doc = migrateSessionDoc(req.body);
    if (!doc) {
      res.status(400).json({ error: 'invalid session document' });
      return;
    }
    store
      .save(doc)
      .then((id) => {
        const shareUrl = `${req.protocol}://${req.get('host')}/#s:${id}`;
        res.status(201).json({ id, shareUrl });
      })
      .catch(next);
  });

  router.get('/:id', (req, res, next) => {
    store
      .load(req.params.id)
      .then((doc) => {
        if (!doc) {
          res.status(404).json({ error: 'session not found' });
          return;
        }
        res.json(doc);
      })
      .catch(next);
  });

  return router;
}
