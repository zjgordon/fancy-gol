/**
 * The eraser: identical size/shape/density/symmetry behaviour to the brush, always painting
 * `DEAD` — implemented as a thin wrapper around `Brush` rather than a duplicate implementation.
 * `state` is deliberately not exposed: there is no way, even by mistake, to make an `Eraser`
 * paint anything other than `DEAD`.
 */
import { DEAD, type PaintOp } from '@shared/types';
import { Brush, type BrushOptions, type BrushShape, type SymmetryMode } from './brush';
import type { Tool, ToolContext } from './tool';

export type EraserOptions = Omit<BrushOptions, 'state'>;

export class Eraser implements Tool {
  readonly id = 'eraser';
  readonly cursor = 'crosshair';

  private readonly brush: Brush;

  constructor(options: EraserOptions = {}) {
    this.brush = new Brush({ ...options, state: DEAD });
  }

  get size(): number {
    return this.brush.size;
  }
  set size(value: number) {
    this.brush.size = value;
  }

  get shape(): BrushShape {
    return this.brush.shape;
  }
  set shape(value: BrushShape) {
    this.brush.shape = value;
  }

  get density(): number {
    return this.brush.density;
  }
  set density(value: number) {
    this.brush.density = value;
  }

  get symmetry(): SymmetryMode {
    return this.brush.symmetry;
  }
  set symmetry(value: SymmetryMode) {
    this.brush.symmetry = value;
  }

  onDown(ctx: ToolContext): void {
    this.brush.onDown(ctx);
  }

  onMove(ctx: ToolContext): void {
    this.brush.onMove(ctx);
  }

  onUp(ctx: ToolContext): readonly PaintOp[] {
    return this.brush.onUp(ctx);
  }

  onCancel(): void {
    this.brush.onCancel();
  }

  preview(): readonly PaintOp[] {
    return this.brush.preview();
  }
}
