/**
 * P3-D-1 — 300 ms theme cross-fade. Fades the scene out, applies the new theme
 * synchronously, then fades back in. Reduced motion skips the animation so the
 * switch stays instant and flicker-free without a reload.
 */
export const THEME_CROSSFADE_MS = 300;
/** Sync apply work must finish inside one 30 fps frame (P3-D-1 AC). */
export const THEME_SWITCH_FRAME_BUDGET_MS = 1000 / 30;

export interface ThemeSwitchFade {
  (el: HTMLElement, from: number, to: number, ms: number): Promise<void>;
}

function defaultFade(el: HTMLElement, from: number, to: number, ms: number): Promise<void> {
  if (ms <= 0) {
    el.style.opacity = String(to);
    return Promise.resolve();
  }
  if (typeof el.animate === 'function') {
    const anim = el.animate([{ opacity: from }, { opacity: to }], {
      duration: ms,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    return anim.finished.then(() => {
      el.style.opacity = String(to);
      try {
        anim.cancel();
      } catch {
        // already finished
      }
    });
  }
  el.style.opacity = String(to);
  return Promise.resolve();
}

export interface CrossfadeThemeSwitchOptions {
  readonly target: HTMLElement;
  readonly reducedMotion: boolean;
  /** Apply the new theme (tokens, passes, palette). Must be synchronous and cheap. */
  readonly apply: () => void;
  readonly durationMs?: number;
  readonly fade?: ThemeSwitchFade;
  /** Test hook: capture wall time spent inside `apply`. */
  readonly onApplyMs?: (ms: number) => void;
  readonly now?: () => number;
}

/**
 * Cross-fade a theme change over {@link THEME_CROSSFADE_MS}. Never navigates or
 * reloads — `apply` is the only side effect beyond opacity.
 */
export async function crossfadeThemeSwitch(opts: CrossfadeThemeSwitchOptions): Promise<void> {
  const duration = opts.durationMs ?? THEME_CROSSFADE_MS;
  const fade = opts.fade ?? defaultFade;
  const now = opts.now ?? (() => performance.now());
  const half = duration / 2;

  if (opts.reducedMotion || duration <= 0) {
    const t0 = now();
    opts.apply();
    opts.onApplyMs?.(now() - t0);
    opts.target.style.opacity = '1';
    return;
  }

  await fade(opts.target, 1, 0, half);
  const t0 = now();
  opts.apply();
  opts.onApplyMs?.(now() - t0);
  await fade(opts.target, 0, 1, half);
  opts.target.style.opacity = '1';
}
