/**
 * P1-D-5 / P3-A-6 — shared dialog primitive. Enter/exit go through `themes/motion/animate`
 * — never a CSS `transition` on `.dialog-*` (lint-enforced).
 */
import { animateAsync } from '@themes/motion/animate';
import { prefersReducedMotion } from '@themes/motion/runtime';

let openCount = 0;

export interface DialogHandle {
  /** The full-viewport scrim + centring wrapper — the portal root. */
  readonly root: HTMLElement;
  /** The `role="dialog"` panel itself — callers append their own content here, after the title. */
  readonly panel: HTMLElement;
  /** Closes the dialog (idempotent) and restores focus to whatever had it before opening. */
  close(): void;
}

export interface DialogOptions {
  readonly title: string;
  /** Called once, when the dialog closes for any reason (Escape, backdrop, or a caller's own
   * button calling `close()`). Never called twice for the same dialog. */
  readonly onClose?: () => void;
}

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

/** Opens a new, focus-trapped, `Escape`-closable dialog and returns its handle. */
export function openDialog(options: DialogOptions): DialogHandle {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const root = document.createElement('div');
  root.className = 'dialog-overlay';

  const panel = document.createElement('div');
  panel.className = 'dialog-panel chrome-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;

  const titleId = `dialog-title-${(openCount += 1)}`;
  const titleEl = document.createElement('h3');
  titleEl.id = titleId;
  titleEl.textContent = options.title;
  panel.setAttribute('aria-labelledby', titleId);
  panel.appendChild(titleEl);

  root.appendChild(panel);
  document.body.appendChild(root);

  void animateAsync(panel, 'enter', { reducedMotion: prefersReducedMotion() });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    const finish = (): void => {
      root.remove();
      previouslyFocused?.focus();
      options.onClose?.();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    void animateAsync(panel, 'exit', { reducedMotion: false }).then(finish);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = focusableElements(panel);
    if (focusable.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  panel.focus();

  return { root, panel, close };
}

export interface ConfirmDialogOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Styles the confirm button as a dangerous action (a token-driven colour, not a literal). */
  readonly destructive?: boolean;
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const settle = (value: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const message = document.createElement('p');
    message.className = 'dialog-message';
    message.textContent = options.message;

    const controls = document.createElement('div');
    controls.className = 'controls dialog-controls';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = options.cancelLabel ?? 'Cancel';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = options.confirmLabel ?? 'Confirm';
    if (options.destructive) confirmButton.classList.add('dialog-destructive');
    controls.append(cancelButton, confirmButton);

    const handle = openDialog({ title: options.title, onClose: () => settle(false) });
    handle.panel.append(message, controls);
    cancelButton.focus();

    cancelButton.addEventListener('click', () => {
      settle(false);
      handle.close();
    });
    confirmButton.addEventListener('click', () => {
      settle(true);
      handle.close();
    });
  });
}
