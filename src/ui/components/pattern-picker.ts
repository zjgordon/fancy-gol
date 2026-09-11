/**
 * P2-B-4's interim toolbar picker. P2-B-3's virtualised library panel is the real
 * catalogue surface; this file stays as a testable listbox, not a second library.
 */
export type PatternOrigin = 'curated' | 'user' | 'bundled';

export interface PatternPickerEntry {
  readonly id: string;
  readonly name: string;
  readonly origin: PatternOrigin;
  readonly description?: string;
}

export type PatternPickerSource = 'api' | 'bundled';

export interface PatternPickerOptions {
  readonly entries: readonly PatternPickerEntry[];
  readonly source?: PatternPickerSource;
  readonly onPick: (id: string) => void;
}

export interface PatternPicker {
  readonly root: HTMLElement;
  setEntries(entries: readonly PatternPickerEntry[], source?: PatternPickerSource): void;
  dispose(): void;
}

const ORIGIN_LABEL: Record<PatternOrigin, string> = {
  user: 'yours',
  curated: 'catalogue',
  bundled: 'starter',
};

export function attachPatternPicker(options: PatternPickerOptions): PatternPicker {
  let entries = options.entries;
  let source: PatternPickerSource = options.source ?? 'api';
  let isOpen = false;
  let highlightedId: string | null = entries[0]?.id ?? null;

  const root = document.createElement('div');
  root.className = 'pattern-picker';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pattern-toggle';
  toggle.setAttribute('aria-haspopup', 'listbox');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Pattern library');
  const toggleName = document.createElement('span');
  toggleName.className = 'pattern-toggle-name';
  toggleName.textContent = 'Library';
  toggle.appendChild(toggleName);

  const popover = document.createElement('div');
  popover.className = 'pattern-popover chrome-panel';
  popover.hidden = true;

  const hint = document.createElement('p');
  hint.className = 'pattern-offline-hint';

  const listbox = document.createElement('div');
  listbox.className = 'pattern-listbox';
  listbox.tabIndex = 0;
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Pattern library');

  popover.append(hint, listbox);
  root.append(toggle, popover);

  function visibleEntries(): readonly PatternPickerEntry[] {
    const yours = entries.filter((e) => e.origin === 'user');
    const rest = entries.filter((e) => e.origin !== 'user');
    return [...yours, ...rest];
  }

  function paint(): void {
    hint.hidden = source !== 'bundled';
    hint.textContent =
      source === 'bundled' ? 'Starter set — the server is unreachable. Saved patterns will return with it.' : '';
    listbox.replaceChildren();
    const visible = visibleEntries();
    let lastGroup: 'yours' | 'library' | null = null;
    for (const entry of visible) {
      const group = entry.origin === 'user' ? 'yours' : 'library';
      if (group !== lastGroup) {
        lastGroup = group;
        const title = document.createElement('div');
        title.className = 'pattern-group-title';
        title.textContent = group === 'yours' ? 'Yours' : source === 'bundled' ? 'Starter set' : 'Catalogue';
        listbox.appendChild(title);
      }
      const row = document.createElement('div');
      row.className = 'pattern-entry';
      row.setAttribute('role', 'option');
      row.dataset['id'] = entry.id;
      row.setAttribute('aria-selected', entry.id === highlightedId ? 'true' : 'false');
      if (entry.id === highlightedId) row.classList.add('pattern-entry--highlighted');

      const name = document.createElement('span');
      name.className = 'pattern-entry-name';
      name.textContent = entry.name;

      const badge = document.createElement('span');
      badge.className = `pattern-origin pattern-origin--${entry.origin}`;
      badge.textContent = ORIGIN_LABEL[entry.origin];

      row.append(name, badge);
      row.addEventListener('click', () => {
        highlightedId = entry.id;
        close();
        options.onPick(entry.id);
      });
      listbox.appendChild(row);
    }
    toggleName.textContent = source === 'bundled' ? 'Library · starter' : 'Library';
  }

  function setHighlighted(id: string | null): void {
    highlightedId = id;
    for (const row of listbox.querySelectorAll<HTMLElement>('.pattern-entry')) {
      const on = row.dataset['id'] === id;
      row.classList.toggle('pattern-entry--highlighted', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  function onOutsidePointerDown(e: Event): void {
    if (e.target instanceof Node && root.contains(e.target)) return;
    close();
  }

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    popover.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    listbox.focus();
    window.addEventListener('pointerdown', onOutsidePointerDown);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    popover.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', onOutsidePointerDown);
  }

  toggle.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  listbox.addEventListener('keydown', (e) => {
    const visible = visibleEntries();
    if (visible.length === 0) return;
    const idx = Math.max(0, visible.findIndex((p) => p.id === highlightedId));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(visible[(idx + 1) % visible.length]!.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(visible[(idx - 1 + visible.length) % visible.length]!.id);
    } else if (e.key === 'Enter' && highlightedId) {
      e.preventDefault();
      close();
      options.onPick(highlightedId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  paint();

  return {
    root,
    setEntries(next, nextSource) {
      entries = next;
      if (nextSource) source = nextSource;
      highlightedId = next[0]?.id ?? null;
      paint();
    },
    dispose() {
      close();
      root.remove();
    },
  };
}
