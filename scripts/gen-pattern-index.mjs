#!/usr/bin/env node
/**
 * Rebuild `patterns/index.json` from the curated `.rle` files. Re-run when P2-B-5 adds patterns.
 *
 *   node --import tsx scripts/gen-pattern-index.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogIndex } from '../src/server/routes/patterns.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(ROOT, 'patterns');
const index = buildCatalogIndex(dir);
writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`✓ ${index.length} entries → patterns/index.json`);
