/**
 * P0-I-2 — the real server entry point. Everything that actually *does* something lives in
 * `app.ts` (`createApp()`, `installGracefulShutdown()`), both fully testable without binding a
 * real port; this file is the thin adapter that does — the same split `worker/sim.worker.ts`
 * uses for its own environment wiring.
 */
import { createApp, installGracefulShutdown } from './app';

const PORT = Number(process.env['PORT'] ?? 8080);

const app = createApp();
const server = app.listen(PORT, () => {
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`fancy-gol server listening on :${boundPort}`);
});

installGracefulShutdown(server);
