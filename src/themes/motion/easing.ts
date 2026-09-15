/**
 * P3-A-6 — hand-written easing solvers (cubic-bézier via Newton–Raphson, spring).
 *
 * No CSS / DOM here: pure functions themes and `animate()` share (No Bloat — no easing package).
 */
import type { Easing } from '../types';

const NEWTON_ITERS = 8;
const NEWTON_EPS = 1e-6;

/** Unit cubic Bézier: P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  // Sample table for an initial guess of t given x.
  const SAMPLES = 11;
  const sampleX = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    sampleX[i] = bezierX(i / (SAMPLES - 1), x1, x2);
  }

  return (tRaw: number): number => {
    const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw;
    if (t === 0 || t === 1) return t;

    // Binary-search the sample table for a starting guess.
    let lo = 0;
    let hi = SAMPLES - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sampleX[mid]! < t) lo = mid;
      else hi = mid;
    }
    const interval = (SAMPLES - 1);
    let guess = lo / interval + ((t - sampleX[lo]!) / (sampleX[hi]! - sampleX[lo]! || 1)) / interval;

    for (let i = 0; i < NEWTON_ITERS; i++) {
      const x = bezierX(guess, x1, x2) - t;
      if (Math.abs(x) < NEWTON_EPS) break;
      const dx = bezierDX(guess, x1, x2);
      if (Math.abs(dx) < 1e-12) break;
      guess -= x / dx;
    }
    guess = guess <= 0 ? 0 : guess >= 1 ? 1 : guess;
    return bezierY(guess, y1, y2);
  };
}

function bezierX(t: number, x1: number, x2: number): number {
  // 3(1-t)²t x1 + 3(1-t)t² x2 + t³
  const u = 1 - t;
  return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
}

function bezierDX(t: number, x1: number, x2: number): number {
  const u = 1 - t;
  return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2);
}

function bezierY(t: number, y1: number, y2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
}

export interface SpringOptions {
  /** Angular frequency-ish stiffness. Default 180. */
  readonly stiffness?: number;
  /** Damping coefficient. Default 20. */
  readonly damping?: number;
  /** Settling epsilon for early clamp to 1. Default 0.001. */
  readonly restEpsilon?: number;
}

/**
 * Critically-/under-damped spring from 0 → 1, evaluated over normalised time `t` in [0,1]
 * where `t=1` is treated as "long enough to have settled" (~1 s of simulated spring time).
 */
export function spring(opts: SpringOptions = {}): Easing {
  const k = opts.stiffness ?? 180;
  const c = opts.damping ?? 20;
  const eps = opts.restEpsilon ?? 0.001;
  const mass = 1;
  const w0 = Math.sqrt(k / mass);
  const zeta = c / (2 * Math.sqrt(k * mass));
  // Map unit t onto ~1 second of spring simulation.
  const totalSec = 1;

  return (tRaw: number): number => {
    if (tRaw <= 0) return 0;
    if (tRaw >= 1) return 1;
    const time = tRaw * totalSec;
    let y: number;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      const A = 1;
      const B = (zeta * w0) / wd;
      y = 1 - Math.exp(-zeta * w0 * time) * (A * Math.cos(wd * time) + B * Math.sin(wd * time));
    } else {
      y = 1 - Math.exp(-w0 * time);
    }
    if (Math.abs(1 - y) < eps) return 1;
    return y < 0 ? 0 : y > 1 ? 1 : y;
  };
}

/** Preset curves matching `TokenSet.motion.easing` CSS strings. */
export const PRESET_EASINGS = {
  linear: ((t: number) => t) as Easing,
  standard: cubicBezier(0.22, 0.61, 0.36, 1),
  decelerate: cubicBezier(0, 0, 0.2, 1),
  accelerate: cubicBezier(0.4, 0, 1, 1),
  bounce: spring({ stiffness: 220, damping: 14 }),
} as const;

/** CSS `cubic-bezier(...)` / `linear` strings for WAAPI when the easing is a named preset. */
export const PRESET_CSS_EASING: Readonly<Record<keyof typeof PRESET_EASINGS, string>> = {
  linear: 'linear',
  standard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
  // Spring has no exact CSS twin — animate() falls back to rAF for bounce.
  bounce: 'linear',
};
