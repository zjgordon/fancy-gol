/**
 * P1-D-5 — the shared dialog primitive: "one shared, accessible primitive set" the phase doc
 * asks for, so every blocking prompt in this app (a destructive-action confirmation, the
 * ruleset picker's state-migration prompt, …) gets the same real focus trap and `Escape`-to-close
 * instead of each caller growing its own copy. P1-D-4's migration dialog built exactly that copy
 * ahead of this task existing, portal and all — `ruleset-picker.ts` now builds on this instead.
 *
 * A dialog is a portal (appended to `document.body`, not wherever the caller happens to live):
 * `position: fixed` is contained by *any* ancestor with a `transform`, and every `.chrome-region`
 * sets one for its own centring/intro choreography — found the hard way in a real browser while
 * building P1-D-4's own dialog, before this file existed to fix it once for everyone.
 *
 * One-shot lifecycle, not a toggle: `openDialog()` builds and shows immediately; `close()` tears
 * the whole thing down (not just hides it) and restores focus to whatever had it before the
 * dialog opened. A caller that needs a *reusable* popover (the ruleset picker's own listbox) still
 * owns that toggle itself — this primitive is for the transient, one-question-at-a-time case.
 */

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

/** Opens a new, focus-trapped, `Escape`-closable dialog and returns its handle. See this file's
 * own module doc for why it's a portal and why the lifecycle is one-shot, not a toggle. */
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

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    // The dialog's own contents are about to be gone; move focus back before anything else so a
    // screen reader never announces "nothing focused" even for an instant.
    previouslyFocused?.focus();
    options.onClose?.();
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
  // Capture phase: a dialog must win over whatever else on the page might otherwise handle
  // Escape/Tab first (e.g. a tool's own Escape-cancels-gesture handling).
  document.addEventListener('keydown', onKeyDown, true);

  // Focuses the panel itself, not a piece of the caller's own content: at this point (before
  // `openDialog` has even returned) nothing else exists to focus yet — a caller that wants a
  // more specific initial focus target builds its content, appends it, then focuses it directly,
  // exactly as `confirmDialog` below does for its Cancel button.
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

/**
 * The "every destructive action routes through this" convenience (the phase doc's own phrase):
 * builds a title/message/Confirm-Cancel dialog on {@link openDialog} and resolves once the user
 * picks one — `true` for Confirm, `false` for Cancel *or* dismissing without choosing at all
 * (`Escape`, clicking outside — never treated as an implicit yes).
 */
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
    // Cancel, not Confirm: a destructive action's default keyboard-focus target should never be
    // the button that does the damage.
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
