/**
 * The engine's public type vocabulary (ADR-001). Every later phase speaks in these terms.
 *
 * The definitions live in `src/shared/types.ts` — ADR-009 lets `engine/` import `shared/`.
 * `src/engine/types.ts` re-exports that module in full so every `@engine/types` import keeps
 * working unchanged.
 */
export * from '../shared/types.js';
