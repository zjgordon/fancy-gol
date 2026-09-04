/**
 * Line: drag to draw a straight Bresenham line. Shift constrains the angle to the nearest 45°;
 * Alt anchors the down-point as the line's centre instead of one endpoint (extending
 * symmetrically in both directions). The preview recomputes fully on every move rather than
 * accumulating like Brush's stroke trail — a shape tool always shows "what would commit right
 * now", not a trail of everywhere the cursor has been.
 */
import type { PaintOp, StateId } from '@shared/types';
import { bresenham, packXY } from './brush';
import type { Tool, ToolContext } from './tool';

export interface LineOptions {
  readonly state?: StateId;
}

function snapTo45(dx: number, dy: number): readonly [number, number] {
  if (dx === 0 && dy === 0) return [0, 0];
  const STEP = Math.PI / 4;
  const snapped = Math.round(Math.atan2(dy, dx) / STEP) * STEP;
  const dist = Math.hypot(dx, dy);
  return [Math.round(Math.cos(snapped) * dist), Math.round(Math.sin(snapped) * dist)];
}

export class LineTool implements Tool {
  readonly id = 'line';
  readonly cursor = 'crosshair';
  state: StateId;

  private anchor: { x: number; y: number } | null = null;
  private currentOps: readonly PaintOp[] = [];

  constructor(options: LineOptions = {}) {
    this.state = options.state ?? 1;
  }

  onDown(ctx: ToolContext): void {
    this.anchor = { x: Math.round(ctx.event.point.x), y: Math.round(ctx.event.point.y) };
    this.currentOps = this.computeOps(ctx);
  }

  onMove(ctx: ToolContext): void {
    if (!this.anchor) return;
    this.currentOps = this.computeOps(ctx);
  }

  onUp(ctx: ToolContext): readonly PaintOp[] {
    const ops = this.computeOps(ctx);
    this.anchor = null;
    this.currentOps = [];
    return ops;
  }

  onCancel(): void {
    this.anchor = null;
    this.currentOps = [];
  }

  preview(): readonly PaintOp[] {
    return this.currentOps;
  }

  private computeOps(ctx: ToolContext): readonly PaintOp[] {
    if (!this.anchor) return [];
    const cursorX = Math.round(ctx.event.point.x);
    const cursorY = Math.round(ctx.event.point.y);
    let dx = cursorX - this.anchor.x;
    let dy = cursorY - this.anchor.y;

    if (ctx.event.modifiers.shift) {
      [dx, dy] = snapTo45(dx, dy);
    }

    const x1 = this.anchor.x + dx;
    const y1 = this.anchor.y + dy;
    const x0 = ctx.event.modifiers.alt ? this.anchor.x - dx : this.anchor.x;
    const y0 = ctx.event.modifiers.alt ? this.anchor.y - dy : this.anchor.y;

    const seen = new Set<number>();
    const ops: PaintOp[] = [];
    for (const [x, y] of bresenham(x0, y0, x1, y1)) {
      const key = packXY(x, y);
      if (seen.has(key)) continue;
      seen.add(key);
      ops.push({ x, y, state: this.state });
    }
    return ops;
  }
}
