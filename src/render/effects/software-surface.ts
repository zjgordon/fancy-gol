/**
 * P3-A-5 — software canvas / 2D context for effect offscreens and jsdom tests.
 *
 * Real `HTMLCanvasElement` in jsdom cannot getImageData; passes and tests share this double so
 * pixel hashes stay deterministic without a native canvas dependency (No Bloat).
 */
import { parseColor } from '../canvas2d';

export const SOFTWARE_SURFACE = Symbol.for('fancy-gol.softwareSurface');

export interface SoftwareCanvas {
  width: number;
  height: number;
  readonly [SOFTWARE_SURFACE]: SoftwareSurface;
  getContext(kind: '2d'): SoftwareContext;
  getContext(kind: string): SoftwareContext | null;
}

export class SoftwareSurface {
  private _width: number;
  private _height: number;
  pixels: Uint8ClampedArray;
  readonly canvas: SoftwareCanvas;
  readonly ctx: SoftwareContext;

  constructor(width: number, height: number) {
    this._width = Math.max(1, width | 0);
    this._height = Math.max(1, height | 0);
    this.pixels = new Uint8ClampedArray(this._width * this._height * 4);
    this.ctx = new SoftwareContext(this);
    this.canvas = makeSoftwareCanvasFacade(this);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (w === this._width && h === this._height) return;
    this._width = w;
    this._height = h;
    this.pixels = new Uint8ClampedArray(w * h * 4);
  }

  clear(): void {
    this.pixels.fill(0);
  }
}

export class SoftwareContext {
  fillStyle: string | CanvasGradient = '#000000';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  private readonly stack: { fillStyle: string | CanvasGradient; globalAlpha: number }[] = [];

  constructor(readonly surface: SoftwareSurface) {}

  get canvas(): SoftwareCanvas {
    return this.surface.canvas;
  }

  save(): void {
    this.stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.fillStyle = s.fillStyle;
    this.globalAlpha = s.globalAlpha;
  }

  setTransform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number): void {
    // Identity-only software path — effect passes use pixel buffers, not CTM.
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.surface.width, Math.ceil(x + w));
    const y1 = Math.min(this.surface.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.surface.width + xx) * 4;
        this.surface.pixels[i] = 0;
        this.surface.pixels[i + 1] = 0;
        this.surface.pixels[i + 2] = 0;
        this.surface.pixels[i + 3] = 0;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const color = this.resolveFill();
    const a = (color[3] / 255) * this.globalAlpha;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.surface.width, Math.ceil(x + w));
    const y1 = Math.min(this.surface.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.surface.width + xx) * 4;
        if (a >= 0.999) {
          this.surface.pixels[i] = color[0]!;
          this.surface.pixels[i + 1] = color[1]!;
          this.surface.pixels[i + 2] = color[2]!;
          this.surface.pixels[i + 3] = color[3]!;
        } else {
          const oa = this.surface.pixels[i + 3]! / 255;
          const na = a + oa * (1 - a);
          if (na <= 0) continue;
          this.surface.pixels[i] =
            ((color[0] * a + this.surface.pixels[i]! * oa * (1 - a)) / na) | 0;
          this.surface.pixels[i + 1] =
            ((color[1] * a + this.surface.pixels[i + 1]! * oa * (1 - a)) / na) | 0;
          this.surface.pixels[i + 2] =
            ((color[2] * a + this.surface.pixels[i + 2]! * oa * (1 - a)) / na) | 0;
          this.surface.pixels[i + 3] = (na * 255) | 0;
        }
      }
    }
  }

  createImageData(w: number, h: number): ImageData {
    return {
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
      colorSpace: 'srgb',
    };
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
    const x0 = Math.max(0, Math.floor(sx));
    const y0 = Math.max(0, Math.floor(sy));
    const w = Math.max(1, Math.floor(sw));
    const h = Math.max(1, Math.floor(sh));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x0 + x;
        const py = y0 + y;
        const di = (y * w + x) * 4;
        if (px < 0 || py < 0 || px >= this.surface.width || py >= this.surface.height) continue;
        const si = (py * this.surface.width + px) * 4;
        data[di] = this.surface.pixels[si]!;
        data[di + 1] = this.surface.pixels[si + 1]!;
        data[di + 2] = this.surface.pixels[si + 2]!;
        data[di + 3] = this.surface.pixels[si + 3]!;
      }
    }
    return { width: w, height: h, data, colorSpace: 'srgb' };
  }

  putImageData(image: ImageData, dx: number, dy: number): void {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const px = (dx | 0) + x;
        const py = (dy | 0) + y;
        if (px < 0 || py < 0 || px >= this.surface.width || py >= this.surface.height) continue;
        const si = (y * image.width + x) * 4;
        const di = (py * this.surface.width + px) * 4;
        this.surface.pixels[di] = image.data[si]!;
        this.surface.pixels[di + 1] = image.data[si + 1]!;
        this.surface.pixels[di + 2] = image.data[si + 2]!;
        this.surface.pixels[di + 3] = image.data[si + 3]!;
      }
    }
  }

  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(
    image: CanvasImageSource,
    ax: number,
    ay: number,
    aw?: number,
    ah?: number,
    dx?: number,
    dy?: number,
    dw?: number,
    dh?: number,
  ): void {
    const src = asSoftware(image);
    if (!src) return;
    if (aw === undefined || ah === undefined) {
      this.blit(src, 0, 0, src.width, src.height, ax, ay, src.width, src.height);
      return;
    }
    if (dx === undefined || dy === undefined || dw === undefined || dh === undefined) {
      this.blit(src, 0, 0, src.width, src.height, ax, ay, aw, ah);
      return;
    }
    this.blit(src, ax, ay, aw, ah, dx, dy, dw, dh);
  }

  createLinearGradient(_x0: number, _y0: number, _x1: number, _y1: number): CanvasGradient {
    return { addColorStop(): void {} };
  }

  private blit(
    src: SoftwareSurface,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    for (let y = 0; y < dh; y++) {
      const srcY = sy + ((y * sh) / dh) | 0;
      for (let x = 0; x < dw; x++) {
        const srcX = sx + ((x * sw) / dw) | 0;
        if (srcX < 0 || srcY < 0 || srcX >= src.width || srcY >= src.height) continue;
        const px = dx + x;
        const py = dy + y;
        if (px < 0 || py < 0 || px >= this.surface.width || py >= this.surface.height) continue;
        const si = (srcY * src.width + srcX) * 4;
        const di = (py * this.surface.width + px) * 4;
        const sa = (src.pixels[si + 3]! / 255) * this.globalAlpha;
        if (sa <= 0) continue;
        if (sa >= 0.999) {
          this.surface.pixels[di] = src.pixels[si]!;
          this.surface.pixels[di + 1] = src.pixels[si + 1]!;
          this.surface.pixels[di + 2] = src.pixels[si + 2]!;
          this.surface.pixels[di + 3] = src.pixels[si + 3]!;
        } else {
          const oa = this.surface.pixels[di + 3]! / 255;
          const na = sa + oa * (1 - sa);
          this.surface.pixels[di] =
            ((src.pixels[si]! * sa + this.surface.pixels[di]! * oa * (1 - sa)) / na) | 0;
          this.surface.pixels[di + 1] =
            ((src.pixels[si + 1]! * sa + this.surface.pixels[di + 1]! * oa * (1 - sa)) / na) | 0;
          this.surface.pixels[di + 2] =
            ((src.pixels[si + 2]! * sa + this.surface.pixels[di + 2]! * oa * (1 - sa)) / na) | 0;
          this.surface.pixels[di + 3] = (na * 255) | 0;
        }
      }
    }
  }

  private resolveFill(): readonly [number, number, number, number] {
    if (typeof this.fillStyle === 'string') return parseColor(this.fillStyle);
    return [128, 128, 128, 255];
  }
}

