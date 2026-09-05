/**
 * P1-D-5 — the shared toast primitive: `aria-live="polite"` announcements for things worth
 * telling the user about without blocking them (unlike `dialog.ts`'s confirmations). A flood
 * fill that hit its cap is the phase doc's own named example — the fill has *already happened*
 * by the time anyone could ask a yes/no question about it (`ui/tools/fill.ts`'s own doc comment:
 * "`capped` is readable after a fill either way"), so it's a notice, not a confirmation.
 *
 * One shared region (a portal, same reasoning as `dialog.ts`'s: `position: fixed` is contained
 * by any ancestor `transform`, and every `.chrome-region` sets one), created once and reused —
 * unlike a dialog, toasts can stack, so this is a container a caller pushes messages into rather
 * than a one-shot open/close pair.
 */

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

/** Creates the shared toast region, already appended to `document.body`. Call once per app — a
 * second call would just create a second, redundant `aria-live` region. */
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

    let dismissed = false;
    const remove = (): void => {
      if (dismissed) return;
      dismissed = true;
      timers.delete(timer);
      toast.remove();
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
