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
  },
});
