// Hand-written type declarations for no-literal-design-tokens.mjs so
// tests/unit/eslint-rules/no-literal-design-tokens.spec.ts can typecheck it. The rule itself
// stays plain JS — it's loaded directly by eslint.config.js, no build step (P0-A-5's precedent).
import type { Rule } from 'eslint';

export declare function findLiteralViolation(value: unknown): string | null;
export declare const noLiteralDesignTokens: Rule.RuleModule;
