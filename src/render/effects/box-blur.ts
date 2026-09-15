/**
 * P3-A-5 — separable box blur on a packed RGBA buffer (half-res bloom path).
 * Radius is in pixels; each pass is horizontal then vertical. No heap alloc in steady state
 * when `tmp` is the same length as `src`.
 */
export function boxBlurSeparable(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  tmp: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) {
    dst.set(src);
    return;
  }
  const w = width;
  const h = height;
  blurAxis(src, tmp, w, h, r, true);
  blurAxis(tmp, dst, w, h, r, false);
}

function blurAxis(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
): void {
  const diam = r * 2 + 1;
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const x = clamp(k, 0, w - 1);
          sum += src[(y * w + x) * 4 + c]!;
        }
        for (let x = 0; x < w; x++) {
          dst[(y * w + x) * 4 + c] = (sum / diam) | 0;
          const leave = clamp(x - r, 0, w - 1);
          const enter = clamp(x + r + 1, 0, w - 1);
          sum += src[(y * w + enter) * 4 + c]! - src[(y * w + leave) * 4 + c]!;
        }
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const y = clamp(k, 0, h - 1);
          sum += src[(y * w + x) * 4 + c]!;
        }
        for (let y = 0; y < h; y++) {
          dst[(y * w + x) * 4 + c] = (sum / diam) | 0;
          const leave = clamp(y - r, 0, h - 1);
          const enter = clamp(y + r + 1, 0, h - 1);
          sum += src[(enter * w + x) * 4 + c]! - src[(leave * w + x) * 4 + c]!;
        }
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Nearest-neighbour downsample into a preallocated buffer. */
export function downsampleNearest(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
): void {
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, ((y * srcH) / dstH) | 0);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, ((x * srcW) / dstW) | 0);
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      dst[di] = src[si]!;
      dst[di + 1] = src[si + 1]!;
      dst[di + 2] = src[si + 2]!;
      dst[di + 3] = src[si + 3]!;
    }
  }
}

/** Nearest-neighbour upsample, additive-blend into `dst` (bloom add). */
export function upsampleAdd(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  strength: number,
): void {
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, ((y * srcH) / dstH) | 0);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, ((x * srcW) / dstW) | 0);
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      dst[di] = Math.min(255, dst[di]! + ((src[si]! * strength) | 0));
      dst[di + 1] = Math.min(255, dst[di + 1]! + ((src[si + 1]! * strength) | 0));
      dst[di + 2] = Math.min(255, dst[di + 2]! + ((src[si + 2]! * strength) | 0));
      // leave alpha
    }
  }
}
