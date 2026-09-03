import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { BenchCase } from './types.ts';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ASSETS = join(ROOT, 'dist/client/assets');

function clientGzipKiB(): number {
  if (!existsSync(ASSETS)) {
    throw new Error('dist/client/assets missing — run `npm run build` before `npm run bench`');
  }
  let total = 0;
  for (const name of readdirSync(ASSETS)) {
    if (!name.endsWith('.js')) continue;
    total += gzipSync(readFileSync(join(ASSETS, name))).length;
  }
  if (total === 0) throw new Error('no JS assets under dist/client/assets');
  return total / 1024;
}

export const cases: BenchCase[] = [
  {
    id: 'client-js-gzip',
    name: 'client JS bundle gzip (excl. themes)',
    unit: 'kB',
    budget: 120,
    higherIsBetter: false,
    warmup: 0,
    run: () => clientGzipKiB(),
  },
];
