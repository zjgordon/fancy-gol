/**
 * P1-D-4 — the ruleset picker: a toolbar toggle button opening a keyboard-navigable, type-ahead
 * searchable list of the built-in catalogue, grouped by tag, each entry showing its name,
 * notation (when it has one), state count, description, and a live animated 32×32 thumbnail —
 * the "Stay Fancy" answer to what would otherwise be a `<select>`.
 *
 * `ui/` cannot reach `engine/` or `render/canvas2d` (ADR-009: only `render/types`), so this
 * component cannot itself run a thumbnail's `Simulation`/`Canvas2DRenderer` — it only creates
 * each entry's `<canvas>` and hands it to the caller via `onThumbnailCreated`, then reports
 * open/close through `onOpenChange` so `client/main.ts` (which can reach both) knows exactly
 * when to animate into them and when to stop — "thumbnails run only while the picker is open"
 * (P1-D-4's own acceptance criterion) is enforced by that caller, not by a timer in here.
 *
 * The state-migration prompt is a small, self-contained overlay built directly in this file —
 * P1-D-5 ("Toasts, dialogs, tooltips") doesn't exist yet, and this is the first task that
 * genuinely needs a modal. Provisional, like every other piece of infrastructure this phase has
 * built ahead of its own dedicated task (P1-D-1's tokens, P1-D-2's `store.ts` gap): a real focus
 * trap and `Escape`-to-close, `role="dialog"`/`aria-modal`, but not sharing code with whatever
 * P1-D-5 eventually builds — that task can fold this one in in, or leave it, once it exists.
 */
import type { StateDef, StateId } from '@shared/types';

export interface RulesetSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** The Life-family B/S(/G) notation, when this ruleset has one (`BuiltinRuleSet.notation`). */
  readonly notation?: string;
  readonly states: readonly StateDef[];
  /** Grouped by the first tag — a ruleset with more than one only ever heads its first group. */
  readonly tags: readonly string[];
}

/** Two palettes are compatible (no migration needed) iff they agree, in order, on every state's
 * id/kind/name — the same signature `engine/simulation.ts`'s own (non-exported) palette-equality
 * check uses, duplicated here since `ui/` cannot import `engine/` (ADR-009). */
export function palettesMatch(a: readonly StateDef[], b: readonly StateDef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i]!.id && s.kind === b[i]!.kind && s.name === b[i]!.name);
}

/**
 * "Sensible defaults preselected" (P1-D-4's own acceptance criterion): every `dead`-kind old
 * state maps to the new dead state (id 0, guaranteed present — every `RuleSet`'s own contract).
 * Every other old state maps to a new state of the *same* `kind` if one exists (Conway's `alive`,
 * kind `live`, → WireWorld's `electron-head`, also kind `live` — both rules' "the active state"),
 * else to the new ruleset's primary live state, else to dead. Never a guess dressed up as
 * certainty: this is a starting point the migration dialog always lets the user override before
 * confirming, per state.
 */
export function defaultMigration(
  oldStates: readonly StateDef[],
  newStates: readonly StateDef[],
): ReadonlyMap<StateId, StateId> {
  const newDead = newStates.find((s) => s.kind === 'dead')?.id ?? 0;
  const newPrimaryLive = newStates.find((s) => s.countsAsAlive)?.id ?? newDead;
  const map = new Map<StateId, StateId>();
  for (const old of oldStates) {
    if (old.kind === 'dead') {
      map.set(old.id, newDead);
      continue;
    }
    const sameKind = newStates.find((s) => s.kind === old.kind);
    map.set(old.id, sameKind ? sameKind.id : newPrimaryLive);
  }
  return map;
}

export interface RulesetPickerOptions {
  readonly entries: readonly RulesetSummary[];
  readonly activeId: string;
  /** Called once per entry, synchronously during construction, with the `<canvas>` this
   * component created for it. The caller owns everything drawn into it. */
  readonly onThumbnailCreated: (id: string, canvas: HTMLCanvasElement) => void;
  /** `true` right after the popover opens, `false` right before it closes. */
  readonly onOpenChange: (open: boolean) => void;
  /** Called once the user has confirmed a switch: immediately for a compatible palette, or after
   * the migration dialog is confirmed for an incompatible one (in which case `migration` is the
   * user's final, possibly-edited mapping — never omitted for an incompatible switch). */
  readonly onConfirm: (id: string, migration?: ReadonlyMap<StateId, StateId>) => void;
}

