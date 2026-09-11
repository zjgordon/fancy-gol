import { describe, expect, it } from 'vitest';
import { Camera, type FrameScheduler } from '@ui/camera';
import { playColdStart } from '@client/cold-start';

class IdleScheduler implements FrameScheduler {
  request(): number {
    return 1;
  }
  cancel(): void {}
}

describe('playColdStart', () => {
  it('snaps to the framed pose under reduced motion and still plays chrome', () => {
    const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
    let chrome = 0;
    playColdStart({
      camera,
      framed: { originX: 12, originY: 8, cellSize: 16 },
      durationMs: 1200,
      easing: (t) => t,
      reducedMotion: true,
      playChrome: () => {
        chrome += 1;
      },
    });
    expect(camera.originX).toBe(12);
    expect(camera.originY).toBe(8);
    expect(camera.cellSize).toBe(16);
    expect(chrome).toBe(1);
  });

  it('animates when motion is allowed and the first cancel settles the pose', () => {
    const camera = new Camera({ widthPx: 800, heightPx: 600, originX: 0, originY: 0, cellSize: 4 });
    let settle: (() => void) | undefined;
    playColdStart({
      camera,
      framed: { originX: 3, originY: 5, cellSize: 10 },
      durationMs: 1200,
      easing: (t) => t,
      reducedMotion: false,
      playChrome: () => {},
      animate: { scheduler: new IdleScheduler() },
      onCancel: (fn) => {
        settle = fn;
      },
    });
    expect(settle).toBeDefined();
    settle?.();
    settle?.();
    expect(camera.originX).toBe(3);
    expect(camera.cellSize).toBe(10);
  });
});
