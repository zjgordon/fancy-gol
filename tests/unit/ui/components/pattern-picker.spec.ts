import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPatternPicker, type PatternPickerEntry } from '@ui/components/pattern-picker';

const ENTRIES: readonly PatternPickerEntry[] = [
  { id: 'glider', name: 'Glider', origin: 'curated' },
  { id: 'block', name: 'Block', origin: 'curated' },
  { id: 'user:mine', name: 'My soup', origin: 'user' },
];

describe('attachPatternPicker', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lists user-saved patterns first, with a yours badge, alongside curated ones', () => {
    const onPick = vi.fn();
    const picker = attachPatternPicker({ entries: ENTRIES, source: 'api', onPick });
    document.body.appendChild(picker.root);
    const names = [...picker.root.querySelectorAll('.pattern-entry-name')].map((el) => el.textContent);
    expect(names[0]).toBe('My soup');
    expect(names).toContain('Glider');
    const yours = picker.root.querySelector('.pattern-origin--user');
    expect(yours?.textContent).toBe('yours');
    const groups = [...picker.root.querySelectorAll('.pattern-group-title')].map((el) => el.textContent);
    expect(groups).toEqual(['Yours', 'Catalogue']);
    picker.dispose();
  });

  it('shows a non-blocking starter-set hint when the API is unreachable', () => {
    const picker = attachPatternPicker({
      entries: [{ id: 'glider', name: 'Glider', origin: 'bundled' }],
      source: 'bundled',
      onPick: () => {},
    });
    document.body.appendChild(picker.root);
    const hint = picker.root.querySelector<HTMLElement>('.pattern-offline-hint');
    expect(hint?.hidden).toBe(false);
    expect(hint?.textContent).toMatch(/unreachable/i);
    expect(picker.root.querySelector('.pattern-toggle-name')?.textContent).toMatch(/starter/i);
    picker.dispose();
  });

  it('picks an entry and closes the popover', () => {
    const onPick = vi.fn();
    const picker = attachPatternPicker({ entries: ENTRIES, onPick });
    document.body.appendChild(picker.root);
    const toggle = picker.root.querySelector<HTMLButtonElement>('.pattern-toggle')!;
    const popover = picker.root.querySelector<HTMLElement>('.pattern-popover')!;
    expect(popover.hidden).toBe(true);
    toggle.click();
    expect(popover.hidden).toBe(false);
    picker.root.querySelectorAll<HTMLElement>('.pattern-entry')[0]!.click();
    expect(onPick).toHaveBeenCalledWith('user:mine');
    expect(popover.hidden).toBe(true);
    picker.dispose();
  });
});
