import { describe, expect, it } from 'vitest';
import { COMPOSITOR_LAYER_IDS, LayerStack, type CanvasLike } from '@render/layers';

function fakeCanvas(width: number, height: number): CanvasLike {
  const canvas = {
    width,
    height,
    getContext: (kind: string) =>
      kind === '2d'
        ? {
            fillStyle: '#000',
            clearRect(): void {},
            fillRect(): void {},
            setTransform(): void {},
            drawImage(): void {},
            createImageData(w: number, h: number) {
              return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
            },
            putImageData(): void {},
          }
        : null,
  };
  return canvas as unknown as CanvasLike;
}

describe('LayerStack', () => {
  it('creates exactly four layer canvases on init and never again on resize', () => {
    let created = 0;
    const stack = new LayerStack((w, h) => {
      created += 1;
      return fakeCanvas(w, h);
    });
    stack.init();
    expect(created).toBe(4);
    expect(stack.allocationCount).toBe(4);
    for (const id of COMPOSITOR_LAYER_IDS) {
      expect(stack.get(id).id).toBe(id);
    }

    expect(stack.resize(1920, 1080)).toBe(true);
    expect(created).toBe(4);
    expect(stack.allocationCount).toBe(4);
    expect(stack.width).toBe(1920);
    expect(stack.height).toBe(1080);
    expect(stack.get('cells').canvas.width).toBe(1920);
    expect(stack.get('cells').canvas.height).toBe(1080);

    expect(stack.resize(1920, 1080)).toBe(false);
    expect(created).toBe(4);

    expect(stack.resize(800, 600)).toBe(true);
    expect(created).toBe(4);
    expect(stack.allocationCount).toBe(4);
  });

  it('init is idempotent', () => {
    let created = 0;
    const stack = new LayerStack((w, h) => {
      created += 1;
      return fakeCanvas(w, h);
    });
    stack.init();
    stack.init();
    expect(created).toBe(4);
  });

  it('dispose rejects further use', () => {
    const stack = new LayerStack((w, h) => fakeCanvas(w, h));
    stack.init();
    stack.dispose();
    expect(() => stack.get('cells')).toThrow(/disposed/);
  });
});
