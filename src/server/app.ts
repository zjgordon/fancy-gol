/**
 * P0-I-2 — the Express server skeleton (ADR-002: "a static host, an asset API, and a broadcast
 * relay — not the simulator"). `createApp()` builds and returns the app without listening, so
 * tests can drive it fully in-process (a real `http.Server` bound to an ephemeral port, plain
 * `fetch`, no extra test-only HTTP client dependency — "No Bloat" applies to devDependencies
 * too). `index.ts` is the thin, real-environment adapter that actually listens — the same
 * split `worker/handler.ts`/`worker/sim.worker.ts` already established.
 *
 * `/api/sessions` (ADR-002, P1-F-2), `/api/rulesets` (ADR-002, P1-G-1) and `/api/patterns`
 * (ADR-002, P1-G-2) are the HTTP routes; `/live` is a WebSocket upgrade attached after
 * `listen()` in `index.ts` (ADR-002, P1-G-3) — not an Express middleware.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
// `.js`, not `.ts` (`allowImportingTsExtensions: false` here, and Node's ESM loader needs a
// resolvable extension on a relative specifier) — the same convention `index.ts`'s own `./app.js`
// import already established.
import { createPatternsRouter, type StoredUserPattern } from './routes/patterns.js';
import { createRulesetsRouter } from './routes/rulesets.js';
import { createSessionsRouter } from './routes/sessions.js';
import type { RuleSetDocument } from '../engine/rules/schema.js';
import { createFileStore, type FileStore } from './store/file-store.js';
import { createFileSessionStore, type SessionStore } from './store/session-store.js';

const DEFAULT_DIST_CLIENT = fileURLToPath(new URL('../../dist/client', import.meta.url));
const DEFAULT_THUMBS_DIR = fileURLToPath(new URL('../../patterns/thumbnails', import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
/** ADR-002: "file-backed JSON on a mounted volume" — `data/` at the process's cwd, which in the
 * production image (`docker/Dockerfile`) is `/app`, the directory `docker/docker-compose*.yml`
 * mounts a volume onto. Sessions and rulesets are separate subdirectories of that same volume. */
const DEFAULT_SESSIONS_DIR = join(process.cwd(), 'data/sessions');
const DEFAULT_RULESETS_DIR = join(process.cwd(), 'data/rulesets');
const DEFAULT_USER_PATTERNS_DIR = join(process.cwd(), 'data/patterns');

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as { version: string };
  return pkg.version;
}

export interface CreateAppOptions {
  /** Directory to serve the built client from. Defaults to `dist/client`; overridable so tests don't depend on a real `npm run build` having already run. */
  readonly distDir?: string;
  /** Reported by `/api/health`. Defaults to `package.json`'s own version. */
  readonly version?: string;
  /** Where shared sessions are written. Defaults to `data/sessions` under the cwd; overridable so tests use a scratch directory instead of the real (or absent) mounted volume. Ignored if `sessionStore` is given. */
  readonly sessionsDir?: string;
  /** Supplying a store directly (a test double, an in-memory one) bypasses the filesystem entirely. */
  readonly sessionStore?: SessionStore;
  /** Where user rulesets are written. Defaults to `data/rulesets` under the cwd; same test-isolation reasoning as `sessionsDir`. Ignored if `rulesetStore` is given. */
  readonly rulesetsDir?: string;
  readonly rulesetStore?: FileStore<RuleSetDocument>;
  /** Directory `.rle` pattern files are read from. Defaults to the repo-root `patterns/`; overridable so a test uses a scratch fixture instead of the real bundled set. */
  readonly patternsDir?: string;
  /** Generated library posters + APNGs (`patterns/thumbnails`). Served at `/thumbs`. */
  readonly thumbsDir?: string;
  /** Where user-saved patterns are written. Defaults to `data/patterns` under the cwd. Ignored if `patternStore` is given. */
  readonly userPatternsDir?: string;
  readonly patternStore?: FileStore<StoredUserPattern>;
}

