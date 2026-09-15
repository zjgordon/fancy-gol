/**
 * P1-D-5 / P3-A-6 — tooltips.
 *
 * `bindingTooltip` still builds the native `title` string (a11y + Phase 4 remapping).
 * `showTooltip` / `attachTooltip` add a motion-driven flyout so tooltips participate in the
 * choreography system — never a CSS `transition`.
 */
import type { Keymap } from '@ui/input/keymap';
import { animateAsync } from '@themes/motion/animate';
import { prefersReducedMotion } from '@themes/motion/runtime';

/** `"${label} (${binding})"`, or just `label` if `commandId` has no registered binding. */
export function bindingTooltip(keymap: Keymap, commandId: string, label: string): string {
  const entry = keymap.list().find((e) => e.commandId === commandId);
  return entry ? `${label} (${entry.binding})` : label;
}

export interface TooltipHandle {
  readonly root: HTMLElement;
  dismiss(): void;
}

/** Show a portal tooltip near `anchor`, animated via enter/exit choreography. */
export function showTooltip(anchor: HTMLElement, text: string): TooltipHandle {
  const root = document.createElement('div');
  root.className = 'tooltip-flyout chrome-panel';
  root.setAttribute('role', 'tooltip');
  root.textContent = text;
  document.body.appendChild(root);

  // Position without reading layout on the animated element itself — use anchor rect once.
  const rect = anchor.getBoundingClientRect();
  root.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
  root.style.top = `${Math.round(rect.bottom + 6)}px`;

  void animateAsync(root, 'enter', { reducedMotion: prefersReducedMotion() });

  let dismissed = false;
  return {
    root,
    dismiss(): void {
      if (dismissed) return;
      dismissed = true;
      const finish = (): void => {
        root.remove();
      };
      if (prefersReducedMotion()) {
        finish();
        return;
      }
      void animateAsync(root, 'exit', { reducedMotion: false }).then(finish);
    },
  };
}

/** Pointer enter/leave wiring for a control that also keeps a native `title` for a11y. */
export function attachTooltip(target: HTMLElement, text: string): () => void {
  target.title = text;
  let handle: TooltipHandle | null = null;
  const onEnter = (): void => {
    handle?.dismiss();
    handle = showTooltip(target, text);
  };
  const onLeave = (): void => {
    handle?.dismiss();
    handle = null;
  };
  target.addEventListener('pointerenter', onEnter);
  target.addEventListener('pointerleave', onLeave);
  return () => {
    target.removeEventListener('pointerenter', onEnter);
    target.removeEventListener('pointerleave', onLeave);
    handle?.dismiss();
  };
}
