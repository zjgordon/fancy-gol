import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { entryChunksFromHtml, initialLoadChunks } from './bundle-graph.ts';
import type { BenchCase } from './types.ts';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ASSETS = join(ROOT, 'dist/client/assets');

/** Theme chunks are named `theme-*` by `vite.config.ts` (P3-E-7). That naming is the contract this reads. */
const THEME_CHUNK = /^theme-/;
/** Measured 7.4 KiB (the shared effect passes) on 2026-10-06; 12 leaves room for a new pass or two. */
const THEME_CHUNK_BUDGET_KIB = 12;
/** Workers the app starts at boot. `bench.worker` is created on demand, so it is not one. */
const STARTUP_WORKERS = ['sim.worker'];
/** Provisional: `bench.worker` (21 KiB) is the largest on-demand chunk today. Re-set from measurement once the panels are lazy. */
const ON_DEMAND_CHUNK_BUDGET_KIB = 28;

interface Build {
  /** file name → source, for every emitted JS chunk */
  readonly source: ReadonlyMap<string, string>;
  /** file name → gzip KiB */
  readonly gzipKiB: ReadonlyMap<string, number>;
  /** chunks loaded at startup (P3-E-10) */
  readonly initial: ReadonlySet<string>;
}

function readBuild(): Build {
  if (!existsSync(ASSETS)) {
    throw new Error('dist/client/assets missing — run `npm run build` before `npm run bench`');
  }
  const source = new Map<string, string>();
  const gzipKiB = new Map<string, number>();
  for (const name of readdirSync(ASSETS)) {
    if (!name.endsWith('.js')) continue;
    const buf = readFileSync(join(ASSETS, name));
    source.set(name, buf.toString('utf8'));
    gzipKiB.set(name, gzipSync(buf).length / 1024);
  }
  if (source.size === 0) throw new Error('no JS assets under dist/client/assets');
  const html = readFileSync(join(ROOT, 'dist/client/index.html'), 'utf8');
  const entries = entryChunksFromHtml(html);
  if (entries.length === 0) throw new Error('dist/client/index.html names no module entry — is the build broken?');
  return { source, gzipKiB, initial: initialLoadChunks(entries, source, STARTUP_WORKERS) };
}

const sum = (xs: Iterable<number>): number => [...xs].reduce((a, b) => a + b, 0);

/**
 * Initial-load JS: the entry, everything it statically imports, and the startup workers (P3-E-10,
 * planning/README.md §3.6). Measured by import reachability, not chunk name, so a lazy chunk that
 * gets statically imported is counted rather than hidden.
 */
function initialLoadGzipKiB(): number {
  const { gzipKiB, initial } = readBuild();
  return sum([...initial].map((name) => gzipKiB.get(name)!));
}

/** Every emitted chunk, loaded or not: so bytes moved out of startup stay visible. */
function emittedGzipKiB(): number {
  return sum(readBuild().gzipKiB.values());
}

/** The largest chunk that is **not** loaded at startup: a theme, a panel, the bench worker. */
function largestOnDemandChunkGzipKiB(): number {
  const { gzipKiB, initial } = readBuild();
  const sizes = [...gzipKiB].filter(([name]) => !initial.has(name)).map(([, kib]) => kib);
  if (sizes.length === 0) throw new Error('no on-demand chunks emitted — is the lazy split broken?');
  return Math.max(...sizes);
}

/** The largest single theme chunk: what the heaviest theme (or the shared passes) costs on demand. */
function largestThemeChunkGzipKiB(): number {
  const sizes = [...readBuild().gzipKiB].filter(([name]) => THEME_CHUNK.test(name)).map(([, kib]) => kib);
  if (sizes.length === 0) throw new Error('no theme-* chunks under dist/client/assets — is the theme split broken?');
  return Math.max(...sizes);
}

export const cases: BenchCase[] = [
  {
    id: 'client-js-gzip',
    // History: it summed every chunk (135.7 kB, themes included) while its name and §3.6 said "excl.
    // themes" (P3-E-7 fixed that, 127.45 KiB), then P3-E-10 defined the floor as what actually loads
    // at startup. The budget never moved.
    name: 'client initial-load JS gzip (entry + static imports + startup workers)',
    unit: 'kB',
    budget: 120,
    higherIsBetter: false,
    class: 'deterministic',
    warmup: 0,
    run: () => initialLoadGzipKiB(),
  },
  {
    id: 'emitted-js-gzip',
    name: 'all emitted JS gzip, loaded or not (regression-gated; keeps on-demand weight visible)',
    unit: 'kB',
    higherIsBetter: false,
    class: 'deterministic',
    warmup: 0,
    run: () => emittedGzipKiB(),
  },
  {
    id: 'on-demand-chunk-gzip-max',
    name: 'largest chunk not loaded at startup, gzip (a theme, a panel, or the bench worker)',
    unit: 'kB',
    budget: ON_DEMAND_CHUNK_BUDGET_KIB,
    higherIsBetter: false,
    class: 'deterministic',
    warmup: 0,
    run: () => largestOnDemandChunkGzipKiB(),
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
