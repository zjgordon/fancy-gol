#!/usr/bin/env node
/**
 * Writes Conway's committed bench reference (P2-E-3). Re-run when the
 * battery contract (seeds, world, max gens) changes — never to silence a
 * stats-stack regression.
 *
 *   node --import tsx scripts/gen-bench-report.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONWAY } from '../src/engine/rules/builtin/index.ts';
import { referenceFromReport, runBattery } from '../src/engine/bench/battery.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/rules/bench/conway-report.json');
const report = runBattery(CONWAY);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ cases: referenceFromReport(report) }, null, 2)}\n`);
process.stdout.write(`wrote ${out}\n`);
