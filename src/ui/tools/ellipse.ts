/**
 * Ellipse: drag for the bounding box; Alt anchors the down-point as the centre and the cursor
 * gives the radii directly. Shift constrains to a circle. Filled or outline-only.
 *
 * Uses the classic integer midpoint ellipse algorithm: one octant-pair (a single quadrant) is
 * computed by walking the boundary where the two circular-vs-flat regions meet, then mirrored
 * to the other three quadrants — which is exactly what makes the result symmetric by
 * construction, not merely by coincidence of a particular `(rx, ry)`.
 */
import type { PaintOp, StateId } from '@shared/types';
import { packXY } from './brush';
import type { Tool, ToolContext } from './tool';

export interface EllipseOptions {
  readonly state?: StateId;
  readonly filled?: boolean;
}

/** One quadrant's points (x, y >= 0), relative to the centre. Degenerates cleanly to a line when `rx` or `ry` is 0. */
export function midpointEllipseQuadrant(rx: number, ry: number): ReadonlyArray<readonly [number, number]> {
  if (rx === 0 && ry === 0) return [[0, 0]];
  if (rx === 0) return Array.from({ length: ry + 1 }, (_, y) => [0, y] as const);
  if (ry === 0) return Array.from({ length: rx + 1 }, (_, x) => [x, 0] as const);

  const points: Array<readonly [number, number]> = [];
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  let x = 0;
  let y = ry;
  let dx = 2 * ry2 * x;
  let dy = 2 * rx2 * y;
  let d1 = ry2 - rx2 * ry + 0.25 * rx2;

  // Region 1: boundary slope is shallower than -1 (wide part of the ellipse).
  while (dx < dy) {
    points.push([x, y]);
    if (d1 < 0) {
      x++;
      dx += 2 * ry2;
      d1 += dx + ry2;
    } else {
      x++;
      y--;
      dx += 2 * ry2;
      dy -= 2 * rx2;
      d1 += dx - dy + ry2;
    }
  }

  // Region 2: boundary slope is steeper than -1 (narrow part, near the pole).
  let d2 = ry2 * (x + 0.5) ** 2 + rx2 * (y - 1) ** 2 - rx2 * ry2;
  while (y >= 0) {
    points.push([x, y]);
    if (d2 > 0) {
      y--;
      dy -= 2 * rx2;
      d2 += rx2 - dy;
    } else {
      y--;
      x++;
      dx += 2 * ry2;
      dy -= 2 * rx2;
      d2 += dx - dy + rx2;
    }
  }
  return points;
}

function outlinePoints(cx: number, cy: number, rx: number, ry: number): ReadonlyArray<readonly [number, number]> {
  const seen = new Set<number>();
  const out: Array<readonly [number, number]> = [];
  for (const [qx, qy] of midpointEllipseQuadrant(rx, ry)) {
    for (const [sx, sy] of [
      [qx, qy],
      [-qx, qy],
      [qx, -qy],
      [-qx, -qy],
    ] as const) {
      const x = cx + sx;
      const y = cy + sy;
      const key = packXY(x, y);
      if (!seen.has(key)) {
        seen.add(key);
        out.push([x, y]);
      }
    }
  }
  return out;
}

export class EllipseTool implements Tool {
  readonly id = 'ellipse';
  readonly cursor = 'crosshair';
  state: StateId;
  filled: boolean;

  private anchor: { x: number; y: number } | null = null;
  private currentOps: readonly PaintOp[] = [];

  constructor(options: EllipseOptions = {}) {
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
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * r;
      dy = Math.sign(dy || 1) * r;
    }

    let cx: number;
    let cy: number;
    let rx: number;
    let ry: number;
    if (ctx.event.modifiers.alt) {
      cx = this.anchor.x;
      cy = this.anchor.y;
      rx = Math.abs(dx);
      ry = Math.abs(dy);
    } else {
      cx = Math.round(this.anchor.x + dx / 2);
      cy = Math.round(this.anchor.y + dy / 2);
      rx = Math.round(Math.abs(dx) / 2);
      ry = Math.round(Math.abs(dy) / 2);
    }

    const outline = outlinePoints(cx, cy, rx, ry);
    if (!this.filled) {
      return outline.map(([x, y]) => ({ x, y, state: this.state }));
    }

    const rowExtent = new Map<number, { min: number; max: number }>();
    for (const [x, y] of outline) {
      const extent = rowExtent.get(y);
      if (!extent) rowExtent.set(y, { min: x, max: x });
      else {
        extent.min = Math.min(extent.min, x);
        extent.max = Math.max(extent.max, x);
      }
    }
    const ops: PaintOp[] = [];
    for (const [y, extent] of rowExtent) {
      for (let x = extent.min; x <= extent.max; x++) ops.push({ x, y, state: this.state });
    }
    return ops;
  }
}
