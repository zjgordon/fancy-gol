import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { PATTERN_COLLECTION_CREDITS } from '@ui/panels/library/credits';
import {
  LIBRARY_DRAG_TYPE,
  LIBRARY_PANEL_ID,
  LIBRARY_PANEL_MIN_WIDTH,
  createLibraryPanel,
} from '@ui/panels/library/panel';
import type { LibraryEntry } from '@ui/panels/library/filter';
import { attachPanelHost } from '@ui/shell/panel-host';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

function entry(partial: Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'name'>): LibraryEntry {
  return {
    aliases: [],
    ruleset: 'conway',
    category: 'curiosity',
    tags: [],
    width: 3,
    height: 3,
    origin: 'curated',
    ...partial,
  };
}

function catalogue(): LibraryEntry[] {
  return [
    entry({
      id: 'gosper-gun',
      name: 'Gosper glider gun',
      author: 'Bill Gosper',
      year: 1970,
      category: 'gun',
      tags: ['gun'],
      width: 36,
      height: 9,
      period: 30,
      source: 'https://conwaylife.com/wiki/Gosper_glider_gun',
    }),
    entry({
      id: 'queen-bee-shuttle',
      name: 'Queen bee shuttle',
      author: 'Bill Gosper',
      year: 1970,
      category: 'oscillator',
      tags: ['oscillator'],
      period: 30,
      width: 22,
      height: 7,
    }),
    ...Array.from({ length: 248 }, (_, i) =>
      entry({
        id: `filler-${i}`,
        name: `Filler ${i}`,
        author: 'Anon',
        year: 1970,
        category: 'still-life',
        tags: ['still-life'],
        width: 2,
        height: 2,
      }),
    ),
    entry({
      id: 'wireworld-diode',
      name: 'Diode',
      ruleset: 'wireworld',
      category: 'logic',
      tags: ['logic'],
      author: 'Brian Silverman',
      year: 1987,
    }),
  ];
}

describe('createLibraryPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup(entries = catalogue()) {
    const onPick = vi.fn();
    const panel = createLibraryPanel({
      entries,
      activeRuleset: 'conway',
      thumbUrl: () => null,
      onPick,
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const host = attachPanelHost({ mount, getViewportWidth: () => 1000 });
    host.register(panel.spec);
    return { panel, host, onPick };
  }

  it('opens in under 100 ms with 250 entries loaded', () => {
    const entries = catalogue();
    expect(entries.length).toBeGreaterThanOrEqual(250);
    const t0 = performance.now();
    const { panel, host } = setup(entries);
    host.open(LIBRARY_PANEL_ID);
    const elapsed = performance.now() - t0;
    expect(panel.root.querySelectorAll('.lib-card').length).toBeLessThan(30);
    if (!UNDER_COVERAGE) expect(elapsed).toBeLessThan(100);
    panel.dispose();
    host.dispose();
  });

  it('keeps a bounded DOM while scrolling a 250-entry catalogue (60 fps stand-in)', () => {
    const { panel, host } = setup();
    host.open(LIBRARY_PANEL_ID);
    const viewport = panel.root.querySelector<HTMLElement>('.lib-virtual-viewport')!;
    Object.defineProperty(viewport, 'clientHeight', { value: 320, configurable: true });
    const t0 = performance.now();
    viewport.scrollTop = 4000;
    viewport.dispatchEvent(new Event('scroll'));
    const elapsed = performance.now() - t0;
    expect(panel.root.querySelectorAll('.lib-card').length).toBeLessThan(20);
    if (!UNDER_COVERAGE) expect(elapsed).toBeLessThan(16.6);
    panel.dispose();
    host.dispose();
  });

  it('search gosp / p30 and keyboard Enter pick up a stamp', () => {
    const { panel, host, onPick } = setup();
    host.open(LIBRARY_PANEL_ID);
    const search = panel.root.querySelector<HTMLInputElement>('.lib-search')!;
    search.value = 'gosp';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel.getVisibleIds()[0]).toBe('gosper-gun');
    panel.select('gosper-gun');
    panel.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onPick).toHaveBeenCalledWith('gosper-gun');

    search.value = 'p30';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel.getVisibleIds()).toEqual(expect.arrayContaining(['gosper-gun', 'queen-bee-shuttle']));
    panel.dispose();
    host.dispose();
  });

  it('switching the active ruleset to WireWorld changes the visible set without a reload', () => {
    const { panel, host } = setup();
    host.open(LIBRARY_PANEL_ID);
    expect(panel.getFilters().ruleset).toBe('conway');
    expect(panel.getVisibleIds()).not.toContain('wireworld-diode');
    panel.setActiveRuleset('wireworld');
    expect(panel.getFilters().ruleset).toBe('wireworld');
    expect(panel.getVisibleIds()).toEqual(['wireworld-diode']);
    panel.dispose();
    host.dispose();
  });

  it('shows discoverer and year, with source one activation away', () => {
    const { panel, host } = setup();
    host.open(LIBRARY_PANEL_ID);
    const search = panel.root.querySelector<HTMLInputElement>('.lib-search')!;
    search.value = 'gosp';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    panel.select('gosper-gun');
    expect(panel.root.textContent).toContain('Bill Gosper, 1970');
    const source = panel.root.querySelector<HTMLAnchorElement>('.lib-detail-source');
    expect(source?.href).toContain('conwaylife.com');
    expect(source?.textContent).toContain('conwaylife.com');
    panel.dispose();
    host.dispose();
  });

  it('Credits dialog lists every SOURCES.md collection and its terms', () => {
    const { panel, host } = setup();
    host.open(LIBRARY_PANEL_ID);
    panel.root.querySelector<HTMLButtonElement>('.lib-credits-btn')!.click();
    const dialog = document.querySelector('.dialog-panel');
    expect(dialog).toBeTruthy();
    for (const credit of PATTERN_COLLECTION_CREDITS) {
      expect(dialog?.textContent).toContain(credit.source);
      expect(dialog?.textContent).toContain(credit.terms);
    }
    panel.dispose();
    host.dispose();
  });

  it('cards are draggable with the library MIME type', () => {
    const { panel, host } = setup();
    host.open(LIBRARY_PANEL_ID);
    const search = panel.root.querySelector<HTMLInputElement>('.lib-search')!;
    search.value = 'gosp';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const card = panel.root.querySelector<HTMLElement>('.lib-card')!;
    expect(card.draggable).toBe(true);
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    card.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const ev = new Event('dragstart', { bubbles: true }) as Event & { dataTransfer: typeof transfer };
    Object.defineProperty(ev, 'dataTransfer', { value: transfer });
    card.dispatchEvent(ev);
    expect(transfer.setData).toHaveBeenCalledWith(LIBRARY_DRAG_TYPE, 'gosper-gun');
    expect(LIBRARY_PANEL_MIN_WIDTH).toBeGreaterThanOrEqual(280);
    panel.dispose();
    host.dispose();
  });

  it('has zero axe-core violations on the panel root', async () => {
    const { panel, host } = setup();
    host.open(LIBRARY_PANEL_ID);
    expect((await axe.run(panel.root)).violations).toEqual([]);
    panel.dispose();
    host.dispose();
  });
});
