/**
 * Stamp: pick a named pattern from a library, rotate/flip it, and click to place — a ghost
 * preview follows the cursor (same best-effort limitation P1-B-5's paste has: P1-B-1's router
 * only forwards moves during an active stroke, not hover) until a click commits it. Holding
 * Shift while clicking keeps the same stamp selected for another placement instead of
 * deselecting; a plain click places once and returns to idle.
 *
 * The library is data (`StampDefinition.rle`, plain RLE text — reusing P1-B-5's minimal codec,
 * same layer, an ordinary import) — not code building `PaintOp[]` by hand. `StampTool`'s
 * `library` constructor option is what actually makes this the acceptance criterion's "no tool
 * changes" claim true: Phase 2 substitutes `BUILTIN_STAMPS` for its full catalogue by passing a
 * different array of the same shape, never touching this file.
 *
 * Unlike P1-B-5's paste (which overwrites a selection's full bounding box, dead gaps included,
 * to replace whatever was there), a stamp only ever paints its own live cells — you stamp a
 * glider onto a mostly-empty area, not into a rectangular clearing cut out of existing content.
 *
 * `BUILTIN_STAMPS`' RLE text was generated from hand-verified cell coordinates for each pattern
 * (period/translation behaviour checked against a real `Simulation`, not merely transcribed from
 * memory) and round-tripped through `encodeRLE`/`decodeRLE` to confirm self-consistency — see
 * this task's closing note in the phase doc for exactly what was checked.
 */
import type { PaintOp, StateId } from '@shared/types';
import { decodeRLE, flipHorizontal, flipVertical, rotate90, type ClipboardPattern } from './select';
import type { Tool, ToolContext } from './tool';

export interface StampDefinition {
  readonly id: string;
  readonly name: string;
  /** Plain RLE text (P1-B-5's minimal codec) — data, not code. */
  readonly rle: string;
}

export const BUILTIN_STAMPS: readonly StampDefinition[] = [
  { id: 'block', name: 'Block', rle: 'x = 2, y = 2\n2o$\n2o!' },
  { id: 'blinker', name: 'Blinker', rle: 'x = 3, y = 1\n3o!' },
  { id: 'glider', name: 'Glider', rle: 'x = 3, y = 3\nbo$\n2bo$\n3o!' },
  { id: 'toad', name: 'Toad', rle: 'x = 4, y = 2\nb3o$\n3o!' },
  { id: 'beacon', name: 'Beacon', rle: 'x = 4, y = 4\n2o$\n2o$\n2b2o$\n2b2o!' },
  { id: 'lwss', name: 'Lightweight spaceship', rle: 'x = 5, y = 4\nb4o$\no3bo$\n4bo$\no2bo!' },
  { id: 'r-pentomino', name: 'R-pentomino', rle: 'x = 3, y = 3\nb2o$\n2o$\nbo!' },
  { id: 'acorn', name: 'Acorn', rle: 'x = 7, y = 3\nbo$\n3bo$\n2o2b3o!' },
  {
    id: 'pulsar',
    name: 'Pulsar',
    rle:
      'x = 13, y = 13\n2b3o3b3o$\n$\no4bobo4bo$\no4bobo4bo$\no4bobo4bo$\n2b3o3b3o$\n$\n' +
      '2b3o3b3o$\no4bobo4bo$\no4bobo4bo$\no4bobo4bo$\n$\n2b3o3b3o!',
  },
  {
    id: 'gosper-gun',
    name: 'Gosper glider gun',
    rle:
      'x = 36, y = 9\n24bo$\n22bobo$\n12b2o6b2o12b2o$\n11bo3bo4b2o12b2o$\n2o8bo5bo3b2o$\n' +
      '2o8bo3bob2o4bobo$\n10bo5bo7bo$\n11bo3bo$\n12b2o!',
  },
];

function roundPoint(p: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Only the pattern's own live cells, translated to the anchor — never a bounding-box clear. */
function placementOps(pattern: ClipboardPattern, anchor: { x: number; y: number }, state: StateId): PaintOp[] {
  return pattern.cells.map((c) => ({ x: anchor.x + c.x, y: anchor.y + c.y, state }));
}

export interface StampToolOptions {
  readonly library?: readonly StampDefinition[];
  readonly state?: StateId;
}

export class StampTool implements Tool {
  readonly id = 'stamp';
  readonly cursor = 'crosshair';
  state: StateId;

  private readonly library: readonly StampDefinition[];
  private activeId: string | null = null;
  private pattern: ClipboardPattern | null = null;
  private anchor: { x: number; y: number } | null = null;
  private pendingPlacement: readonly PaintOp[] | null = null;

  constructor(options: StampToolOptions = {}) {
    this.library = options.library ?? BUILTIN_STAMPS;
    this.state = options.state ?? 1;
  }

  /** The stamp library this tool was constructed with (defaults to {@link BUILTIN_STAMPS}). */
  list(): readonly StampDefinition[] {
    return this.library;
  }

  /** The currently selected stamp's id, or `null` when nothing is selected. */
  get selectedId(): string | null {
    return this.activeId;
  }

  /** Selects a stamp by id, entering ghost-placement mode with it (rotation/flips reset). */
  select(id: string): void {
    const def = this.library.find((s) => s.id === id);
    if (!def) throw new RangeError(`no stamp registered with id "${id}"`);
    this.activeId = id;
    this.pattern = decodeRLE(def.rle);
    this.anchor ??= { x: 0, y: 0 };
    this.pendingPlacement = null;
  }

  /** Deselects the current stamp, leaving placement mode. */
  deselect(): void {
    this.activeId = null;
    this.pattern = null;
    this.pendingPlacement = null;
  }

  rotate(): void {
    if (this.pattern) this.pattern = rotate90(this.pattern);
  }

  flipHorizontally(): void {
    if (this.pattern) this.pattern = flipHorizontal(this.pattern);
  }

  flipVertically(): void {
    if (this.pattern) this.pattern = flipVertical(this.pattern);
  }

  onDown(ctx: ToolContext): void {
    if (!this.pattern) return;
    this.anchor = roundPoint(ctx.event.point);
    this.pendingPlacement = placementOps(this.pattern, this.anchor, this.state);
  }

  onMove(ctx: ToolContext): void {
    if (!this.pattern) return;
    this.anchor = roundPoint(ctx.event.point);
  }

  onUp(ctx: ToolContext): readonly PaintOp[] {
    const ops = this.pendingPlacement ?? [];
    this.pendingPlacement = null;
    if (!ctx.event.modifiers.shift) {
      this.pattern = null;
      this.activeId = null;
    }
    return ops;
  }

  onCancel(): void {
    this.pendingPlacement = null;
  }

  preview(): readonly PaintOp[] {
    if (this.pendingPlacement) return this.pendingPlacement;
    if (this.pattern && this.anchor) return placementOps(this.pattern, this.anchor, this.state);
    return [];
  }
}
