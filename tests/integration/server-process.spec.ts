/**
 * P0-I-2's SIGTERM acceptance criterion ("closes the listener and exits 0 within 5 s") is a
 * statement about the real, running process — `installGracefulShutdown`'s own unit tests
 * (`tests/unit/server/shutdown.spec.ts`) prove the shutdown *policy* with fakes, but only an
 * actual spawned process, sent an actual `SIGTERM`, proves the AC as written rather than
 * approximated.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER_ENTRY = fileURLToPath(new URL('../../src/server/index.ts', import.meta.url));
const TSX_BIN = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));

describe('server process (real spawn)', () => {
  it('SIGTERM closes the listener and exits 0 within 5s', async () => {
    const child = spawn(TSX_BIN, [SERVER_ENTRY], {
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`server did not report a listening port within 10s; stdout so far: ${stdout}`));
      }, 10_000);
      const settle = (fn: () => void) => {
        clearTimeout(timeout);
        fn();
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        const match = /listening on :(\d+)/.exec(stdout);
        if (match) settle(() => resolve(Number(match[1])));
      });
      child.once('exit', (code) =>
        settle(() => reject(new Error(`server exited early with code ${code}; stdout: ${stdout}; stderr: ${stderr}`))),
      );
      child.once('error', (err) => settle(() => reject(err)));
    }).finally(() => {
      child.stdout?.removeAllListeners('data');
      child.removeAllListeners('exit');
      child.removeAllListeners('error');
    });

    // Confirm it's genuinely accepting connections, not just past the listen() callback.
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);

    const start = performance.now();
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code));
      child.kill('SIGTERM');
    });
    const elapsedMs = performance.now() - start;

    expect(exitCode).toBe(0);
    expect(elapsedMs).toBeLessThan(5000);
  }, 20_000);
});
