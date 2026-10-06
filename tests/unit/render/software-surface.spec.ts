/**
 * P3-E-5 — the software double fails loud. `readSourcePixels` used to return a zero buffer for any
 * canvas that was not a SoftwareCanvas, so a post pass on a real `OffscreenCanvas` read black and
 * painted nothing while every unit test passed (ADR-011 amendment, ADR-012 rule 3).
 */
import { describe, expect, it } from 'vitest';
import { createSoftwareCanvas, readSourcePixels } from '@render/effects/software-surface';

describe('readSourcePixels', () => {
  it('reads a software canvas', () => {
    const canvas = createSoftwareCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 2, 2);
    const px = readSourcePixels(canvas as unknown as CanvasImageSource, 2, 2);
    expect(Array.from(px.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('throws a legible error for anything else instead of returning zeros', () => {
    const real = { width: 2, height: 2 } as unknown as CanvasImageSource;
    expect(() => readSourcePixels(real, 2, 2)).toThrow(/not a SoftwareCanvas/);
    expect(() => readSourcePixels(real, 2, 2)).toThrow(/ADR-012 rule 1/);
  });
});
