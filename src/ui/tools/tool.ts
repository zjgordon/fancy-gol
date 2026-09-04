/**
 * The `Tool` contract (Phase 1 §2.1/§2.2): a tool turns pointer input into `PaintOp[]` data and
 * nothing else — it never touches a grid, a `Simulation`, or a commit path directly (`ui/` can't
 * even reach `engine/`, per ADR-009). `onUp` hands back the finalised ops for whatever commits
 * them (P1-C-1's `CommandBus`, once it exists — see `registry.ts`'s `onCommit` seam); `onCancel`
 * has no return channel at all, so a cancelled gesture cannot produce a commit even by accident —
 * the type system makes "Escape leaves the grid byte-identical" load-bearing, not a convention.
 *
 * `ToolContext` wraps the single thing every tool needs today (P1-B-1's `ToolEvent`) rather than
 * being that type directly, so a later task (P1-B-3: paint state, brush size, symmetry mode) can
 * widen it without changing every `Tool` implementation's method signatures.
 */
import type { PaintOp } from '@shared/types';
import type { ToolEvent } from '@ui/input/router';

export interface ToolContext {
  readonly event: ToolEvent;
}

export interface Tool {
  /** Stable id — the registry key and the future command id (`tool.select.<id>`, P1-C-1). */
  readonly id: string;
  /** CSS `cursor` value while this tool is active. */
  readonly cursor: string;
  onDown(ctx: ToolContext): void;
  onMove(ctx: ToolContext): void;
  /** Finalises the in-progress gesture, returning the ops to commit. Only ever called after a prior `onDown` that wasn't since cancelled. */
  onUp(ctx: ToolContext): readonly PaintOp[];
  /** Discards any in-progress gesture. No return value: nothing from a cancelled gesture ever commits. */
  onCancel(): void;
  /** The live ghost preview of what `onUp` would commit right now; `[]` when idle. */
  preview(): readonly PaintOp[];
}