/** Vite's hashed asset filenames (`assets/index-<hash>.js`) never change contents under a given URL — safe to cache forever. `index.html` names the *current* hashed assets, so it must always be revalidated. */
function isHashedAsset(filePath: string): boolean {
  return filePath.includes(`${sep}assets${sep}`);
}

export function createApp(opts: CreateAppOptions = {}): Express {
  const distDir = resolve(opts.distDir ?? DEFAULT_DIST_CLIENT);
  const version = opts.version ?? readPackageVersion();
  const indexHtmlPath = join(distDir, 'index.html');
  const sessionStore = opts.sessionStore ?? createFileSessionStore(opts.sessionsDir ?? DEFAULT_SESSIONS_DIR);
  const rulesetStore =
    opts.rulesetStore ?? createFileStore<RuleSetDocument>(opts.rulesetsDir ?? DEFAULT_RULESETS_DIR);
  const patternStore =
    opts.patternStore ?? createFileStore<StoredUserPattern>(opts.userPatternsDir ?? DEFAULT_USER_PATTERNS_DIR);

  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version, uptime: process.uptime() });
  });

  app.use('/api/sessions', createSessionsRouter(sessionStore));
  app.use('/api/rulesets', createRulesetsRouter(rulesetStore));
  app.use(
    '/api/patterns',
    createPatternsRouter({
      ...(opts.patternsDir !== undefined ? { dir: opts.patternsDir } : {}),
      store: patternStore,
    }),
  );

  app.use(
    '/thumbs',
    express.static(resolve(opts.thumbsDir ?? DEFAULT_THUMBS_DIR), {
      index: false,
      fallthrough: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    }),
  );

  app.use(
    express.static(distDir, {
      index: false, // index.html gets its own no-store handling below, not static's default caching
      setHeaders(res, filePath) {
        if (isHashedAsset(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // Anything under /api/ that isn't a real route is a JSON 404, never the SPA shell — an API
  // client checking `err.response.data.error` shouldn't have to sniff HTML.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Everything else is a client-side route the SPA router owns — serve the shell and let it
  // decide. Never cached: it's the one file whose content changes (which hashed assets it
  // points at) on every deploy.
  app.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexHtmlPath, (err: unknown) => {
      if (err) res.status(404).json({ error: 'not found' });
    });
  });

  return app;
}

/** The minimal `http.Server` surface {@link installGracefulShutdown} needs — real or a test double. */
export interface CloseableServer {
  close(callback: (err?: Error) => void): void;
}

/** The minimal signal-registration surface {@link installGracefulShutdown} needs — real `process`, or a test double that lets a test invoke the registered handler directly instead of sending an actual OS signal. */
export interface SignalSource {
  on(event: string, listener: () => void): void;
}

export interface GracefulShutdownOptions {
  /** Defaults to `['SIGTERM']`. */
  readonly signals?: readonly string[];
  /** If `server.close()` hasn't finished by this long, exit anyway rather than hang forever on a stuck connection. Defaults to 5000 (the AC's own budget). */
  readonly timeoutMs?: number;
  readonly signalSource?: SignalSource;
  readonly exit?: (code: number) => void;
}

/** Wires one or more OS signals to a graceful `server.close()`, forcing an exit if close doesn't finish within `timeoutMs`. Takes the server and its dependencies as parameters (not reaching for the real `process` internally) so the policy itself — not just `createApp()`'s routes — is unit-testable without spawning a real process. */
export function installGracefulShutdown(server: CloseableServer, opts: GracefulShutdownOptions = {}): void {
  const signals = opts.signals ?? ['SIGTERM'];
  const timeoutMs = opts.timeoutMs ?? 5000;
  const signalSource = opts.signalSource ?? process;
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  for (const signal of signals) {
    signalSource.on(signal, () => {
      const forceExitTimer = setTimeout(() => exit(1), timeoutMs);
      server.close((err) => {
        clearTimeout(forceExitTimer);
        exit(err ? 1 : 0);
      });
    });
  }
}
