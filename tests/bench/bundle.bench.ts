import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { BenchCase } from './types.ts';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ASSETS = join(ROOT, 'dist/client/assets');

/** Theme chunks are named `theme-*` by `vite.config.ts` (P3-E-7). That naming is the contract this reads. */
const THEME_CHUNK = /^theme-/;
/** Measured 7.4 KiB (the shared effect passes) on 2026-10-06; 12 leaves room for a new pass or two. */
const THEME_CHUNK_BUDGET_KIB = 12;

function gzipKiBOfAssets(include: (name: string) => boolean): number[] {
  if (!existsSync(ASSETS)) {
    throw new Error('dist/client/assets missing — run `npm run build` before `npm run bench`');
  }
  const sizes: number[] = [];
  for (const name of readdirSync(ASSETS)) {
    if (!name.endsWith('.js') || !include(name)) continue;
    sizes.push(gzipSync(readFileSync(join(ASSETS, name))).length / 1024);
  }
  return sizes;
}

/** Every emitted JS chunk **except** the lazily loaded theme chunks: the floor as written (§3.6, D4). */
function clientGzipKiB(): number {
  const sizes = gzipKiBOfAssets((name) => !THEME_CHUNK.test(name));
  if (sizes.length === 0) throw new Error('no JS assets under dist/client/assets');
  return sizes.reduce((a, b) => a + b, 0);
}

/** The largest single theme chunk: what the heaviest theme (or the shared passes) costs on demand. */
function largestThemeChunkGzipKiB(): number {
  const sizes = gzipKiBOfAssets((name) => THEME_CHUNK.test(name));
  if (sizes.length === 0) throw new Error('no theme-* chunks under dist/client/assets — is the theme split broken?');
  return Math.max(...sizes);
}

export const cases: BenchCase[] = [
  {
    id: 'client-js-gzip',
    // Before P3-E-7 this summed every emitted chunk, themes included, while its name and its §3.6
    // floor both said "excl. themes" — so its 135.7 kB "failure" measured a different quantity.
    name: 'client JS bundle gzip (excl. theme chunks)',
    unit: 'kB',
    budget: 120,
    higherIsBetter: false,
    class: 'deterministic',
    warmup: 0,
    run: () => clientGzipKiB(),
  },
  {
    id: 'theme-chunk-gzip-max',
    name: 'largest lazily loaded theme chunk, gzip (a theme, or the effect passes they share)',
    unit: 'kB',
    // Set from measurement on 2026-10-06 with headroom for one new pass, not a round guess. A theme
    // chunk is fetched on demand, so this bounds what a theme switch can cost the network.
    budget: THEME_CHUNK_BUDGET_KIB,
    higherIsBetter: false,
    class: 'deterministic',
    warmup: 0,
    run: () => largestThemeChunkGzipKiB(),
  },
];
