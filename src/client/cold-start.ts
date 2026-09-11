/**
 * Wide-shot-to-framed camera intro (P2-G-1). Cancelled by the first real input.
 */
import type { Camera, CameraAnimateOptions, Easing } from '@ui/camera';

export interface CameraPose {
  readonly originX: number;
  readonly originY: number;
  readonly cellSize: number;
}

export interface ColdStartOptions {
  readonly camera: Camera;
  readonly framed: CameraPose;
  readonly durationMs: number;
  readonly easing: Easing;
  readonly reducedMotion: boolean;
  readonly playChrome: () => void;
  readonly onCancel?: (settle: () => void) => void;
  readonly animate?: CameraAnimateOptions;
}

export function playColdStart(opts: ColdStartOptions): void {
  const applyFramed = (): void => {
    opts.camera.originX = opts.framed.originX;
    opts.camera.originY = opts.framed.originY;
    opts.camera.cellSize = opts.framed.cellSize;
  };

  if (opts.reducedMotion) {
    applyFramed();
    opts.playChrome();
    return;
  }

  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    opts.camera.cancelAnimation();
    applyFramed();
  };
  opts.onCancel?.(settle);
  opts.camera.animateTo(opts.framed, opts.durationMs, opts.easing, opts.animate);
  opts.playChrome();
}
