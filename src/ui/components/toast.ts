/**
 * P1-D-5 / P3-A-6 — shared toast primitive. Enter/exit via the motion system; no CSS `transition`.
 */
import { animateAsync } from '@themes/motion/animate';
import { prefersReducedMotion } from '@themes/motion/runtime';

const DEFAULT_DURATION_MS = 5000;

export interface ToastOptions {
  readonly durationMs?: number;
}

export interface ToastRegion {
  readonly root: HTMLElement;
  /** Shows one toast, auto-dismissed after `durationMs` (default 5s) or on manual dismiss. */
  show(message: string, options?: ToastOptions): void;
  /** Removes the region from the DOM and clears every pending auto-dismiss timer. */
  dispose(): void;
}

/** Creates the shared toast region, already appended to `document.body`. */
export function createToastRegion(): ToastRegion {
  const root = document.createElement('div');
  root.className = 'toast-region';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  document.body.appendChild(root);

  const timers = new Set<ReturnType<typeof setTimeout>>();

  function show(message: string, options: ToastOptions = {}): void {
    const toast = document.createElement('div');
    toast.className = 'toast chrome-panel';

    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'toast-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss notification');
    dismiss.textContent = '×';

    toast.append(text, dismiss);
    root.appendChild(toast);
    void animateAsync(toast, 'enter', { reducedMotion: prefersReducedMotion() });

    let dismissed = false;
    const remove = (): void => {
      if (dismissed) return;
      dismissed = true;
      timers.delete(timer);
      const finish = (): void => {
        toast.remove();
      };
      if (prefersReducedMotion()) {
        finish();
        return;
      }
      void animateAsync(toast, 'exit', { reducedMotion: false }).then(finish);
    };
    dismiss.addEventListener('click', remove);
    const timer = setTimeout(remove, options.durationMs ?? DEFAULT_DURATION_MS);
    timers.add(timer);
  }

  return {
    root,
    show,
    dispose(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      root.remove();
    },
  };
}
