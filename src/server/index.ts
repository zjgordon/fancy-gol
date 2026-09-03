/**
 * P0-I-2 — the real server entry point. Everything that actually *does* something lives in
 * `app.ts` (`createApp()`, `installGracefulShutdown()`), both fully testable without binding a
 * real port; this file is the thin adapter that does — the same split `worker/sim.worker.ts`
 * uses for its own environment wiring.
 */
// The `.js` extension (not `.ts`) is deliberate: Node's native ESM loader requires an explicit,
// resolvable extension on relative specifiers, and this is what `tsc` emits verbatim (P0-I-3's
// `tsconfig.server.json` compiles this file for the production Docker image, where it runs as
// plain `node dist/server/index.js`, not through `tsx`). TS resolves `./app.js` back to the
// sibling `app.ts` at both typecheck- and dev-time (`tsx watch`) — this is the standard pattern
// for TS projects targeting Node ESM, not a typo.
import { createApp, installGracefulShutdown } from './app.js';

const PORT = Number(process.env['PORT'] ?? 8080);

const app = createApp();
const server = app.listen(PORT, () => {
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`fancy-gol server listening on :${boundPort}`);
});

installGracefulShutdown(server);
