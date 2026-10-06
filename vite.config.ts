import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const alias = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Rolldown names a dynamic-entry chunk after its entry module (`src/client/theme-bundles/<id>.ts`). */
const THEME_CHUNK_NAMES = /^(chiba-city|flatline|sids-place|void-walker|synthwave)$/;
/** The three heavy panels' entry modules (P3-E-10). */
const PANEL_MODULE = /\/src\/ui\/panels\/(statistics|library|ruleset-studio)\/panel\.ts$/;
/** Modules only the themes use: the effect-pass implementations and their pass-stack factories. */
const THEME_SHARED_MODULES = /\/src\/render\/effects\/(post-passes|background-passes|effects-passes|library|timed-pass|surface|software-surface|pixel-hash)\.ts$/;

export default defineConfig({
  root: 'src/client',
  resolve: {
    alias: {
      '@engine': alias('./src/engine'),
      '@shared': alias('./src/shared'),
      '@render': alias('./src/render'),
      '@ui': alias('./src/ui'),
      '@themes': alias('./src/themes'),
      '@audio': alias('./src/audio'),
      '@worker': alias('./src/worker'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: alias('./dist/client'),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // P3-E-7: the lazily loaded theme chunks are named `theme-*`. That is a contract, not
        // cosmetics: `tests/bench/bundle.bench.ts` excludes exactly these from `client-js-gzip`
        // (the floor is "excl. themes", planning/README.md §3.6, D4) and gates the largest of them
        // as `theme-chunk-gzip-max`.
        //
        // The split itself is the bundler's natural one: each theme is a dynamic `import()` of a
        // bundle module (`src/client/theme-bundles/*`), and what several themes share (the effect
        // passes, via `library`) becomes one common chunk that is fetched once. Forcing that layout
        // with `codeSplitting` / `manualChunks` groups made it worse: the shared passes collapsed
        // into the first theme's chunk, so loading Flatline fetched all of Chiba-City too. Only the
        // names are configured here.
        chunkFileNames: (chunk: { name: string; isDynamicEntry: boolean; moduleIds: readonly string[] }) => {
          if (chunk.isDynamicEntry && THEME_CHUNK_NAMES.test(chunk.name)) return 'assets/theme-[name]-[hash].js';
          // P3-E-10: the lazily loaded panels. Three modules are all called `panel.ts`, so name them by
          // directory. Cosmetic only: `client-js-gzip` measures by import reachability, not by name.
          const panel = chunk.moduleIds.map((id) => PANEL_MODULE.exec(id)?.[1]).find(Boolean);
          if (chunk.isDynamicEntry && panel) return `assets/panel-${panel}-[hash].js`;
          if (chunk.isDynamicEntry && chunk.moduleIds.some((id) => /\/src\/ui\/charts\/chart\.ts$/.test(id))) {
            return 'assets/panel-statistics-charts-[hash].js';
          }
          // The common chunk the themes share: effect passes only themes use, and nothing else.
          if (chunk.moduleIds.length > 0 && chunk.moduleIds.every((id) => THEME_SHARED_MODULES.test(id))) {
            return 'assets/theme-effects-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    port: 5173,
    // `true` binds all interfaces (0.0.0.0), not just localhost — needed so the dev server is
    // reachable through Docker's published port (docker/docker-compose.dev.yml, P0-I-3). Harmless
    // for a bare `npm run dev` too: localhost still resolves to it either way.
    host: true,
    // Vite 8 checks the Host header and 403s anything other than localhost. Docker users (and
    // this sandbox) reach the published port via a hostname or LAN IP, so allow every host.
    // Same pairing as `host: true`: a dev-server concern, never the production image.
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/thumbs': 'http://127.0.0.1:8080',
    },
  },
});
