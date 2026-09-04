/**
 * The edit undo/redo stack: records each committed edit as a `{forward, inverse}` pair of
 * `PaintOp[]` and lets a caller walk backward/forward through them. `undo()`/`redo()` only ever
 * *return* the ops to apply — matching the "tools produce data, something else commits it"
 * shape this whole codebase uses — never touching a grid or `Simulation` themselves (`ui/`
 * cannot reach `engine/` anyway, ADR-009).
 *
 * **Explicitly separate from the Phase 4 time machine**: this stack reverses *your edits*; the
 * timeline reverses *the simulation*. `undo()` never touches a tick count — it only ever
 * produces `PaintOp[]`, and `Simulation.paint()` (what would apply them) never advances or
 * rewinds `tick` either. The two mechanisms don't overlap by construction, not by convention.
 *
 * `editFromChangeSet` unpacks a `ChangeSet` into `forward`/`inverse` `PaintOp[]`s using the same
 * `(x << 16) | (y & 0xffff)` packing `engine/grid/coords.ts`'s `packCell`/`unpackCellX`/
 * `unpackCellY` already implement — a hand-written duplicate, not an import: `ui/` cannot reach
 * `engine/` (ADR-009), the same treatment `brush.ts`'s PRNG and `select.ts`'s RLE codec already
 * get. It copies eagerly into plain arrays because a `ChangeSet`'s typed arrays are reused
 * in place by the engine's next `paint()`/`step()` call — retaining a reference past that point
 * would silently see the *next* change's data instead (`ChangeSet`'s own documented contract).
 *
 * **Follow-up from P1-C-1, not solved here:** `CommandBus`'s `onUndoableRun` is a no-op by
 * default — wiring it to `record()` needs an `AppContext` that can actually apply an undoable
 * command's edit and diff the result, which doesn't exist until a real `Simulation`/
 * `WorkerClient` composition root does (the same gap `app-context.ts`'s `onPaint` already
 * documents). That wiring, and connecting a tool's committed ops all the way through to a real
 * `ChangeSet` to record, are both for whichever task first assembles that root.
 */
import type { ChangeSet, PaintOp } from '@shared/types';

export const DEFAULT_DEPTH_CAP = 200;
/** A generous, deliberately approximate ceiling — see `estimateBytes`'s own doc. */
export const DEFAULT_BYTE_CAP = 4 * 1024 * 1024;
/** Conservative per-`PaintOp` estimate: plain JS objects cost far more than a packed `{x,y,state}` triple would. */
const BYTES_PER_OP_ESTIMATE = 32;

function estimateBytes(ops: readonly PaintOp[]): number {
  return ops.length * BYTES_PER_OP_ESTIMATE;
}

interface EditEntry {
  readonly forward: readonly PaintOp[];
  readonly inverse: readonly PaintOp[];
}

/**
 * Unpacks a `ChangeSet` into `forward` (its `to` values — what redo would (re)apply) and
 * `inverse` (its `from` values — what undo applies) `PaintOp[]`s, copied eagerly into plain
 * arrays so they outlive the engine's next `paint()`/`step()` call.
 */
export function editFromChangeSet(cs: ChangeSet): EditEntry {
  const forward: PaintOp[] = [];
  const inverse: PaintOp[] = [];
  for (let i = 0; i < cs.count; i++) {
    const packed = cs.coords[i]!;
    const x = packed >> 16;
    const y = (packed << 16) >> 16;
    forward.push({ x, y, state: cs.to[i]! });
    inverse.push({ x, y, state: cs.from[i]! });
  }
  return { forward, inverse };
}

export interface EditStackOptions {
  readonly depthCap?: number;
  readonly byteCap?: number;
}

export class EditStack {
  private readonly undoEntries: EditEntry[] = [];
  private readonly redoEntries: EditEntry[] = [];
  private readonly depthCap: number;
  private readonly byteCap: number;
  private byteEstimate = 0;

  constructor(options: EditStackOptions = {}) {
    this.depthCap = options.depthCap ?? DEFAULT_DEPTH_CAP;
    this.byteCap = options.byteCap ?? DEFAULT_BYTE_CAP;
  }

  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  get depth(): number {
    return this.undoEntries.length;
  }

  /** Records a completed edit. A new edit always invalidates any pending redo history. */
  record(entry: EditEntry): void {
    this.redoEntries.length = 0;
    this.undoEntries.push(entry);
    this.byteEstimate += estimateBytes(entry.forward) + estimateBytes(entry.inverse);
    this.enforceCaps();
  }

  /** The ops to apply to undo the most recent edit, or `undefined` with nothing to undo. */
  undo(): readonly PaintOp[] | undefined {
    const entry = this.undoEntries.pop();
    if (!entry) return undefined;
    this.redoEntries.push(entry);
    this.byteEstimate -= estimateBytes(entry.forward) + estimateBytes(entry.inverse);
    return entry.inverse;
  }

  /** The ops to apply to redo the most recently undone edit, or `undefined` with nothing to redo. */
  redo(): readonly PaintOp[] | undefined {
    const entry = this.redoEntries.pop();
    if (!entry) return undefined;
    this.undoEntries.push(entry);
    this.byteEstimate += estimateBytes(entry.forward) + estimateBytes(entry.inverse);
    return entry.forward;
  }

  clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.byteEstimate = 0;
  }

  private enforceCaps(): void {
    while (this.undoEntries.length > this.depthCap) {
      this.evictOldest();
    }
    while (this.byteEstimate > this.byteCap && this.undoEntries.length > 0) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    const removed = this.undoEntries.shift();
    if (!removed) return;
    this.byteEstimate -= estimateBytes(removed.forward) + estimateBytes(removed.inverse);
  }
}
