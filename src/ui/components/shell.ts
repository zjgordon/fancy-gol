/**
 * P1-D-1 / P3-A-6 — layout shell. Intro and chrome visibility use `themes/motion/animate`
 * (no CSS `transition`, no forced `offsetHeight` flush).
 */
import { animate, animateAsync } from '@themes/motion/animate';
import { getMotionSignature } from '@themes/motion/runtime';

export interface ShellRegions {
  readonly toolbar: HTMLElement;
  readonly transport: HTMLElement;
  readonly status: HTMLElement;
  readonly panelDock: HTMLElement;
}

/** The minimal keyboard surface `Tab`-toggling needs — real `Window`-shaped, fakeable in tests. */
export interface ShellKeySurface {
  addEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void): void;
}

/** The minimal surface the intro's cancel-on-any-input needs. Real `Window`-shaped. */
export interface ShellInputSurface {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export type ReducedMotionQuery = () => boolean;

export const SYSTEM_REDUCED_MOTION: ReducedMotionQuery = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Timer source for the intro's completion, injected so a test can drive it without real timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

/** @deprecated Prefer theme `motion.durationMs.slow` — kept for call sites that pin intro length. */
export const INTRO_FADE_MS = 600;
/** Default per-region stagger — the phase doc's own "~40 ms" figure. */
export const DEFAULT_STAGGER_MS = 40;

export interface ShellOptions {
  readonly root: ParentNode;
  readonly keyTarget?: ShellKeySurface;
  readonly inputTarget?: ShellInputSurface;
  readonly reducedMotion?: ReducedMotionQuery;
  readonly timers?: Timers;
}

export interface IntroOptions {
  readonly staggerMs?: number;
}

export interface Shell extends ShellRegions {
  readonly chromeVisible: boolean;
  toggleChrome(): void;
  setChromeVisible(visible: boolean): void;
  playIntro(options?: IntroOptions): Promise<void>;
  dispose(): void;
}

function requireChromeRoot(root: ParentNode): HTMLElement {
  const el = root.querySelector<HTMLElement>('#chrome');
  if (!el) throw new Error('shell: missing required "#chrome" element');
  return el;
}

function requireRegion(root: ParentNode, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#chrome-${id}`);
  if (!el) throw new Error(`shell: missing required chrome region "#chrome-${id}"`);
  return el;
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'INPUT') {
    const nonTextTypes = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);
    return !nonTextTypes.has((target as HTMLInputElement).type);
  }
  return target.isContentEditable;
}

export function attachShell(options: ShellOptions): Shell {
  const root = options.root;
  const chrome = requireChromeRoot(root);
  const regions: ShellRegions = {
    toolbar: requireRegion(root, 'toolbar'),
    transport: requireRegion(root, 'transport'),
    status: requireRegion(root, 'status'),
    panelDock: requireRegion(root, 'panel-dock'),
  };
  const orderedRegions: readonly HTMLElement[] = [
    regions.toolbar,
    regions.transport,
    regions.status,
    regions.panelDock,
  ];

  const keyTarget: ShellKeySurface | undefined =
    options.keyTarget ?? (typeof window !== 'undefined' ? window : undefined);
  const inputTarget: ShellInputSurface | undefined =
    options.inputTarget ?? (typeof window !== 'undefined' ? window : undefined);
  const reducedMotion = options.reducedMotion ?? SYSTEM_REDUCED_MOTION;

  let chromeVisible = true;
  let introAbort: AbortController | null = null;

  function setChromeVisible(visible: boolean): void {
    chromeVisible = visible;
    if (visible) {
      chrome.classList.remove('chrome-hidden');
      void animateAsync(chrome, 'enter', { reducedMotion: reducedMotion() });
    } else {
      // Class flips immediately so Tab-toggle callers (and tests) see the contract; motion
      // still runs the exit choreography when motion is enabled.
      chrome.classList.add('chrome-hidden');
      void animateAsync(chrome, 'exit', { reducedMotion: reducedMotion() });
    }
  }

  function toggleChrome(): void {
    setChromeVisible(!chromeVisible);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || isTextInput(e.target)) return;
    e.preventDefault();
    toggleChrome();
  }

  keyTarget?.addEventListener('keydown', onKeyDown);

  function playIntro(introOptions: IntroOptions = {}): Promise<void> {
    const motion = getMotionSignature();
    const staggerMs = introOptions.staggerMs ?? motion.enter.delayStepMs ?? DEFAULT_STAGGER_MS;

    introAbort?.abort();
    introAbort = new AbortController();
    const { signal } = introAbort;

    chrome.classList.remove('chrome-intro');
    chrome.classList.remove('chrome-hidden');
    chromeVisible = true;

    if (reducedMotion()) {
      for (const el of orderedRegions) {
        el.style.opacity = '1';
        el.style.transform = '';
      }
      return Promise.resolve();
    }

    const handles = orderedRegions.map((el, i) => {
      el.style.opacity = '0';
      return animate(el, 'enter', {
        delayMs: i * staggerMs,
        reducedMotion: false,
        signal,
        motion,
      });
    });

    const cancel = (): void => {
      introAbort?.abort();
      for (const el of orderedRegions) {
        el.style.opacity = '1';
        el.style.transform = '';
      }
    };
    const cancelTargets: ReadonlyArray<readonly [ShellInputSurface, string]> = inputTarget
      ? [
          [inputTarget, 'pointerdown'],
          [inputTarget, 'keydown'],
          [inputTarget, 'wheel'],
        ]
      : [];
    for (const [target, type] of cancelTargets) target.addEventListener(type, cancel, { once: true });

    return Promise.all(handles.map((h) => h.finished)).then(() => {
      for (const [target, type] of cancelTargets) target.removeEventListener(type, cancel);
    });
  }

  return {
    ...regions,
    get chromeVisible() {
      return chromeVisible;
    },
    toggleChrome,
    setChromeVisible,
    playIntro,
    dispose(): void {
      introAbort?.abort();
      keyTarget?.removeEventListener('keydown', onKeyDown);
    },
  };
}
