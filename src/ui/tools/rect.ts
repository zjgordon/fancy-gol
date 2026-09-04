/**
 * Rectangle: drag for opposite corners; Alt anchors the down-point as the centre instead, so the
 * shape extends symmetrically outward. Shift constrains to a square. Filled or outline-only.
 */
import type { PaintOp, StateId } from '@shared/types';
import type { Tool, ToolContext } from './tool';

export interface RectOptions {
  readonly state?: StateId;
  readonly filled?: boolean;
}

export class RectTool implements Tool {
  readonly id = 'rect';
  readonly cursor = 'crosshair';
  state: StateId;
  filled: boolean;

  private anchor: { x: number; y: number } | null = null;
  private currentOps: readonly PaintOp[] = [];

  constructor(options: RectOptions = {}) {
    this.state = options.state ?? 1;
    this.filled = options.filled ?? false;
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
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * size;
      dy = Math.sign(dy || 1) * size;
    }

    let x0: number;
    let y0: number;
    if (ctx.event.modifiers.alt) {
      x0 = this.anchor.x - dx;
      y0 = this.anchor.y - dy;
    } else {
      x0 = this.anchor.x;
      y0 = this.anchor.y;
    }
    const x1 = this.anchor.x + dx;
    const y1 = this.anchor.y + dy;

    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    const ops: PaintOp[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const onBorder = x === minX || x === maxX || y === minY || y === maxY;
        if (this.filled || onBorder) ops.push({ x, y, state: this.state });
      }
    }
    return ops;
  }
}
