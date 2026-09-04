/**
 * The brush: size 1–64, three footprint shapes, adjustable spray density (seeded, so a given
 * seed reproduces the same speckle pattern), six symmetry modes, and Bresenham interpolation
 * between move samples so a fast drag never "dots". Paints whatever `StateId` the caller sets —
 * the colour-swatch row that lets a person pick one from the ruleset's palette is a DOM
 * component, out of this task's file scope; this class only ever needs the chosen id.
 *
 * The seeded PRNG below is a small hand-written *duplicate* of `engine/rng.ts`'s Mulberry32,
 * not a re-export or import: ADR-009's layering forbids `ui/` from reaching into `engine/` at
 * all. `shared/types.ts` documents the same treatment for its own independently-defined
 * chunk-coordinate maths — this is that same deliberate exception, not an oversight.
 */
import { type PaintOp, type StateId } from '@shared/types';
import type { Tool, ToolContext } from './tool';

export type BrushShape = 'square' | 'circle' | 'diamond';
export type SymmetryMode = 'none' | 'mirror-x' | 'mirror-y' | 'quad' | 'rotate-4' | 'rotate-8';

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 64;

export interface BrushOptions {
  readonly size?: number;
  readonly shape?: BrushShape;
  readonly state?: StateId;
  /** (0, 1]. 1 = solid fill. Below 1, each candidate cell is a coin-flip (seeded). */
  readonly density?: number;
  readonly symmetry?: SymmetryMode;
  /** World-coordinate centre symmetry mirrors/rotates around. Defaults to the origin. */
  readonly center?: { readonly x: number; readonly y: number };
  readonly seed?: number;
}

/** Hand-written Mulberry32 duplicate — see the module doc for why this isn't an import. */
class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

function clampSize(size: number): number {
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(size)));
}

/** `r` is a half-diameter (`size / 2`), so this scales smoothly across the whole size range. */
function inFootprint(shape: BrushShape, dx: number, dy: number, r: number): boolean {
  switch (shape) {
    case 'square':
      return Math.max(Math.abs(dx), Math.abs(dy)) < r;
    case 'circle':
      return Math.sqrt(dx * dx + dy * dy) < r;
    case 'diamond':
      return Math.abs(dx) + Math.abs(dy) < r;
  }
}

/**
 * The dihedral-group transforms for each symmetry mode, applied to an offset from the symmetry
 * centre. Callers deduplicate the results — a point on a mirror axis (or the diagonal, for
 * `rotate-8`) legitimately maps to itself under more than one transform.
 */
function symmetryOffsets(mode: SymmetryMode, dx: number, dy: number): ReadonlyArray<readonly [number, number]> {
  switch (mode) {
    case 'none':
      return [[dx, dy]];
    case 'mirror-x':
      return [
        [dx, dy],
        [dx, -dy],
      ];
    case 'mirror-y':
      return [
        [dx, dy],
        [-dx, dy],
      ];
    case 'quad':
      return [
        [dx, dy],
        [-dx, dy],
        [dx, -dy],
        [-dx, -dy],
      ];
    case 'rotate-4':
      return [
        [dx, dy],
        [-dy, dx],
        [-dx, -dy],
        [dy, -dx],
      ];
    case 'rotate-8':
      return [
        [dx, dy],
        [-dx, dy],
        [dx, -dy],
        [-dx, -dy],
        [dy, dx],
        [-dy, dx],
        [dy, -dx],
        [-dy, -dx],
      ];
  }
}

/**
 * Classic integer Bresenham — every cell from `(x0,y0)` to `(x1,y1)`, inclusive, none skipped.
 * Exported for reuse by `line.ts` (P1-B-4) rather than a second hand-written copy — both live in
 * the same `ui/` layer, so this is an ordinary import, not the ADR-009 boundary duplication the
 * PRNG above needed.
 */
export function bresenham(x0: number, y0: number, x1: number, y1: number): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/**
 * Same packing `shared/types.ts`'s `ChangeSet.coords` documents — a shared convention, not a
 * shared import. Exported for reuse by the other `ui/tools/*` shape tools (P1-B-4).
 */
export function packXY(x: number, y: number): number {
  return (x << 16) | (y & 0xffff);
}

export class Brush implements Tool {
  readonly id: string = 'brush';
  readonly cursor = 'crosshair';

  size: number;
  shape: BrushShape;
  state: StateId;
  density: number;
  symmetry: SymmetryMode;
  center: { x: number; y: number };

  private readonly rng: Rng;
  private painted = new Map<number, PaintOp>();
  private lastCell: { x: number; y: number } | null = null;

  constructor(options: BrushOptions = {}) {
    this.size = clampSize(options.size ?? 1);
    this.shape = options.shape ?? 'circle';
    this.state = options.state ?? 1;
    this.density = options.density ?? 1;
    this.symmetry = options.symmetry ?? 'none';
    this.center = { x: options.center?.x ?? 0, y: options.center?.y ?? 0 };
    this.rng = new Rng(options.seed ?? 0x9e3779b9);
  }

  onDown(ctx: ToolContext): void {
    this.painted = new Map();
    const cell = { x: Math.round(ctx.event.point.x), y: Math.round(ctx.event.point.y) };
    this.stampAt(cell.x, cell.y);
    this.lastCell = cell;
  }

  onMove(ctx: ToolContext): void {
    if (!this.lastCell) return;
    for (const p of ctx.event.coalesced) {
      const cell = { x: Math.round(p.x), y: Math.round(p.y) };
      for (const [x, y] of bresenham(this.lastCell.x, this.lastCell.y, cell.x, cell.y)) {
        this.stampAt(x, y);
      }
      this.lastCell = cell;
    }
  }

  onUp(_ctx: ToolContext): readonly PaintOp[] {
    const ops = [...this.painted.values()];
    this.painted = new Map();
    this.lastCell = null;
    return ops;
  }

  onCancel(): void {
    this.painted = new Map();
    this.lastCell = null;
  }

  preview(): readonly PaintOp[] {
    return [...this.painted.values()];
  }

  private stampAt(cx: number, cy: number): void {
    const r = this.size / 2;
    const bound = Math.ceil(r);
    for (let dx = -bound; dx <= bound; dx++) {
      for (let dy = -bound; dy <= bound; dy++) {
        if (!inFootprint(this.shape, dx, dy, r)) continue;
        if (this.density < 1 && this.rng.next() >= this.density) continue;
        const relX = cx + dx - this.center.x;
        const relY = cy + dy - this.center.y;
        for (const [sx, sy] of symmetryOffsets(this.symmetry, relX, relY)) {
          const x = this.center.x + sx;
          const y = this.center.y + sy;
          const key = packXY(x, y);
          if (!this.painted.has(key)) this.painted.set(key, { x, y, state: this.state });
        }
      }
    }
  }
}
