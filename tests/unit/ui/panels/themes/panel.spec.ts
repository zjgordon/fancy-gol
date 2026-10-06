import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { createThemesPanel, THEMES_PANEL_ID, THEMES_PANEL_MIN_WIDTH } from '@ui/panels/themes/panel';
import { attachPanelHost } from '@ui/shell/panel-host';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

describe('createThemesPanel', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('lists every theme card and reports the active selection', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const selected: string[] = [];
    const previews: string[] = [];
    const panel = createThemesPanel({
      themes: [
        { id: 'default', name: 'Default', cost: 'low' },
        { id: 'chiba-city', name: 'Chiba-City', cost: 'medium' },
      ],
      activeId: 'default',
      onSelect: (id) => selected.push(id),
      onPreviewCreated: (id) => previews.push(id),
    });
    const host = attachPanelHost({ mount, getViewportWidth: () => 1000 });
    host.register(panel.spec);
    host.open(THEMES_PANEL_ID);
    cleanup = () => {
      panel.dispose();
      host.dispose();
      mount.remove();
    };

    expect(panel.spec.minWidthPx).toBe(THEMES_PANEL_MIN_WIDTH);
    expect(previews).toEqual(['default', 'chiba-city']);
    expect(panel.root.querySelectorAll('.themes-card')).toHaveLength(2);
    expect(panel.getActive()).toBe('default');

    const chiba = panel.root.querySelector<HTMLButtonElement>('[data-theme-id="chiba-city"]');
    chiba?.click();
    expect(selected).toEqual(['chiba-city']);

    panel.setActive('chiba-city');
    expect(chiba?.getAttribute('aria-selected')).toBe('true');
  });

  it('asks to prefetch a theme when its card is hovered or focused, before any click (P3-E-7)', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const prefetched: string[] = [];
    const selected: string[] = [];
    const panel = createThemesPanel({
      themes: [
        { id: 'default', name: 'Default', cost: 'low' },
        { id: 'chiba-city', name: 'Chiba-City', cost: 'medium' },
        { id: 'flatline', name: 'Flatline', cost: 'medium' },
      ],
      activeId: 'default',
      onSelect: (id) => selected.push(id),
      onPrefetch: (id) => prefetched.push(id),
    });
    const host = attachPanelHost({ mount, getViewportWidth: () => 1000 });
    host.register(panel.spec);
    host.open(THEMES_PANEL_ID);
    cleanup = () => {
      panel.dispose();
      host.dispose();
      mount.remove();
    };

    const card = (id: string) => panel.root.querySelector<HTMLButtonElement>(`[data-theme-id="${id}"]`)!;
    card('chiba-city').dispatchEvent(new Event('pointerenter'));
    card('flatline').dispatchEvent(new Event('focus'));
    expect(prefetched).toEqual(['chiba-city', 'flatline']);
    expect(selected).toEqual([]); // hovering is not choosing
  });

  it('is happy without an onPrefetch handler', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const panel = createThemesPanel({
      themes: [{ id: 'default', name: 'Default', cost: 'low' }],
      activeId: 'default',
      onSelect: () => {},
    });
    const host = attachPanelHost({ mount, getViewportWidth: () => 1000 });
    host.register(panel.spec);
    host.open(THEMES_PANEL_ID);
    cleanup = () => {
      panel.dispose();
      host.dispose();
      mount.remove();
    };
    const card = panel.root.querySelector<HTMLButtonElement>('[data-theme-id="default"]')!;
    expect(() => {
      card.dispatchEvent(new Event('pointerenter'));
      card.dispatchEvent(new Event('focus'));
    }).not.toThrow();
  });

  it('starts and stops previews with panel open/close', () => {
    let open = 0;
    let close = 0;
    const panel = createThemesPanel({
      themes: [{ id: 'default', name: 'Default', cost: 'low' }],
      activeId: 'default',
      onSelect: () => {},
      onOpen: () => {
        open += 1;
      },
      onClose: () => {
        close += 1;
      },
    });
    const body = document.createElement('div');
    panel.spec.mount(body);
    expect(open).toBe(1);
    panel.spec.unmount?.(body);
    expect(close).toBe(1);
    panel.dispose();
  });

  it('has no axe-core violations', async () => {
    if (UNDER_COVERAGE) return;
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const panel = createThemesPanel({
      themes: [
        { id: 'default', name: 'Default', cost: 'low' },
        { id: 'synthwave', name: 'Synthwave', cost: 'high' },
      ],
      activeId: 'default',
      onSelect: () => {},
    });
    const host = attachPanelHost({ mount, getViewportWidth: () => 1000 });
    host.register(panel.spec);
    host.open(THEMES_PANEL_ID);
    cleanup = () => {
      panel.dispose();
      host.dispose();
      mount.remove();
    };
    const results = await axe.run(panel.root, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
