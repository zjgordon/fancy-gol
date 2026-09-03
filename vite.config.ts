import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const alias = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: 'src/client',
  resolve: {
    alias: {
      '@engine': alias('./src/engine'),
      '@shared': alias('./src/shared'),
      '@render': alias('./src/render'),
      '@ui': alias('./src/ui'),
      '@themes': alias('./src/themes'),
      '@worker': alias('./src/worker'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: alias('./dist/client'),
    emptyOutDir: true,
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
  },
});
