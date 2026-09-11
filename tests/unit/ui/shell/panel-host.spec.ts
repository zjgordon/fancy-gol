import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { DEFAULT_PANEL_LAYOUT } from '@shared/session';
import { attachPanelHost, clampPanelWidth } from '@ui/shell/panel-host';

function pressKey(target: EventTarget, key: string, extra: Partial<KeyboardEventInit> = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
}

function fixture(id: string, title: string, minWidthPx: number) {
  return {
    id,
    title,
    minWidthPx,
    mount(body: HTMLElement) {
      const btn = document.createElement('button');
      btn.textContent = `${title} action`;
      body.appendChild(btn);
    },
  };
}

describe('clampPanelWidth', () => {
  it('never drops below the declared minimum or above 80% of the viewport', () => {
    expect(clampPanelWidth(80, 240, 1000)).toBe(240);
    expect(clampPanelWidth(900, 240, 1000)).toBe(800);
  });
});

describe('attachPanelHost', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup() {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const changes: unknown[] = [];
    const host = attachPanelHost({
      mount,
      getViewportWidth: () => 1000,
      onLayoutChange: (layout) => {
        changes.push(layout);
      },
    });
    return { mount, host, changes };
  }

  it('stays off the dock until a panel registers, then docks, resizes, and collapses', () => {
    const { mount, host, changes } = setup();
    expect(mount.contains(host.root)).toBe(false);

    host.register(fixture('library', 'Library', 240));
    host.register(fixture('stats', 'Statistics', 280));
    expect(mount.contains(host.root)).toBe(true);
    expect(host.getLayout()).toEqual(DEFAULT_PANEL_LAYOUT);

    host.open('stats');
    expect(host.getLayout().activeId).toBe('stats');
    expect(host.root.querySelector('.panel-host-body')?.textContent).toContain('Statistics action');
    expect(host.root.style.getPropertyValue('--gol-panel-min-width')).toBe('280px');

    host.setWidth(80);
    expect(host.getLayout().widthPx).toBe(280);

    const handle = host.root.querySelector('.panel-host-resize')!;
    handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 800, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 750, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    expect(host.getLayout().widthPx).toBe(330);

    host.setDock('left');
    expect(mount.dataset['dock']).toBe('left');
    host.setCollapsed(true);
    expect(host.root.querySelector('.panel-host-frame')!).toHaveProperty('hidden', true);

    host.applyLayout({ activeId: 'library', dock: 'right', widthPx: 300, collapsed: false });
    expect(host.getLayout().activeId).toBe('library');
    expect(host.root.querySelector('.panel-host-body')?.textContent).toContain('Library action');
    expect(changes.length).toBeGreaterThan(0);

    host.setWidth(300);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(host.getLayout().widthPx).toBe(316);
  });

  it('Escape collapses, then closes, and restores the previous focus', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Canvas';
    document.body.appendChild(trigger);
    trigger.focus();

    const { host } = setup();
    host.register(fixture('stats', 'Statistics', 240));
    host.open('stats');
    expect(document.activeElement).toBe(host.root.querySelector('.panel-host-panel'));

    pressKey(host.root, 'Escape');
    expect(host.getLayout().collapsed).toBe(true);
    expect(document.activeElement).toBe(trigger);

    host.root.querySelector<HTMLButtonElement>('.panel-host-collapse')!.focus();
    pressKey(host.root, 'Escape');
    expect(host.getLayout().activeId).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab inside the host the same way dialog.ts does', () => {
    const { host } = setup();
    host.register(fixture('stats', 'Statistics', 240));
    host.open('stats');
    const focusable = [...host.root.querySelectorAll<HTMLElement>('button, [tabindex]')].filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    pressKey(host.root, 'Tab');
    expect(document.activeElement).toBe(first);
    first.focus();
    pressKey(host.root, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('a fourth panel is only a new register() call', () => {
    const { host } = setup();
    host.register(fixture('library', 'Library', 240));
    host.register(fixture('stats', 'Statistics', 240));
    host.register(fixture('studio', 'Studio', 240));
    host.register(fixture('extra', 'Notes', 200));
    host.open('extra');
    expect(host.getLayout().activeId).toBe('extra');
    expect(host.root.querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it('has zero axe-core violations on each registered panel', async () => {
    const { host } = setup();
    host.register(fixture('library', 'Library', 240));
    host.register(fixture('stats', 'Statistics', 280));
    host.open('library');
    expect((await axe.run(host.root)).violations).toEqual([]);
    host.open('stats');
    expect((await axe.run(host.root)).violations).toEqual([]);
  });
});
