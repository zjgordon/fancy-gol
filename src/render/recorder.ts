/**
 * P0-H-3 — the "Canvas Bridge" (INCEPTION.md: "a 'headless' rendering test to ensure the engine
 * can push state to a canvas buffer without overhead"). `CanvasRecorder` is a
 * `CanvasRenderingContext2D`-shaped double: every call — including a `fillStyle` assignment —
 * is logged in order with its arguments, and it actually paints into a backing RGBA buffer (the
 * same trick `Canvas2DRenderer`'s own tests use), so a test can assert on both the call log and
 * the resulting pixels.
 *
 * `bufferAllocations` counts calls that would allocate a real pixel buffer on a genuine canvas
 * (`createImageData`) — the render path's own allocation signal, wrapped at exactly the
 * accessor that does the allocating, distinct from (and a sharper signal than) a heap-growth
 * measurement.
 */
import { parseColor } from './canvas2d';

export type RecordedCall =
  | { readonly method: 'fillStyle'; readonly args: readonly [value: string] }
  | { readonly method: 'fillRect'; readonly args: readonly [x: number, y: number, w: number, h: number] }
  | { readonly method: 'createImageData'; readonly args: readonly [w: number, h: number] }
  | { readonly method: 'putImageData'; readonly args: readonly [x: number, y: number, w: number, h: number] };

export class CanvasRecorder {
  readonly calls: RecordedCall[] = [];
  bufferAllocations = 0;
  private readonly pixels: Uint8ClampedArray;
  private _fillStyle = '#000000';

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4);
  }

  get fillStyle(): string {
    return this._fillStyle;
  }

  set fillStyle(value: string) {
    this._fillStyle = value;
    this.calls.push({ method: 'fillStyle', args: [value] });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'fillRect', args: [x, y, w, h] });
    this.paint(x, y, w, h, parseColor(this._fillStyle));
  }

  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    this.bufferAllocations += 1;
    this.calls.push({ method: 'createImageData', args: [w, h] });
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4) };
  }

  putImageData(image: { width: number; height: number; data: Uint8ClampedArray }, dx: number, dy: number): void {
    this.calls.push({ method: 'putImageData', args: [dx, dy, image.width, image.height] });
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const px = dx + x;
        const py = dy + y;
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
        const srcIdx = (y * image.width + x) * 4;
        const dstIdx = (py * this.width + px) * 4;
        this.pixels[dstIdx] = image.data[srcIdx]!;
        this.pixels[dstIdx + 1] = image.data[srcIdx + 1]!;
        this.pixels[dstIdx + 2] = image.data[srcIdx + 2]!;
        this.pixels[dstIdx + 3] = image.data[srcIdx + 3]!;
      }
    }
  }

  pixelAt(x: number, y: number): readonly [number, number, number, number] {
    const idx = (y * this.width + x) * 4;
    return [this.pixels[idx]!, this.pixels[idx + 1]!, this.pixels[idx + 2]!, this.pixels[idx + 3]!];
  }

  /** Clears the log and allocation count for the next frame — the pixel buffer is left alone (a real canvas persists across frames too). */
  resetLog(): void {
    this.calls.length = 0;
    this.bufferAllocations = 0;
  }

  private paint(x: number, y: number, w: number, h: number, color: readonly [number, number, number, number]): void {
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const idx = (yy * this.width + xx) * 4;
        this.pixels[idx] = color[0];
        this.pixels[idx + 1] = color[1];
        this.pixels[idx + 2] = color[2];
        this.pixels[idx + 3] = color[3];
      }
    }
  }
}