export interface RulesetPicker {
  readonly root: HTMLElement;
  readonly open: boolean;
  setActive(id: string): void;
  dispose(): void;
}

const TYPEAHEAD_RESET_MS = 600;

function groupByFirstTag(entries: readonly RulesetSummary[]): ReadonlyMap<string, readonly RulesetSummary[]> {
  const groups = new Map<string, RulesetSummary[]>();
  for (const entry of entries) {
    const tag = entry.tags[0] ?? 'other';
    let group = groups.get(tag);
    if (!group) {
      group = [];
      groups.set(tag, group);
    }
    group.push(entry);
  }
  return groups;
}

function stateMeta(entry: RulesetSummary): string {
  const count = `${entry.states.length} state${entry.states.length === 1 ? '' : 's'}`;
  return entry.notation ? `${entry.notation} · ${count}` : count;
}

function optionElementId(id: string): string {
  return `ruleset-option-${id}`;
}

export function attachRulesetPicker(options: RulesetPickerOptions): RulesetPicker {
  const groups = groupByFirstTag(options.entries);
  const flattened = options.entries;
  const byId = new Map(options.entries.map((e) => [e.id, e]));

  let activeId = options.activeId;
  let highlightedId = activeId;
  let isOpen = false;
  let typeaheadBuffer = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  const root = document.createElement('div');
  root.className = 'ruleset-picker';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ruleset-toggle';
  toggle.setAttribute('aria-haspopup', 'listbox');
  toggle.setAttribute('aria-expanded', 'false');

  const toggleName = document.createElement('span');
  toggleName.className = 'ruleset-toggle-name';
  const toggleCaret = document.createElement('span');
  toggleCaret.className = 'ruleset-toggle-caret';
  toggleCaret.textContent = '▾';
  toggleCaret.setAttribute('aria-hidden', 'true');
  toggle.append(document.createTextNode('Ruleset: '), toggleName, toggleCaret);

  const popover = document.createElement('div');
  popover.className = 'ruleset-popover chrome-panel';
  popover.hidden = true;

  const listbox = document.createElement('div');
  listbox.className = 'ruleset-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Rulesets');
  listbox.tabIndex = 0;

  const optionEls = new Map<string, HTMLElement>();
  for (const [tag, groupEntries] of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'ruleset-group';
    const title = document.createElement('h3');
    title.className = 'ruleset-group-title';
    title.textContent = tag;
    groupEl.appendChild(title);

    for (const entry of groupEntries) {
      const optionEl = document.createElement('div');
      optionEl.className = 'ruleset-entry';
      optionEl.id = optionElementId(entry.id);
      optionEl.setAttribute('role', 'option');
      optionEl.setAttribute('aria-selected', String(entry.id === activeId));
      optionEl.dataset['id'] = entry.id;

      const canvas = document.createElement('canvas');
      canvas.className = 'ruleset-thumb';
      canvas.width = 48;
      canvas.height = 48;
      canvas.setAttribute('aria-hidden', 'true');

      const info = document.createElement('div');
      info.className = 'ruleset-entry-info';
      const name = document.createElement('span');
      name.className = 'ruleset-entry-name';
      name.textContent = entry.name;
      const meta = document.createElement('span');
      meta.className = 'ruleset-entry-meta';
      meta.textContent = stateMeta(entry);
      info.append(name, meta);
      if (entry.description) {
        const desc = document.createElement('span');
        desc.className = 'ruleset-entry-desc';
        desc.textContent = entry.description;
        info.appendChild(desc);
      }

      optionEl.append(canvas, info);
      optionEl.addEventListener('click', () => attemptSelect(entry.id));
      groupEl.appendChild(optionEl);
      optionEls.set(entry.id, optionEl);
      options.onThumbnailCreated(entry.id, canvas);
    }
    listbox.appendChild(groupEl);
  }

  popover.appendChild(listbox);
  root.append(toggle, popover);

  // --- The migration dialog -------------------------------------------------------------

  const migrationOverlay = document.createElement('div');
  migrationOverlay.className = 'ruleset-migration-overlay';
  migrationOverlay.hidden = true;

  const migrationDialog = document.createElement('div');
  migrationDialog.className = 'ruleset-migration chrome-panel';
  migrationDialog.setAttribute('role', 'dialog');
  migrationDialog.setAttribute('aria-modal', 'true');

  const migrationTitle = document.createElement('h3');
  migrationDialog.appendChild(migrationTitle);
  const migrationHint = document.createElement('p');
  migrationHint.className = 'ruleset-migration-hint';
  migrationHint.textContent = 'These states don’t match. Choose where each one goes.';
  migrationDialog.appendChild(migrationHint);

  const migrationRows = document.createElement('div');
  migrationRows.className = 'ruleset-migration-rows';
  migrationDialog.appendChild(migrationRows);

  const migrationControls = document.createElement('div');
  migrationControls.className = 'controls';
  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.textContent = 'Apply';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  migrationControls.append(applyButton, cancelButton);
  migrationDialog.appendChild(migrationControls);

  migrationOverlay.appendChild(migrationDialog);
  // A portal, not a child of `root`: `root` lives inside `#chrome-toolbar`, and every
  // `.chrome-region` sets `transform` (for its own centring/intro choreography) — a `transform`
  // on any ancestor creates a new containing block for a `position: fixed` descendant, which
  // pins `inset: 0` to *that* ancestor's box instead of the viewport, not centring at all.
  // Caught live in a browser (jsdom, this component's unit-test environment, never lays out real
  // `transform`s). `document.body` has no such ancestor, so this dialog actually centres.
  document.body.appendChild(migrationOverlay);

  let pendingMigrationTarget: RulesetSummary | null = null;
  let migrationSelects: ReadonlyArray<{ readonly oldState: StateDef; readonly select: HTMLSelectElement }> = [];

  function openMigration(target: RulesetSummary): void {
    const current = byId.get(activeId);
    if (!current) return;
    pendingMigrationTarget = target;
    migrationTitle.textContent = `Switch to ${target.name}`;
    migrationRows.replaceChildren();

    const defaults = defaultMigration(current.states, target.states);
    const rows: Array<{ readonly oldState: StateDef; readonly select: HTMLSelectElement }> = [];
    for (const oldState of current.states) {
      const row = document.createElement('div');
      row.className = 'ruleset-migration-row';
      const label = document.createElement('label');
      const select = document.createElement('select');
      select.id = `ruleset-migration-${oldState.id}`;
      label.htmlFor = select.id;
      label.textContent = oldState.name;
      for (const newState of target.states) {
        const option = document.createElement('option');
        option.value = String(newState.id);
        option.textContent = newState.name;
        select.appendChild(option);
      }
      select.value = String(defaults.get(oldState.id) ?? 0);
      row.append(label, select);
      migrationRows.appendChild(row);
      rows.push({ oldState, select });
    }
    migrationSelects = rows;

    popover.hidden = true;
    migrationOverlay.hidden = false;
    applyButton.focus();
  }

  function closeMigration(): void {
    migrationOverlay.hidden = true;
    pendingMigrationTarget = null;
  }

  applyButton.addEventListener('click', () => {
    if (!pendingMigrationTarget) return;
    const migration = new Map<StateId, StateId>();
    for (const { oldState, select } of migrationSelects) migration.set(oldState.id, Number(select.value));
    const targetId = pendingMigrationTarget.id;
    closeMigration();
    close();
    options.onConfirm(targetId, migration);
  });

  cancelButton.addEventListener('click', () => {
    closeMigration();
    close();
  });

  migrationDialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMigration();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // A minimal focus trap: cycle Tab/Shift+Tab within the dialog's own focusable elements —
    // provisional until P1-D-5's shared dialog primitive exists (see this file's module doc).
    const focusable = migrationDialog.querySelectorAll<HTMLElement>('select, button');
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // --- Selection --------------------------------------------------------------------------

  function attemptSelect(id: string): void {
    if (id === activeId) {
      close();
      return;
    }
    const current = byId.get(activeId);
    const target = byId.get(id);
    if (!current || !target) return;
    if (palettesMatch(current.states, target.states)) {
      close();
      options.onConfirm(id);
      return;
    }
    openMigration(target);
  }

  // --- Open / close -------------------------------------------------------------------------

  function onOutsidePointerDown(e: Event): void {
    // `migrationOverlay` is a portal (appended to `document.body`, not a descendant of `root` —
    // see where it's appended for why), so it needs its own containment check here: without it,
    // a pointerdown on *anything* inside the migration dialog — including its own Apply button —
    // reads as "outside", closing everything on the pointerdown phase, before the button's own
    // click handler ever runs. Caught live in a browser: Apply silently did nothing.
    if (e.target instanceof Node && (root.contains(e.target) || migrationOverlay.contains(e.target))) return;
    close();
  }

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    popover.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    setHighlighted(activeId);
    listbox.focus();
    window.addEventListener('pointerdown', onOutsidePointerDown);
    options.onOpenChange(true);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    popover.hidden = true;
    migrationOverlay.hidden = true;
    pendingMigrationTarget = null;
    toggle.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', onOutsidePointerDown);
    options.onOpenChange(false);
    toggle.focus();
  }

  toggle.addEventListener('click', () => (isOpen ? close() : open()));

  // --- Keyboard: arrow nav, Home/End, Enter/Space, Escape, type-ahead ----------------------

  function setHighlighted(id: string): void {
    const previous = optionEls.get(highlightedId);
    previous?.classList.remove('ruleset-entry--highlighted');
    highlightedId = id;
    const next = optionEls.get(id);
    next?.classList.add('ruleset-entry--highlighted');
    listbox.setAttribute('aria-activedescendant', optionElementId(id));
    // jsdom (this module's test environment) doesn't implement scrollIntoView at all.
    if (typeof next?.scrollIntoView === 'function') next.scrollIntoView({ block: 'nearest' });
  }

  function moveHighlight(delta: number): void {
    const index = flattened.findIndex((e) => e.id === highlightedId);
    const next = (index + delta + flattened.length) % flattened.length;
    setHighlighted(flattened[next]!.id);
  }

  function resetTypeahead(): void {
    typeaheadBuffer = '';
    if (typeaheadTimer !== null) clearTimeout(typeaheadTimer);
    typeaheadTimer = null;
  }

  function typeahead(char: string): void {
    typeaheadBuffer += char.toLowerCase();
    if (typeaheadTimer !== null) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(resetTypeahead, TYPEAHEAD_RESET_MS);

    const startIndex = flattened.findIndex((e) => e.id === highlightedId);
    for (let i = 1; i <= flattened.length; i++) {
      const entry = flattened[(startIndex + i) % flattened.length]!;
      if (entry.name.toLowerCase().startsWith(typeaheadBuffer)) {
        setHighlighted(entry.id);
        return;
      }
    }
  }

  listbox.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveHighlight(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveHighlight(-1);
        return;
      case 'Home':
        e.preventDefault();
        if (flattened[0]) setHighlighted(flattened[0].id);
        return;
      case 'End':
        e.preventDefault();
        if (flattened.length > 0) setHighlighted(flattened[flattened.length - 1]!.id);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        attemptSelect(highlightedId);
        return;
      case 'Escape':
        e.preventDefault();
        close();
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(e.key);
    }
  });

  function setActive(id: string): void {
    const previous = optionEls.get(activeId);
    previous?.setAttribute('aria-selected', 'false');
    activeId = id;
    const entry = byId.get(id);
    toggleName.textContent = entry?.name ?? id;
    optionEls.get(id)?.setAttribute('aria-selected', 'true');
  }
  setActive(activeId);

  return {
    root,
    get open() {
      return isOpen;
    },
    setActive,
    dispose(): void {
      window.removeEventListener('pointerdown', onOutsidePointerDown);
      resetTypeahead();
      migrationOverlay.remove(); // the portal — see where it's appended for why
    },
  };
}
