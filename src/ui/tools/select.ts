/**
 * Selection & clipboard: marquee-select a rectangular region, then copy/cut/paste/delete/move/
 * rotate/flip it. Selection content is captured once, at marquee finalisation — a frozen
 * snapshot, not a live view that would need continuous grid access while merely selected.
 *
 * Only the marquee drag is a `Tool` gesture (`onDown`/`onMove`/`onUp`); copy/cut/paste/rotate/
 * flip/move are discrete actions exposed as plain methods — the same "tools produce data, a
 * future `CommandBus` commits it" shape P1-B-2 established. A keybinding layer (`Ctrl/Cmd+C`
 * etc., P1-C-2) calls these directly once it exists.
 *
 * "Paste follows the cursor as a ghost" is best-effort: P1-B-1's router only forwards pointer
 * *moves during an active stroke* (button held), not hover — there is currently no event stream
 * that would let a ghost track a bare, button-up mouse move. The ghost still updates on every
 * move this tool does receive and always locks to the exact click position on placement; smooth
 * hover tracking is a follow-up once the router (or a sibling hover-only listener) supports it.
 *
 * Ships no local RLE codec: encode/decode live in `@shared/rle` (P2-A-1, syntactic, Golly
 * multi-state). Clipboard round-trips go through that module.
 */
import { decode, encode } from '@shared/rle';
import { DEAD, type GridView, type PaintOp, type Rect, type StateId } from '@shared/types';
import type { Tool, ToolContext } from './tool';

export interface ClipboardCell {
  readonly x: number;
  readonly y: number;
  readonly state: StateId;
}

/** A captured (or clipboard-buffered) pattern, in its own local coordinate space (top-left `0,0`). */
export interface ClipboardPattern {
  readonly width: number;
  readonly height: number;
  /** Non-dead cells only — a dead cell within the bounding box is simply absent. */
  readonly cells: readonly ClipboardCell[];
}

/** The `navigator.clipboard`-shaped slice this tool needs — injected so tests never touch the real one. */
export interface SystemClipboard {
  writeText(text: string): Promise<void>;
}

function defaultSystemClipboard(): SystemClipboard | undefined {
  return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : undefined;
}

function denseGrid(pattern: ClipboardPattern): StateId[] {
  const dense = new Array<StateId>(pattern.width * pattern.height).fill(DEAD);
  for (const c of pattern.cells) {
    if (c.x >= 0 && c.x < pattern.width && c.y >= 0 && c.y < pattern.height) {
      dense[c.y * pattern.width + c.x] = c.state;
    }
  }
  return dense;
}

function captureCells(grid: GridView, rect: Rect): ClipboardPattern {
  const cells: ClipboardCell[] = [];
  for (let dy = 0; dy < rect.height; dy++) {
    for (let dx = 0; dx < rect.width; dx++) {
      const state = grid.get(rect.x + dx, rect.y + dy);
      if (state !== DEAD) cells.push({ x: dx, y: dy, state });
    }
  }
  return { width: rect.width, height: rect.height, cells };
}

/** Rotates a pattern 90° clockwise. */
export function rotate90(pattern: ClipboardPattern): ClipboardPattern {
  const { width, height, cells } = pattern;
  return {
    width: height,
    height: width,
    cells: cells.map((c) => ({ x: height - 1 - c.y, y: c.x, state: c.state })),
  };
}

export function flipHorizontal(pattern: ClipboardPattern): ClipboardPattern {
  return { ...pattern, cells: pattern.cells.map((c) => ({ x: pattern.width - 1 - c.x, y: c.y, state: c.state })) };
}

export function flipVertical(pattern: ClipboardPattern): ClipboardPattern {
  return { ...pattern, cells: pattern.cells.map((c) => ({ x: c.x, y: pattern.height - 1 - c.y, state: c.state })) };
}

function clearOps(rect: Rect): PaintOp[] {
  const ops: PaintOp[] = [];
  for (let dy = 0; dy < rect.height; dy++) {
    for (let dx = 0; dx < rect.width; dx++) {
      ops.push({ x: rect.x + dx, y: rect.y + dy, state: DEAD });
    }
  }
  return ops;
}

/** Every cell of the pattern's bounding box, dead cells included — a paste overwrites its full footprint, not just the live cells, so no old content shows through the gaps. */
function placementOps(pattern: ClipboardPattern, anchor: { x: number; y: number }): PaintOp[] {
  const dense = denseGrid(pattern);
  const ops: PaintOp[] = [];
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      ops.push({ x: anchor.x + x, y: anchor.y + y, state: dense[y * pattern.width + x]! });
    }
  }
  return ops;
}

