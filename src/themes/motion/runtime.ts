/**
 * P3-A-6 — process-wide motion runtime. Theme activation writes the active signature here so
 * `animate(el, 'enter')` needs no ThemeRegistry at every call site.
 */
import type { MotionSignature } from '../types';
import { defaultMotionSignature } from './choreography';

export type ReducedMotionQuery = () => boolean;

const SYSTEM_REDUCED_MOTION: ReducedMotionQuery = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let activeMotion: MotionSignature = defaultMotionSignature();
let reducedMotionQuery: ReducedMotionQuery = SYSTEM_REDUCED_MOTION;

export function setMotionSignature(motion: MotionSignature): void {
  activeMotion = motion;
}

export function getMotionSignature(): MotionSignature {
  return activeMotion;
}

export function setReducedMotionQuery(query: ReducedMotionQuery): void {
  reducedMotionQuery = query;
}

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery();
}

export function resetMotionRuntime(): void {
  activeMotion = defaultMotionSignature();
  reducedMotionQuery = SYSTEM_REDUCED_MOTION;
}
