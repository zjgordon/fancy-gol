import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { confirmDialog, openDialog } from '@ui/components/dialog';

function pressKey(target: EventTarget, key: string, extra: Partial<KeyboardEventInit> = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
}

describe('openDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is a portal: appended to document.body, role=dialog, aria-modal, labelled by its title', () => {
    const handle = openDialog({ title: 'Switch to WireWorld' });
    expect(document.body.contains(handle.root)).toBe(true);
    expect(handle.panel.getAttribute('role')).toBe('dialog');
    expect(handle.panel.getAttribute('aria-modal')).toBe('true');
    const labelledBy = handle.panel.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)!.textContent).toBe('Switch to WireWorld');
    handle.close();
  });

  it('focuses the panel itself by default', () => {
    const handle = openDialog({ title: 'Test' });
    expect(document.activeElement).toBe(handle.panel);
    handle.close();
  });

  it('Escape closes the dialog, removes it from the DOM, and calls onClose', () => {
    const onClose = vi.fn();
    const handle = openDialog({ title: 'Test', onClose });
    pressKey(handle.panel, 'Escape');
    expect(document.body.contains(handle.root)).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close() is idempotent — onClose never fires twice', () => {
    const onClose = vi.fn();
    const handle = openDialog({ title: 'Test', onClose });
    handle.close();
    handle.close();
    pressKey(document, 'Escape'); // even a stray Escape after manual close must not re-fire
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to whatever had it before the dialog opened', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const handle = openDialog({ title: 'Test' });
    expect(document.activeElement).not.toBe(trigger);
    handle.close();
    expect(document.activeElement).toBe(trigger);
  });

  describe('focus trap', () => {
    it('Tab from the last focusable element wraps to the first', () => {
      const handle = openDialog({ title: 'Test' });
      const first = document.createElement('button');
      first.textContent = 'First';
      const last = document.createElement('button');
      last.textContent = 'Last';
      handle.panel.append(first, last);
      last.focus();

      pressKey(handle.panel, 'Tab');
      expect(document.activeElement).toBe(first);
      handle.close();
    });

    it('Shift+Tab from the first focusable element wraps to the last', () => {
      const handle = openDialog({ title: 'Test' });
      const first = document.createElement('button');
      first.textContent = 'First';
      const last = document.createElement('button');
      last.textContent = 'Last';
      handle.panel.append(first, last);
      first.focus();

      pressKey(handle.panel, 'Tab', { shiftKey: true });
      expect(document.activeElement).toBe(last);
      handle.close();
    });

    it('a Tab in the middle of the dialog is left alone', () => {
      const handle = openDialog({ title: 'Test' });
      const first = document.createElement('button');
      const middle = document.createElement('button');
      const last = document.createElement('button');
      handle.panel.append(first, middle, last);
      middle.focus();

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      handle.panel.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      handle.close();
    });

    it('a disabled or tabindex=-1 element is not part of the trap', () => {
      const handle = openDialog({ title: 'Test' });
      const real = document.createElement('button');
      const disabled = document.createElement('button');
      disabled.disabled = true;
      handle.panel.append(real, disabled);
      real.focus();

      // Only one real focusable target (the panel's other focusable is disabled) -- Tab forward
      // from it must wrap back to itself, not to the disabled button.
      pressKey(handle.panel, 'Tab');
      expect(document.activeElement).toBe(real);
      handle.close();
    });
  });

  it('has zero axe-core violations', async () => {
    const handle = openDialog({ title: 'Accessible dialog' });
    const button = document.createElement('button');
    button.textContent = 'OK';
    handle.panel.appendChild(button);

    const results = await axe.run(handle.root);
    expect(results.violations).toEqual([]);
    handle.close();
  });
});

describe('confirmDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function buttons(): { confirm: HTMLButtonElement; cancel: HTMLButtonElement } {
    const [cancel, confirm] = [...document.querySelectorAll<HTMLButtonElement>('.dialog-controls button')];
    return { confirm: confirm!, cancel: cancel! };
  }

  it('resolves true when Confirm is clicked, and removes the dialog', async () => {
    const promise = confirmDialog({ title: 'Clear the grid?', message: 'This cannot be undone.' });
    buttons().confirm.click();
    expect(await promise).toBe(true);
    expect(document.querySelector('.dialog-panel')).toBeNull();
  });

  it('resolves false when Cancel is clicked', async () => {
    const promise = confirmDialog({ title: 'Clear the grid?', message: 'This cannot be undone.' });
    buttons().cancel.click();
    expect(await promise).toBe(false);
  });

  it('resolves false on Escape — dismissing without choosing is never an implicit yes', async () => {
    const promise = confirmDialog({ title: 'Clear the grid?', message: 'This cannot be undone.' });
    pressKey(document.querySelector('.dialog-panel')!, 'Escape');
    expect(await promise).toBe(false);
  });

  it('focuses Cancel by default, never the destructive action', async () => {
    const promise = confirmDialog({ title: 'Clear the grid?', message: 'x', destructive: true });
    expect(document.activeElement).toBe(buttons().cancel);
    buttons().cancel.click();
    await promise;
  });

  it('renders custom labels and the destructive styling hook', async () => {
    const promise = confirmDialog({
      title: 'Clear the grid?',
      message: 'x',
      confirmLabel: 'Clear',
      cancelLabel: 'Keep',
      destructive: true,
    });
    const { confirm, cancel } = buttons();
    expect(confirm.textContent).toBe('Clear');
    expect(cancel.textContent).toBe('Keep');
    expect(confirm.classList.contains('dialog-destructive')).toBe(true);
    cancel.click();
    await promise;
  });

  it('has zero axe-core violations', async () => {
    const promise = confirmDialog({ title: 'Clear the grid?', message: 'This cannot be undone.' });
    const results = await axe.run(document.querySelector('.dialog-overlay')!);
    expect(results.violations).toEqual([]);
    buttons().cancel.click();
    await promise;
  });
});