function roundPoint(p: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function normalizeRect(anchor: { x: number; y: number }, point: { x: number; y: number }): Rect {
  const x0 = Math.min(anchor.x, point.x);
  const y0 = Math.min(anchor.y, point.y);
  const x1 = Math.max(anchor.x, point.x);
  const y1 = Math.max(anchor.y, point.y);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export const decodeRLE = decode;
/** Clipboard encode keeps the marquee size (dead padding included) so paste overwrites the same footprint. */
export function encodeRLE(pattern: ClipboardPattern): string {
  return encode(pattern, { trim: false });
}

// --- the tool ----------------------------------------------------------------------------------

export interface SelectToolOptions {
  readonly clipboard?: SystemClipboard;
}

type Mode = 'idle' | 'selecting' | 'placing';

export class SelectTool implements Tool {
  readonly id = 'select';
  readonly cursor = 'crosshair';

  private mode: Mode = 'idle';
  private marqueeAnchor: { x: number; y: number } | null = null;
  private marquee: Rect | null = null;
  private selection: { rect: Rect; pattern: ClipboardPattern } | null = null;
  private buffer: ClipboardPattern | null = null;
  private placementAnchor: { x: number; y: number } | null = null;
  private pendingPlacement: readonly PaintOp[] | null = null;

  private readonly clipboard: SystemClipboard | undefined;

  constructor(options: SelectToolOptions = {}) {
    this.clipboard = options.clipboard ?? defaultSystemClipboard();
  }

  /** The in-progress marquee rectangle, or `null` when not mid-drag. For the overlay to draw. */
  get marqueeRect(): Rect | null {
    return this.marquee;
  }

  /** The finalised selection's bounding box, or `null` when nothing is selected. For the overlay to draw. */
  get selectedRect(): Rect | null {
    return this.selection?.rect ?? null;
  }

  onDown(ctx: ToolContext): void {
    const point = roundPoint(ctx.event.point);
    if (this.mode === 'placing') {
      this.placementAnchor = point;
      this.pendingPlacement = this.buffer ? placementOps(this.buffer, point) : [];
      return;
    }
    this.mode = 'selecting';
    this.marqueeAnchor = point;
    this.marquee = { x: point.x, y: point.y, width: 1, height: 1 };
    // The previous selection (if any) is left alone until this new drag actually finishes
    // (onUp) — cancelling a new marquee mid-drag must not also lose the old selection.
  }

  onMove(ctx: ToolContext): void {
    const point = roundPoint(ctx.event.point);
    if (this.mode === 'selecting' && this.marqueeAnchor) {
      this.marquee = normalizeRect(this.marqueeAnchor, point);
    } else if (this.mode === 'placing') {
      this.placementAnchor = point;
    }
  }

  onUp(ctx: ToolContext): readonly PaintOp[] {
    if (this.mode === 'placing') {
      const ops = this.pendingPlacement ?? [];
      this.pendingPlacement = null;
      this.mode = 'idle';
      return ops;
    }
    if (this.mode === 'selecting' && this.marqueeAnchor) {
      // Recomputed from this event's own point, like rect.ts/line.ts/ellipse.ts's onUp — the
      // final onUp always carries the authoritative position, which may differ from (or simply
      // not have been preceded by) the last onMove.
      const rect = normalizeRect(this.marqueeAnchor, roundPoint(ctx.event.point));
      this.mode = 'idle';
      this.marqueeAnchor = null;
      this.marquee = null;
      if (ctx.grid) {
        this.selection = { rect, pattern: captureCells(ctx.grid, rect) };
      }
      return [];
    }
    return [];
  }

  onCancel(): void {
    this.mode = 'idle';
    this.marqueeAnchor = null;
    this.marquee = null;
    this.pendingPlacement = null;
    // A previously finalised `selection` survives cancelling a *new* in-progress gesture — only
    // the marquee-drag or placement-in-progress is discarded, per the Tool contract.
  }

  preview(): readonly PaintOp[] {
    if (this.pendingPlacement) return this.pendingPlacement;
    if (this.mode === 'placing' && this.buffer && this.placementAnchor) {
      return placementOps(this.buffer, this.placementAnchor);
    }
    return [];
  }

  // --- discrete actions (called by a future keybinding/command layer, not by pointer events) ---

  /** Copies the current selection into the internal clipboard buffer. */
  copy(): void {
    if (this.selection) this.buffer = this.selection.pattern;
  }

  /** Copies the current selection, then returns the ops that clear it from the grid. */
  cut(): readonly PaintOp[] {
    if (!this.selection) return [];
    this.buffer = this.selection.pattern;
    return clearOps(this.selection.rect);
  }

  /** Returns the ops that clear the current selection, without touching the clipboard buffer. */
  delete(): readonly PaintOp[] {
    return this.selection ? clearOps(this.selection.rect) : [];
  }

  /** Enters placement mode with the clipboard buffer, ghost-following the cursor until a click places it. */
  paste(): void {
    if (!this.buffer) return;
    this.mode = 'placing';
    this.placementAnchor = this.selection ? { x: this.selection.rect.x, y: this.selection.rect.y } : { x: 0, y: 0 };
    this.pendingPlacement = null;
  }

  /** Cuts the current selection and immediately re-enters placement mode with it — move-by-cut-and-paste. */
  move(): readonly PaintOp[] {
    const clearing = this.cut();
    this.paste();
    return clearing;
  }

  /** Rotates the clipboard buffer 90° clockwise, in place. A no-op with nothing copied yet. */
  rotate(): void {
    if (this.buffer) this.buffer = rotate90(this.buffer);
  }

  flipHorizontally(): void {
    if (this.buffer) this.buffer = flipHorizontal(this.buffer);
  }

  flipVertically(): void {
    if (this.buffer) this.buffer = flipVertical(this.buffer);
  }

  /** RLE of the current selection, or `null` when nothing is selected. */
  selectionRle(): string | null {
    if (!this.selection) return null;
    return encode(this.selection.pattern, { trim: false });
  }

  /** Encodes the current selection as RLE and writes it to the system clipboard. */
  async writeSystemClipboard(): Promise<void> {
    if (!this.selection) return;
    if (!this.clipboard) {
      throw new Error('no system clipboard available in this environment');
    }
    await this.clipboard.writeText(encode(this.selection.pattern, { trim: false }));
  }

  /** Decodes RLE text (e.g. pasted from the system clipboard) and enters placement mode with it. */
  pasteFromRLE(text: string): void {
    this.buffer = decode(text);
    this.paste();
  }
}
