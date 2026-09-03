/**
 * P0-I-2 — the Express server skeleton (ADR-002: "a static host, an asset API, and a broadcast
 * relay — not the simulator"). `createApp()` builds and returns the app without listening, so
 * tests can drive it fully in-process (a real `http.Server` bound to an ephemeral port, plain
 * `fetch`, no extra test-only HTTP client dependency — "No Bloat" applies to devDependencies
 * too). `index.ts` is the thin, real-environment adapter that actually listens — the same
 * split `worker/handler.ts`/`worker/sim.worker.ts` already established.
 *
 * No API routes yet (ADR-002's `/api/rulesets`, `/api/patterns`, `/api/sessions`, `/live`):
 * those are Phase 1+. This is deliberately just enough to serve the built client and prove the
 * process is alive.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

const DEFAULT_DIST_CLIENT = fileURLToPath(new URL('../../dist/client', import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as { version: string };
  return pkg.version;
}

export interface CreateAppOptions {
  /** Directory to serve the built client from. Defaults to `dist/client`; overridable so tests don't depend on a real `npm run build` having already run. */
  readonly distDir?: string;
  /** Reported by `/api/health`. Defaults to `package.json`'s own version. */
  readonly version?: string;
}

/** Vite's hashed asset filenames (`assets/index-<hash>.js`) never change contents under a given URL — safe to cache forever. `index.html` names the *current* hashed assets, so it must always be revalidated. */
function isHashedAsset(filePath: string): boolean {
  return filePath.includes(`${sep}assets${sep}`);
}

export function createApp(opts: CreateAppOptions = {}): Express {
  const distDir = resolve(opts.distDir ?? DEFAULT_DIST_CLIENT);
  const version = opts.version ?? readPackageVersion();
  const indexHtmlPath = join(distDir, 'index.html');

  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version, uptime: process.uptime() });
  });

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

  // Anything under /api/ that isn't a real route (there are none yet) is a JSON 404, never the
  // SPA shell — an API client checking `err.response.data.error` shouldn't have to sniff HTML.
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
