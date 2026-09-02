import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const UNDER_COVERAGE = process.argv.includes('--coverage');
if (UNDER_COVERAGE) process.env['VITEST_COVERAGE'] = '1';

export default defineConfig({
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
  test: {
    // The engine is pure — it must never need a DOM. jsdom is opt-in per project below.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // Sequential for `vitest run` so the 512² soup floor isn't racing other
          // files. Coverage skips those wall-clock asserts and can stay parallel.
          fileParallelism: UNDER_COVERAGE,
          include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
          exclude: [
            'tests/unit/ui/**',
            'tests/unit/render/**',
            'tests/unit/themes/**',
            'src/ui/**',
            'src/render/**',
            'src/themes/**',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: [
            'tests/unit/ui/**/*.spec.ts',
            'tests/unit/render/**/*.spec.ts',
            'tests/unit/themes/**/*.spec.ts',
            'src/ui/**/*.spec.ts',
            'src/render/**/*.spec.ts',
            'src/themes/**/*.spec.ts',
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/client/**',
        'src/**/*.d.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        'src/engine/**': { statements: 95, branches: 90, functions: 95 },
        'src/shared/**': { statements: 95, branches: 90, functions: 95 },
        'src/render/**': { statements: 85, branches: 75, functions: 85 },
        'src/ui/**': { statements: 70, branches: 60, functions: 70 },
        'src/themes/**': { statements: 70, branches: 60, functions: 70 },
        'src/server/**': { statements: 85, branches: 75, functions: 85 },
      },
    },
  },
});
