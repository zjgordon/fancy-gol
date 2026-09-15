/**
 * P3-A-6 — `animate(el, kind)`: Web Animations API when available, rAF otherwise.
 *
 * Never reads layout properties (`offsetHeight`, `getBoundingClientRect`, …) — WAAPI / style
 * writes only, so 100 transitions cannot force a reflow thrash (P3-A-6 AC).
 */
import type { Easing, MotionSignature } from '../types';
import type { Choreography, ChoreographyKind, MotionKeyframe } from './choreography';
import { PRESET_CSS_EASING, PRESET_EASINGS } from './easing';
import { getMotionSignature, prefersReducedMotion } from './runtime';

export interface AnimateOptions {
  readonly motion?: MotionSignature;
  readonly reducedMotion?: boolean;
  /** Extra delay before the choreography starts (shell stagger). */
  readonly delayMs?: number;
  /** Abort in-flight work (intro cancel). */
  readonly signal?: AbortSignal;
}

export interface AnimateHandle {
  readonly finished: Promise<void>;
  cancel(): void;
}

function choreographyFor(motion: MotionSignature, kind: ChoreographyKind): Choreography {
  return motion[kind];
}

function toWaapiKeyframes(frames: readonly MotionKeyframe[]): Keyframe[] {
  return frames.map((f) => {
    const kf: Keyframe = { offset: f.offset };
    if (f.opacity !== undefined) kf['opacity'] = String(f.opacity);
    if (f.transform !== undefined) kf['transform'] = f.transform;
    return kf;
  });
}

function applyFrame(el: HTMLElement, frame: MotionKeyframe): void {
  if (frame.opacity !== undefined) el.style.opacity = String(frame.opacity);
  if (frame.transform !== undefined) el.style.transform = frame.transform;
}

function lastFrame(frames: readonly MotionKeyframe[]): MotionKeyframe {
  return frames[frames.length - 1] ?? { offset: 1, opacity: 1, transform: 'none' };
}

function interpolateFrames(frames: readonly MotionKeyframe[], u: number): MotionKeyframe {
  if (frames.length === 0) return { offset: u };
  if (u <= (frames[0]?.offset ?? 0)) return frames[0]!;
  const last = frames[frames.length - 1]!;
  if (u >= last.offset) return last;
  let i = 1;
  while (i < frames.length && (frames[i]?.offset ?? 1) < u) i += 1;
  const a = frames[i - 1]!;
  const b = frames[i]!;
  const span = b.offset - a.offset || 1;
  const local = (u - a.offset) / span;
  const mix = (x: number | undefined, y: number | undefined): number | undefined => {
    if (x === undefined && y === undefined) return undefined;
    if (x === undefined) return y;
    if (y === undefined) return x;
    return x + (y - x) * local;
  };
  const transform = local < 0.5 ? a.transform : b.transform;
  const out: MotionKeyframe = { offset: u };
  const opacity = mix(a.opacity, b.opacity);
  if (opacity !== undefined) (out as { opacity: number }).opacity = opacity;
  if (transform !== undefined) (out as { transform: string }).transform = transform;
  return out;
}

function runRaf(
  el: HTMLElement,
  frames: readonly MotionKeyframe[],
  durationMs: number,
  easing: Easing,
  delayMs: number,
  signal: AbortSignal | undefined,
): AnimateHandle {
  let raf = 0;
  let delayHandle = 0;
  let settled = false;
  let resolve!: () => void;
  const finished = new Promise<void>((r) => {
    resolve = r;
  });

  const finish = (applyEnd: boolean): void => {
    if (settled) return;
    settled = true;
    if (raf) cancelAnimationFrame(raf);
    if (delayHandle) clearTimeout(delayHandle);
    if (applyEnd) applyFrame(el, lastFrame(frames));
    resolve();
  };

  const onAbort = (): void => finish(true);
  signal?.addEventListener('abort', onAbort, { once: true });

  const start = (): void => {
    if (settled) return;
    if (durationMs <= 0) {
      finish(true);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number): void => {
      if (settled) return;
      const raw = (now - t0) / durationMs;
      const u = raw >= 1 ? 1 : easing(raw);
      applyFrame(el, interpolateFrames(frames, u));
      if (raw >= 1) {
        finish(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  if (delayMs > 0) delayHandle = setTimeout(start, delayMs) as unknown as number;
  else start();

  return {
    finished,
    cancel(): void {
      finish(true);
    },
  };
}

/**
 * Play a theme choreography on `el`. Under reduced motion (or duration `instant`) snaps to the
 * final keyframe with no animation — no exceptions.
 */
export function animate(
  el: Element,
  kind: ChoreographyKind,
  options: AnimateOptions = {},
): AnimateHandle {
  const html = el as HTMLElement;
  const motion = options.motion ?? getMotionSignature();
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const choreo = choreographyFor(motion, kind);
  const delayMs = options.delayMs ?? 0;
  const durationMs = reduced ? 0 : motion.durationMs[choreo.durationKey];
  const frames = choreo.keyframes;

  if (durationMs <= 0 || frames.length === 0) {
    applyFrame(html, lastFrame(frames));
    return {
      finished: Promise.resolve(),
      cancel(): void {},
    };
  }

  const easingFn = motion.easings[choreo.easingKey] ?? PRESET_EASINGS.standard;
  const useWaapi =
    typeof html.animate === 'function' && choreo.easingKey !== 'bounce' && delayMs === 0;

  if (useWaapi) {
    let settled = false;
    let resolve!: () => void;
    const finished = new Promise<void>((r) => {
      resolve = r;
    });
    const anim = html.animate(toWaapiKeyframes(frames), {
      duration: durationMs,
      easing: PRESET_CSS_EASING[choreo.easingKey] ?? 'linear',
      fill: 'forwards',
    });
    const done = (): void => {
      if (settled) return;
      settled = true;
      applyFrame(html, lastFrame(frames));
      try {
        anim.cancel();
      } catch {
        /* already finished */
      }
      resolve();
    };
    anim.addEventListener('finish', done);
    anim.addEventListener('cancel', done);
    options.signal?.addEventListener('abort', () => anim.cancel(), { once: true });
    return {
      finished,
      cancel(): void {
        anim.cancel();
      },
    };
  }

  return runRaf(html, frames, durationMs, easingFn, delayMs, options.signal);
}

/** Convenience: awaitable enter/exit used by panels and dialogs. */
export async function animateAsync(
  el: Element,
  kind: ChoreographyKind,
  options?: AnimateOptions,
): Promise<void> {
  await animate(el, kind, options).finished;
}
