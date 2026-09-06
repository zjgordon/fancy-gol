// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { noLiteralDesignTokens } from './scripts/eslint-rules/no-literal-design-tokens.mjs';

const ENGINE_FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'fetch',
  'console',
  'process',
  'performance',
  // Time must be injected (src/engine/clock.ts, P0-B-3); Date is a hidden non-determinism
  // source just like performance.now().
  'Date',
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.agents/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-globals': 'off',
    },
  },
  // Pure Logic (ADR-009): src/engine/** may never touch DOM, Node, or I/O globals.
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...ENGINE_FORBIDDEN_GLOBALS],
    },
  },
  // Hot loops preallocate: no growable-array idioms once inside an engine hot path.
  {
    files: ['src/engine/**/hot/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Array']",
          message: 'Hot-path code preallocates typed arrays; do not `new Array(...)` here.',
        },
        {
          selector: "CallExpression[callee.property.name='push']",
          message: 'Hot-path code preallocates; do not Array.prototype.push here.',
        },
      ],
    },
  },
  // Token contract (ADR-008, P1-E-1): src/ui/** reads --gol-* tokens, it never hardcodes a
  // colour or a raw motion duration/size. See src/themes/tokens.css for the token names.
  {
    files: ['src/ui/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    plugins: { local: { rules: { 'no-literal-design-tokens': noLiteralDesignTokens } } },
    rules: {
      'local/no-literal-design-tokens': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
