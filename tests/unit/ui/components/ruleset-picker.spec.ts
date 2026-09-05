import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachRulesetPicker,
  defaultMigration,
  palettesMatch,
  type RulesetSummary,
} from '@ui/components/ruleset-picker';
import type { StateDef, StateId } from '@shared/types';

const CONWAY_STATES: readonly StateDef[] = [
  { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
  { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
];

const HIGHLIFE_STATES: readonly StateDef[] = [
  { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
  { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
];

const BRIANS_BRAIN_STATES: readonly StateDef[] = [
  { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
  { id: 1, name: 'firing', kind: 'live', countsAsAlive: true },
  { id: 2, name: 'refractory', kind: 'decay', countsAsAlive: false },
];

const WIREWORLD_STATES: readonly StateDef[] = [
  { id: 0, name: 'empty', kind: 'dead', countsAsAlive: false },
  { id: 1, name: 'electron-head', kind: 'live', countsAsAlive: true },
  { id: 2, name: 'electron-tail', kind: 'decay', countsAsAlive: false },
  { id: 3, name: 'conductor', kind: 'inert', countsAsAlive: false },
];

const CONWAY: RulesetSummary = {
  id: 'conway',
  name: "Conway's Game of Life",
  description: 'The original.',
  notation: 'B3/S23',
  states: CONWAY_STATES,
  tags: ['stable'],
};

const HIGHLIFE: RulesetSummary = {
  id: 'highlife',
  name: 'HighLife',
  notation: 'B36/S23',
  states: HIGHLIFE_STATES,
  tags: ['chaotic'],
};

const BRIANS_BRAIN: RulesetSummary = {
  id: 'brians-brain',
  name: "Brian's Brain",
  description: 'Three states.',
  states: BRIANS_BRAIN_STATES,
  tags: ['chaotic'],
};

const WIREWORLD: RulesetSummary = {
  id: 'wireworld',
  name: 'WireWorld',
  description: 'Circuits.',
  states: WIREWORLD_STATES,
  tags: ['multi-state', 'stable'],
};

const ENTRIES = [CONWAY, HIGHLIFE, BRIANS_BRAIN, WIREWORLD];

describe('palettesMatch', () => {
  it('is true for two rulesets with the same states, in order', () => {
    expect(palettesMatch(CONWAY_STATES, HIGHLIFE_STATES)).toBe(true);
  });

  it('is false for different state counts', () => {
    expect(palettesMatch(CONWAY_STATES, BRIANS_BRAIN_STATES)).toBe(false);
  });

  it('is false when a name differs even with the same count/kind', () => {
    const renamed: readonly StateDef[] = [CONWAY_STATES[0]!, { ...CONWAY_STATES[1]!, name: 'on' }];
    expect(palettesMatch(CONWAY_STATES, renamed)).toBe(false);
  });
});

describe('defaultMigration', () => {
  it('maps Conway alive to WireWorld electron-head — same kind, "the active state" in both', () => {
    const migration = defaultMigration(CONWAY_STATES, WIREWORLD_STATES);
    expect(migration.get(0)).toBe(0); // dead -> empty
    expect(migration.get(1)).toBe(1); // alive -> electron-head
  });

  it('maps every dead-kind state to the new dead state, regardless of id', () => {
    const migration = defaultMigration(BRIANS_BRAIN_STATES, WIREWORLD_STATES);
    expect(migration.get(0)).toBe(0); // dead -> empty
  });

  it('falls back to the new primary live state when no same-kind state exists', () => {
    // Brian's Brain "refractory" is kind 'decay'; WireWorld has a 'decay' state too (electron-tail),
    // so this exercises the same-kind branch — construct a target with no 'decay' state at all to
    // exercise the fallback.
    const noDecay: readonly StateDef[] = [
      { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
      { id: 1, name: 'on', kind: 'live', countsAsAlive: true },
    ];
    const migration = defaultMigration(BRIANS_BRAIN_STATES, noDecay);
    expect(migration.get(2)).toBe(1); // refractory (decay) -> falls back to the primary live state
  });

  it('covers every old state with an entry', () => {
    const migration = defaultMigration(WIREWORLD_STATES, CONWAY_STATES);
    expect(migration.size).toBe(WIREWORLD_STATES.length);
    for (const s of WIREWORLD_STATES) expect(migration.has(s.id)).toBe(true);
  });
});

function setup(entries: readonly RulesetSummary[] = ENTRIES, activeId = 'conway') {
  const onThumbnailCreated = vi.fn();
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn<(id: string, migration?: ReadonlyMap<StateId, StateId>) => void>();
  const picker = attachRulesetPicker({ entries, activeId, onThumbnailCreated, onOpenChange, onConfirm });
  document.body.appendChild(picker.root);
  return { picker, onThumbnailCreated, onOpenChange, onConfirm };
}

function pressKey(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('attachRulesetPicker', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '';
  });

  it('creates one thumbnail canvas per entry and hands each to onThumbnailCreated', () => {
    const { picker, onThumbnailCreated } = setup();
    cleanup = () => picker.dispose();
    expect(onThumbnailCreated).toHaveBeenCalledTimes(ENTRIES.length);
    for (const entry of ENTRIES) {
      const call = onThumbnailCreated.mock.calls.find((c) => c[0] === entry.id);
      expect(call?.[1]).toBeInstanceOf(HTMLCanvasElement);
    }
  });

  it('groups entries by their first tag', () => {
    const { picker } = setup();
    cleanup = () => picker.dispose();
    const groupTitles = [...picker.root.querySelectorAll('.ruleset-group-title')].map((el) => el.textContent);
    expect(groupTitles).toEqual(['stable', 'chaotic', 'multi-state']); // first-seen tag order
    const stableGroup = picker.root.querySelector('.ruleset-group')!;
    expect(stableGroup.querySelectorAll('.ruleset-entry')).toHaveLength(1); // only Conway
  });

  it('starts closed, and the toggle button opens the popover', () => {
    const { picker, onOpenChange } = setup();
    cleanup = () => picker.dispose();
    const popover = picker.root.querySelector<HTMLElement>('.ruleset-popover')!;
    const toggle = picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!;
    expect(popover.hidden).toBe(true);
    expect(picker.open).toBe(false);

    toggle.click();
    expect(popover.hidden).toBe(false);
    expect(picker.open).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(onOpenChange).toHaveBeenCalledWith(true);

    toggle.click();
    expect(popover.hidden).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the active ruleset\'s name on the toggle, kept in sync by setActive', () => {
    const { picker } = setup();
    cleanup = () => picker.dispose();
    expect(picker.root.querySelector('.ruleset-toggle-name')!.textContent).toBe("Conway's Game of Life");
    picker.setActive('wireworld');
    expect(picker.root.querySelector('.ruleset-toggle-name')!.textContent).toBe('WireWorld');
  });

  it('a click on an entry with a compatible palette confirms immediately and closes', () => {
    const { picker, onConfirm } = setup();
    cleanup = () => picker.dispose();
    picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
    picker.root.querySelector<HTMLElement>('#ruleset-option-highlife')!.click();
    expect(onConfirm).toHaveBeenCalledWith('highlife');
    expect(picker.open).toBe(false);
  });

  it('re-clicking the already-active entry just closes, without confirming again', () => {
    const { picker, onConfirm } = setup();
    cleanup = () => picker.dispose();
    picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
    picker.root.querySelector<HTMLElement>('#ruleset-option-conway')!.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(picker.open).toBe(false);
  });

  describe('the migration prompt', () => {
    // The generic focus-trap/Escape/portal *mechanics* are dialog.ts's own responsibility and
    // are proven there (dialog.spec.ts) — these tests cover only what's specific to this
    // component: building the right content into the shared dialog, and wiring its Apply/Cancel/
    // onClose into onConfirm and the picker's own open/close state correctly.

    it('opens instead of confirming when the target palette is incompatible, with sensible defaults preselected', () => {
      const { picker, onConfirm } = setup();
      cleanup = () => picker.dispose();
      picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
      picker.root.querySelector<HTMLElement>('#ruleset-option-wireworld')!.click();

      expect(onConfirm).not.toHaveBeenCalled();
      // The migration dialog is a portal (dialog.ts's openDialog, appended to document.body),
      // not a descendant of picker.root.
      expect(document.querySelector('.dialog-panel h3')!.textContent).toContain('WireWorld');

      const selects = [...document.querySelectorAll<HTMLSelectElement>('.ruleset-migration-row select')];
      expect(selects).toHaveLength(2); // Conway has two states
      expect(selects[0]!.value).toBe('0'); // dead -> empty (default)
      expect(selects[1]!.value).toBe('1'); // alive -> electron-head (default)
    });

    it('Apply confirms with the (possibly-edited) migration and closes everything', () => {
      const { picker, onConfirm } = setup();
      cleanup = () => picker.dispose();
      picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
      picker.root.querySelector<HTMLElement>('#ruleset-option-wireworld')!.click();

      // Edit: map "alive" to "conductor" (id 3) instead of the default electron-head.
      const aliveSelect = document.querySelectorAll<HTMLSelectElement>('.ruleset-migration-row select')[1]!;
      aliveSelect.value = '3';

      document.querySelector<HTMLButtonElement>('.dialog-controls button')!.click(); // Apply is first
      expect(onConfirm).toHaveBeenCalledTimes(1);
      const [id, migration] = onConfirm.mock.calls[0]!;
      expect(id).toBe('wireworld');
      expect(migration).toEqual(
        new Map([
          [0, 0],
          [1, 3],
        ]),
      );
      expect(document.querySelector('.dialog-panel')).toBeNull(); // torn down, not merely hidden
      expect(picker.open).toBe(false);
    });

    it('a real pointerdown+click on Apply still confirms — the outside-pointerdown-closes listener must not treat the (portalled) dialog itself as "outside"', () => {
      // `element.click()` alone only synthesises a `click` event, skipping the `pointerdown` a
      // real click always fires first — which is exactly what let a real regression slip past
      // every other test in this file: the global outside-pointerdown-closes listener saw the
      // migration dialog's own portal (appended to document.body, not a descendant of
      // picker.root) as "outside", closing everything and nulling the pending target *before*
      // Apply's own click handler ran, so it silently no-opped. Caught live in a browser.
      const { picker, onConfirm } = setup();
      cleanup = () => picker.dispose();
      picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
      picker.root.querySelector<HTMLElement>('#ruleset-option-wireworld')!.click();

      const applyButton = document.querySelector<HTMLButtonElement>('.dialog-controls button')!;
      applyButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      applyButton.click();

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm.mock.calls[0]![0]).toBe('wireworld');
    });

    it('Cancel discards the mapping — onConfirm is never called', () => {
      const { picker, onConfirm } = setup();
      cleanup = () => picker.dispose();
      picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
      picker.root.querySelector<HTMLElement>('#ruleset-option-wireworld')!.click();

      const [, cancelButton] = document.querySelectorAll<HTMLButtonElement>('.dialog-controls button');
      cancelButton!.click();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(document.querySelector('.dialog-panel')).toBeNull();
      expect(picker.open).toBe(false); // Cancel closes the whole picker, not just the dialog
    });

    it('Escape inside the dialog closes it (and the picker), without confirming', () => {
      const { picker, onConfirm } = setup();
      cleanup = () => picker.dispose();
      picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
      picker.root.querySelector<HTMLElement>('#ruleset-option-wireworld')!.click();

      document
        .querySelector<HTMLElement>('.dialog-panel')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(onConfirm).not.toHaveBeenCalled();
      expect(document.querySelector('.dialog-panel')).toBeNull();
      expect(picker.open).toBe(false);
    });
  });

  describe('keyboard navigation', () => {
    it('ArrowDown/ArrowUp move aria-activedescendant across the flattened list, wrapping', () => {
      const { picker } = setup();
      cleanup = () => picker.dispose();
      const toggle = picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!;
      const listbox = picker.root.querySelector<HTMLElement>('.ruleset-listbox')!;
      toggle.click();
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-conway');

      pressKey(listbox, 'ArrowDown');
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-highlife');

      pressKey(listbox, 'ArrowUp');
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-conway');

      pressKey(listbox, 'ArrowUp'); // wraps to the last entry
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-wireworld');
    });

    it('Home/End jump to the first/last entry', () => {
      const { picker } = setup();
      cleanup = () => picker.dispose();
      const toggle = picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!;
      const listbox = picker.root.querySelector<HTMLElement>('.ruleset-listbox')!;
      toggle.click();

      pressKey(listbox, 'End');
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-wireworld');
      pressKey(listbox, 'Home');
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-conway');
    });

    it('Enter selects the highlighted entry', () => {
      const { picker, onConfirm } = setup();
      cleanup = () => picker.dispose();
      const toggle = picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!;
      const listbox = picker.root.querySelector<HTMLElement>('.ruleset-listbox')!;
      toggle.click();
      pressKey(listbox, 'ArrowDown'); // -> highlife (compatible palette)
      pressKey(listbox, 'Enter');
      expect(onConfirm).toHaveBeenCalledWith('highlife');
    });

    it('Escape closes the popover', () => {
      const { picker } = setup();
      cleanup = () => picker.dispose();
      const toggle = picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!;
      const listbox = picker.root.querySelector<HTMLElement>('.ruleset-listbox')!;
      toggle.click();
      expect(picker.open).toBe(true);
      pressKey(listbox, 'Escape');
      expect(picker.open).toBe(false);
    });

    it('type-ahead jumps to the next entry whose name starts with the typed letters', () => {
      const { picker } = setup();
      cleanup = () => picker.dispose();
      const toggle = picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!;
      const listbox = picker.root.querySelector<HTMLElement>('.ruleset-listbox')!;
      toggle.click(); // highlighted starts at "conway"

      pressKey(listbox, 'w'); // -> "WireWorld"
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-wireworld');

      pressKey(listbox, 'i'); // buffer "wi" still matches "WireWorld"
      expect(listbox.getAttribute('aria-activedescendant')).toBe('ruleset-option-wireworld');
    });
  });

  it('a pointerdown outside the picker closes it', () => {
    const { picker } = setup();
    cleanup = () => picker.dispose();
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
    expect(picker.open).toBe(true);

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(picker.open).toBe(false);
  });

  it('dispose() removes the outside-pointerdown listener', () => {
    const { picker } = setup();
    picker.root.querySelector<HTMLButtonElement>('.ruleset-toggle')!.click();
    expect(picker.open).toBe(true);
    picker.dispose();

    // The listener close() itself installs is removed by close()/dispose() either way; this
    // proves dispose() doesn't leave a dangling window listener that would throw or misfire
    // after the component's own lifecycle has ended.
    expect(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))).not.toThrow();
  });
});

/**
 * P1-D-4's "thumbnails run only while the picker is open and cost < 2 ms/frame combined"
 * acceptance criterion. The "only while open" half is a resource-lifecycle property of
 * `client/main.ts` (creates a `{Simulation, Canvas2DRenderer}` bundle per entry on
 * `onOpenChange(true)`, disposes them all on `onOpenChange(false)`) — outside this component's
 * own file, and `client/**` is excluded from coverage/unit testing by this project's own
 * convention (P1-D-1 through P1-D-3 all left their composition-root wiring to this same
 * treatment). The cost budget is proven here instead, against the real operation
 * `client/main.ts` actually performs each throttled tick: stepping a real 32×32 `Simulation` for
 * a rotating batch of catalogue entries, not all 14 at once — measured directly, not assumed:
 * an earlier version of this test discovered that stepping all 14 in one frame costs ~2.9 ms
 * combined (a tiny grid's *fixed* per-step overhead dominates over its cell count, so "32×32 is
 * tiny, therefore cheap" doesn't hold once multiplied by 14) — `client/main.ts`'s
 * `THUMBNAIL_BATCH_SIZE` (4) exists specifically to keep any single frame's cost well under
 * budget; this test holds that same batch size to the same budget. Drawing is not re-measured
 * here — `render/canvas2d.spec.ts`'s own frame-time-budget tests already establish
 * `Canvas2DRenderer.draw()` costs are small even for grids far larger than a 32×32 thumbnail, so
 * a batch of those draws adds negligibly next to the stepping cost measured below.
 */
describe('thumbnail performance (client/main.ts\'s per-frame cost, P1-D-4 AC1)', () => {
  /** Mirrors `client/main.ts`'s own `THUMBNAIL_BATCH_SIZE` — not imported from it, since
   * `main.ts` runs `main()` as an import side effect (a real DOM/worker boot) and can't be
   * imported from a test. */
  const THUMBNAIL_BATCH_SIZE = 4;

  it.skipIf(process.env['VITEST_COVERAGE'] === '1')(
    `stepping a batch of ${THUMBNAIL_BATCH_SIZE} 32x32 Simulations costs well under the 2 ms/frame combined budget`,
    async () => {
      // Deliberately the catalogue's four structurally *heaviest* transition kinds, not an
      // arbitrary slice — WireWorld's 262,144-entry state table and Highlands' weighted-threshold
      // evaluation are the most expensive per-cell work in the catalogue; a real-world batch is
      // never worse than this one, since `client/main.ts`'s round-robin only ever steps a batch
      // this size or smaller.
      const { BRIANS_BRAIN, HIGHLANDS_LIQUID, STAR_WARS, WIREWORLD } = await import('@engine/rules/builtin');
      const { Simulation } = await import('@engine/simulation');
      const WORLD = 32;

      const sims = [BRIANS_BRAIN, HIGHLANDS_LIQUID, STAR_WARS, WIREWORLD].map((ruleset) => {
        const sim = new Simulation({ ruleset, width: WORLD, height: WORLD, seed: 7 });
        sim.seedRandom(0.3, 7);
        return sim;
      });
      expect(sims).toHaveLength(THUMBNAIL_BATCH_SIZE);

      // Warm-up: steady-state JIT cost, not first-call compilation (this file's own convention).
      for (let i = 0; i < 10; i++) for (const sim of sims) sim.step();

      const iterations = 200;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        for (const sim of sims) sim.step();
      }
      const elapsed = performance.now() - start;
      expect(elapsed / iterations).toBeLessThan(2);
    },
  );
});
