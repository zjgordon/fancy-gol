import { describe, expect, it } from 'vitest';
import { CanvasRecorder } from '@render/recorder';

describe('CanvasRecorder', () => {
  it('logs a fillStyle assignment and each fillRect, and paints into the backing buffer', () => {
    const rec = new CanvasRecorder(8, 8);
    rec.fillStyle = '#ff0000';
    rec.fillRect(0, 0, 4, 4);

    expect(rec.fillStyle).toBe('#ff0000');
    expect(rec.calls).toEqual([
      { method: 'fillStyle', args: ['#ff0000'] },
      { method: 'fillRect', args: [0, 0, 4, 4] },
    ]);
    expect(rec.pixelAt(1, 1)).toEqual([255, 0, 0, 255]);
    expect(rec.pixelAt(5, 5)).toEqual([0, 0, 0, 0]); // untouched
  });

  it('clips fillRect to the canvas bounds', () => {
    const rec = new CanvasRecorder(4, 4);
    rec.fillStyle = '#00ff00';
    rec.fillRect(-2, -2, 4, 4); // half off the top-left edge
    expect(rec.pixelAt(0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('createImageData counts a buffer allocation, logs the call, and returns a writable buffer', () => {
    const rec = new CanvasRecorder(8, 8);
    const image = rec.createImageData(2, 2);
    expect(rec.bufferAllocations).toBe(1);
    expect(rec.calls).toContainEqual({ method: 'createImageData', args: [2, 2] });
    expect(image.data.length).toBe(2 * 2 * 4);
  });

  it('putImageData blits the buffer into the canvas, logs the call, and clips to canvas bounds', () => {
    const rec = new CanvasRecorder(4, 4);
    const image = rec.createImageData(2, 2);
    image.data.set([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    rec.putImageData(image, 1, 1);

    expect(rec.calls).toContainEqual({ method: 'putImageData', args: [1, 1, 2, 2] });
    expect(rec.pixelAt(1, 1)).toEqual([10, 20, 30, 255]);
    expect(rec.pixelAt(2, 2)).toEqual([100, 110, 120, 255]);

    // Off-canvas: nothing throws, nothing outside bounds is written.
    expect(() => rec.putImageData(image, -5, -5)).not.toThrow();
  });

  it('resetLog clears the call log and allocation count but leaves the painted pixels alone', () => {
    const rec = new CanvasRecorder(4, 4);
    rec.fillStyle = '#ffffff';
    rec.fillRect(0, 0, 4, 4);
    rec.createImageData(1, 1);

    rec.resetLog();

    expect(rec.calls).toEqual([]);
    expect(rec.bufferAllocations).toBe(0);
    expect(rec.pixelAt(0, 0)).toEqual([255, 255, 255, 255]); // still painted from before
  });
});
