/**
 * P1-D-1 — the layout shell: the floating translucent chrome (toolbar left, transport
 * bottom-centre, status bar bottom-right, panel dock right) that floats over the full-bleed
 * canvas, `Tab`-dismissible, plus the cold-start choreography that is this task's whole reason
 * for existing (see the phase doc's "wow on first paint" intent — *"When a user first opens the
 * app, they should be struck by the fact that it's a 'toy' that feels like a professional
 * tool."*). `index.html` owns the chrome's actual DOM structure and its token-driven CSS; this
 * module only owns behaviour — finding the four fixed regions, toggling visibility, and staging
 * the intro fade-in. Future D-workstream tasks (transport, status bar, ruleset picker,
 * toasts/dialogs) mount their own content into the regions this hands back; none of them need to
 * touch this file to do it.
 *
 * The four regions are fixed by the phase doc's own implementation note — this shell does not
 * grow a fifth without a doc amendment, the same discipline `ToolRegistry`'s "one new file, one
 * registry line" rule enforces for tools.
 *
 * `Tab` globally toggling chrome is a deliberate call from the phase doc ("Chrome is dismissible
 * with `Tab` for a pure-canvas view"), not this module's invention — it is in real tension with
 * ordinary focus navigation (a screen-reader or keyboard-only user tabbing through the toolbar's
 * eventual buttons would have `Tab` hijacked instead). Phase 1 ships no focusable chrome content
 * yet beyond the transport's plain buttons, so the tension is latent, not yet a live bug; guarded
 * here only against text-input targets (the same discipline `ui/input/keymap.ts`'s own Tab-
 * adjacent guards use), with the fuller resolution — Tab still toggling chrome but not eating
 * focus navigation while chrome content is genuinely focused — left for Phase 6's accessibility
 * audit (`P6-C-1`) once there is real focusable chrome content to test it against.
 */

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

/** Timer source for the intro's completion, injected the same way `ui/input/keymap.ts`'s chord
 * timeout is — so a test can drive it without real timers. Each module keeps its own copy rather
 * than sharing one; see this file's module doc. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

/** Per-region CSS fade-in duration. A provisional literal, like `ui/overlay/grid-lines.ts`'s
 * `FadeCurve` default — P1-E-1's real motion-duration token replaces it with no API change. */
export const INTRO_FADE_MS = 600;
/** Default per-region stagger — the phase doc's own "~40 ms" figure. */
export const DEFAULT_STAGGER_MS = 40;

export interface ShellOptions {
  /** Where the four `.chrome-region` elements live — `document` in production. */
  readonly root: ParentNode;
  /** Where `Tab` is observed. Defaults to `window`. */
  readonly keyTarget?: ShellKeySurface;
  /** Where the intro's cancel-on-any-input listens. Defaults to `window`. */
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
  /**
   * The cold-start choreography's chrome half: chrome starts hidden, then fades in staggered by
   * `staggerMs` per region (toolbar, transport, status, panel dock, in that order). Resolves once
   * every region has finished, or immediately under reduced motion (chrome simply appears, no
   * fade). Any real `pointerdown`/`keydown`/`wheel` before it resolves cancels it instantly and
   * jumps straight to the fully-visible end state — the intro must never delay interactivity.
   */
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

/** A hand-written duplicate of `ui/input/keymap.ts`'s identically-behaved guard — kept
 * independent per this file's own module-boundary-duplication note. */
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
  // Fixed order — matches the phase doc's own chrome layout description.
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
  const timers = options.timers ?? REAL_TIMERS;

  let chromeVisible = true;

  function setChromeVisible(visible: boolean): void {
    chromeVisible = visible;
    chrome.classList.toggle('chrome-hidden', !visible);
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
    const staggerMs = introOptions.staggerMs ?? DEFAULT_STAGGER_MS;

    if (reducedMotion()) {
      chrome.classList.remove('chrome-intro');
      for (const el of orderedRegions) el.style.removeProperty('--gol-intro-delay');
      setChromeVisible(true);
      return Promise.resolve();
    }

    setChromeVisible(false);
    chrome.classList.add('chrome-intro');
    orderedRegions.forEach((el, i) => {
      el.style.setProperty('--gol-intro-delay', `${i * staggerMs}ms`);
    });
    // Forces a synchronous style flush so the browser commits the "hidden" state as a real,
    // rendered style before "visible" is applied below — without this, both class changes land
    // in the same task and get coalesced into one style recalculation, so the transition never
    // has a starting point to animate from (the classic "just-hidden element doesn't transition
    // back in" pitfall). Reading a layout property is what forces the flush; the value itself is
    // unused. jsdom (this module's test environment) has no real layout engine and always
    // reports 0 here, which is harmless — the flush is a no-op there, not incorrect.
    void chrome.offsetHeight;
    setChromeVisible(true);

    return new Promise<void>((resolve) => {
      let settled = false;
      let timerHandle: number | null = null;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timerHandle !== null) timers.clearTimeout(timerHandle);
        chrome.classList.remove('chrome-intro');
        for (const el of orderedRegions) el.style.removeProperty('--gol-intro-delay');
        setChromeVisible(true);
        for (const [target, type] of cancelTargets) target.removeEventListener(type, cancel);
        resolve();
      };

      const cancel = (): void => finish();
      const cancelTargets: ReadonlyArray<readonly [ShellInputSurface, string]> = inputTarget
        ? [
            [inputTarget, 'pointerdown'],
            [inputTarget, 'keydown'],
            [inputTarget, 'wheel'],
          ]
        : [];
      for (const [target, type] of cancelTargets) target.addEventListener(type, cancel, { once: true });

      const totalMs = staggerMs * (orderedRegions.length - 1) + INTRO_FADE_MS;
      timerHandle = timers.setTimeout(finish, totalMs);
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
      keyTarget?.removeEventListener('keydown', onKeyDown);
    },
  };
}
