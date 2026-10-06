/**
 * P3-E-2 — a canvas double that records *what is drawn and with which composite mode*.
 *
 * ADR-012 rule 3: unit tests prove structure, the browser proves pixels. `SoftwareSurface` lets a
 * test read pixels back, which is exactly how the per-texel passes passed every unit test while
 * painting nothing in Chromium. This double deliberately has no pixels to read. It logs each draw
 * with the composite operation and alpha in force, so a test can assert "bloom adds the ¼-size
 * glow with `lighter`" without ever claiming what that looks like.
 */
import { vi } from 'vitest';
import type { CanvasFactory } from '@render/layers';

export interface DrawOp {
  readonly kind:
    | 'drawImage'
    | 'fillRect'
    | 'clearRect'
    | 'putImageData'
    | 'fill'
    | 'stroke'
    | 'moveTo'
    | 'lineTo'
    | 'translate'
    | 'save'
    | 'restore';
  readonly composite: string;
  readonly alpha: number;
  /** For `drawImage`: the source canvas id. For `fillRect`: what the fill style is. */
  readonly detail?: string;
  /** Numeric arguments, as passed. */
  readonly args?: readonly number[];
}

export interface FakeGradient {
  readonly kind: 'gradient';
  readonly shape: 'linear' | 'radial';
  readonly coords: readonly number[];
  readonly stops: { offset: number; color: string }[];
  addColorStop(offset: number, color: string): void;
}

export interface FakePattern {
  readonly kind: 'pattern';
  readonly source: RecordingCanvas;
}

let nextId = 1;

export class RecordingContext {
  readonly ops: DrawOp[] = [];
  globalCompositeOperation = 'source-over';
  globalAlpha = 1;
  imageSmoothingEnabled = true;
  fillStyle: string | FakeGradient | FakePattern = '#000000';
  readonly gradients: FakeGradient[] = [];
  /** How many times `createImageData` ran — a per-frame pass must never call it. */
  imageDataAllocations = 0;
  /** Bytes handed to each `putImageData`, in order (tile bakes). */
  readonly imageData: Uint8ClampedArray[] = [];
  private readonly stack: { composite: string; alpha: number; fillStyle: RecordingContext['fillStyle'] }[] = [];

  constructor(readonly canvas: RecordingCanvas) {}

  private push(op: Omit<DrawOp, 'composite' | 'alpha'>): void {
    this.ops.push({ ...op, composite: this.globalCompositeOperation, alpha: this.globalAlpha });
  }

  save(): void {
    this.stack.push({
      composite: this.globalCompositeOperation,
      alpha: this.globalAlpha,
      fillStyle: this.fillStyle,
    });
    this.push({ kind: 'save' });
  }

  restore(): void {
    const s = this.stack.pop();
    if (s) {
      this.globalCompositeOperation = s.composite;
      this.globalAlpha = s.alpha;
      this.fillStyle = s.fillStyle;
    }
    this.push({ kind: 'restore' });
  }

  translate(x: number, y: number): void {
    this.push({ kind: 'translate', args: [x, y] });
  }

  setTransform(): void {}

  clearRect(x: number, y: number, w: number, h: number): void {
    this.push({ kind: 'clearRect', args: [x, y, w, h] });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const style = this.fillStyle;
    const detail = typeof style === 'string' ? style : style.kind === 'gradient' ? `gradient:${style.shape}` : 'pattern';
    this.push({ kind: 'fillRect', detail, args: [x, y, w, h] });
  }

  drawImage(source: unknown, ...args: number[]): void {
    const id = source instanceof RecordingCanvas ? source.id : 'external';
    this.push({ kind: 'drawImage', detail: id, args });
  }

  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    this.imageDataAllocations += 1;
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  putImageData(image: { data: Uint8ClampedArray }): void {
    this.imageData.push(image.data.slice());
    this.push({ kind: 'putImageData' });
  }

  createPattern(source: RecordingCanvas): FakePattern {
    return { kind: 'pattern', source };
  }

  private gradient(shape: 'linear' | 'radial', coords: number[]): FakeGradient {
    const stops: FakeGradient['stops'] = [];
    const g: FakeGradient = {
      kind: 'gradient',
      shape,
      coords,
      stops,
      addColorStop: (offset, color) => void stops.push({ offset, color }),
    };
    this.gradients.push(g);
    return g;
  }

  createLinearGradient(...c: number[]): FakeGradient {
    return this.gradient('linear', c);
  }

  createRadialGradient(...c: number[]): FakeGradient {
    return this.gradient('radial', c);
  }

  strokeStyle: string | FakeGradient | FakePattern = '#000000';
  lineWidth = 1;
  beginPath(): void {}
  moveTo(x: number, y: number): void {
    this.push({ kind: 'moveTo', args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.push({ kind: 'lineTo', args: [x, y] });
  }
  rect(): void {}
  roundRect(): void {}

  stroke(): void {
    this.push({ kind: 'stroke' });
  }

  fill(): void {
    this.push({ kind: 'fill' });
  }

  /** Only the ops of one kind, for terse assertions. */
  only(kind: DrawOp['kind']): DrawOp[] {
    return this.ops.filter((o) => o.kind === kind);
  }
}

export class RecordingCanvas {
  readonly id = `c${nextId++}`;
  readonly ctx: RecordingContext;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.ctx = new RecordingContext(this);
  }

  getContext(kind: string): RecordingContext | null {
    return kind === '2d' ? this.ctx : null;
  }
}

/** A canvas factory that remembers every canvas it made, and which of them were released. */
export function recordingFactory(): { factory: CanvasFactory; canvases: RecordingCanvas[]; live(): number } {
  const canvases: RecordingCanvas[] = [];
  const factory: CanvasFactory = (w, h) => {
    const canvas = new RecordingCanvas(w, h);
    canvases.push(canvas);
    return canvas as unknown as ReturnType<CanvasFactory>;
  };
  return {
    factory,
    canvases,
    /** Canvases that still hold a backing store (a released one is 0×0). */
    live: () => canvases.filter((c) => c.width > 0 && c.height > 0).length,
  };
}

/**
 * Give code that builds canvases through `defaultCanvasFactory` an `OffscreenCanvas` to bake into.
 * jsdom has none, and composited passes (ADR-012) bake their tiles and mips at activation. Call in
 * `beforeAll`; pair with `vi.unstubAllGlobals()` in `afterAll`. Returns the canvases created, so a
 * leak test can count how many still hold a backing store (a released canvas is 0×0).
 */
export function stubOffscreenCanvas(): { canvases: RecordingCanvas[]; live(): number } {
  const canvases: RecordingCanvas[] = [];
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(w: number, h: number) {
        const canvas = new RecordingCanvas(w, h);
        canvases.push(canvas);
        return canvas;
      }
    },
  );
  return { canvases, live: () => canvases.filter((c) => c.width > 0 && c.height > 0).length };
}
