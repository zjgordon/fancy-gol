/**
 * The engine's public type vocabulary (ADR-001). Every later phase speaks in these terms.
 *
 * The definitions live in `src/shared/types.ts` — ADR-009's boundary matrix lets `engine/`
 * import `shared/types`, but not the other way around, and `src/shared/protocol.ts` (P0-G-1)
 * needs `RuleSet`, `PaintOp`, `ChangeSet` and friends too. This file re-exports that module in
 * full so every `@engine/types` import keeps working unchanged.
 */
export * from '../shared/types';