export function createSoftwareCanvas(width: number, height: number): SoftwareCanvas {
  return new SoftwareSurface(width, height).canvas;
}

function makeSoftwareCanvasFacade(surface: SoftwareSurface): SoftwareCanvas {
  return {
    get width() {
      return surface.width;
    },
    set width(next: number) {
      surface.resize(next, surface.height);
    },
    get height() {
      return surface.height;
    },
    set height(next: number) {
      surface.resize(surface.width, next);
    },
    [SOFTWARE_SURFACE]: surface,
    getContext: ((kind: string) => (kind === '2d' ? surface.ctx : null)) as SoftwareCanvas['getContext'],
  };
}

export function asSoftware(source: CanvasImageSource | SoftwareCanvas): SoftwareSurface | null {
  if (source && typeof source === 'object' && SOFTWARE_SURFACE in source) {
    return (source)[SOFTWARE_SURFACE];
  }
  return null;
}

/** Read RGBA from a software canvas (empty buffer when the source is not software-backed). */
export function readSourcePixels(
  source: CanvasImageSource,
  width: number,
  height: number,
): Uint8ClampedArray {
  const soft = asSoftware(source);
  if (soft) {
    if (soft.width === width && soft.height === height) {
      return soft.pixels.slice();
    }
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const sy = Math.min(soft.height - 1, ((y * soft.height) / height) | 0);
      for (let x = 0; x < width; x++) {
        const sx = Math.min(soft.width - 1, ((x * soft.width) / width) | 0);
        const si = (sy * soft.width + sx) * 4;
        const di = (y * width + x) * 4;
        out[di] = soft.pixels[si]!;
        out[di + 1] = soft.pixels[si + 1]!;
        out[di + 2] = soft.pixels[si + 2]!;
        out[di + 3] = soft.pixels[si + 3]!;
      }
    }
    return out;
  }
  return new Uint8ClampedArray(width * height * 4);
}

export function writeTargetPixels(
  target: { canvas?: CanvasImageSource; putImageData?(image: ImageData, dx: number, dy: number): void },
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const soft = target.canvas ? asSoftware(target.canvas) : null;
  if (soft && soft.pixels.length === pixels.length) {
    soft.pixels.set(pixels);
    return;
  }
  if (typeof target.putImageData === 'function') {
    target.putImageData({ width, height, data: pixels, colorSpace: 'srgb' } as ImageData, 0, 0);
  }
}
