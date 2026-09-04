/**
 * The `Tool` contract (Phase 1 §2.1/§2.2): a tool turns pointer input into `PaintOp[]` data and
 * nothing else — it never touches a grid, a `Simulation`, or a commit path directly (`ui/` can't
 * even reach `engine/`, per ADR-009). `onUp` hands back the finalised ops for whatever commits
 * them (P1-C-1's `CommandBus`, once it exists — see `registry.ts`'s `onCommit` seam); `onCancel`
 * has no return channel at all, so a cancelled gesture cannot produce a commit even by accident —
 * the type system makes "Escape leaves the grid byte-identical" load-bearing, not a convention.
 *
 * `ToolContext` wraps `ToolEvent` (rather than being that type directly) so a later task can
 * widen it without changing every `Tool` implementation's method signatures. P1-B-3's brush/
 * eraser turned out not to need this — size, shape, state, symmetry all live as plain properties
 * on the tool itself, set directly by whatever future component exposes them. `grid` below is
 * the widening's first real use: P1-B-4's flood fill is the first tool that needs to *read*
 * existing cell state, not just generate ops from cursor position alone.
 */
import type { GridView, PaintOp } from '@shared/types';
import type { ToolEvent } from '@ui/input/router';

export interface ToolContext {
  readonly event: ToolEvent;
  /**
   * Read-only live grid access. Optional because most tools are purely generative from cursor
   * position and never need it. Wiring an actual live `GridView` in here — sourced from a real
   * `WorkerClient`'s frame mirror — is a follow-up for whichever task first composes the full
   * tool pipeline; `ToolRegistry.handlers` (P1-B-2) doesn't supply one today.
   */
  readonly grid?: GridView;
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
