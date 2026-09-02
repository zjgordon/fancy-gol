#!/usr/bin/env node
/**
 * dev.mjs — run the Vite client dev server and the Express dev server together.
 *
 * Hand-rolled per the no-bloat rule (ADR: README.md §3.2) instead of pulling in
 * `concurrently`. Node >= 20's --watch does the server reload; Vite does its own HMR.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const procs = [];
let shuttingDown = false;

function run(name, command, args) {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (code ${code}); shutting down.`);
      shutdown(code ?? 1);
    }
  });
  procs.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) p.kill('SIGTERM');
  process.exit(code ?? 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('vite', 'npx', ['vite']);

const serverEntry = 'src/server/index.ts';
if (existsSync(serverEntry)) {
  run('server', 'npx', ['tsx', 'watch', serverEntry]);
} else {
  console.log('[dev] src/server/index.ts not present yet (arrives with P0-I-2) — client only.');
}
