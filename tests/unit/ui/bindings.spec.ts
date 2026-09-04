import { describe, expect, it } from 'vitest';
import { createAppContext } from '../../../src/client/app-context';
import { CommandBus } from '@ui/commands/bus';
import { CommandRegistry, type AppCommand } from '@ui/commands/registry';
import { PHASE_1_BINDINGS, attachDefaultBindings } from '@ui/input/bindings';
import { attachKeymap, canonicalizeBinding, Keymap, type KeymapTarget } from '@ui/input/keymap';

class FakeTarget implements KeymapTarget {
  private readonly listeners = new Set<(e: KeyboardEvent) => void>();
  addEventListener(_type: 'keydown', listener: (e: KeyboardEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'keydown', listener: (e: KeyboardEvent) => void): void {
    this.listeners.delete(listener);
  }
  dispatch(e: object): void {
    for (const fn of this.listeners) fn(e as KeyboardEvent);
  }
}

function key(k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean }> = {}) {
  return {
    key: k,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: false,
    altKey: false,
    shiftKey: mods.shiftKey ?? false,
    target: null,
    preventDefault: () => {},
  };
}

function fixtureCommand(id: string): AppCommand {
  return { id, title: id, category: 'Tools', noBinding: true, run: () => {} };
}

describe('PHASE_1_BINDINGS', () => {
  it('every entry parses on both macOS and non-macOS, proving the table itself is syntactically valid', () => {
    for (const entry of PHASE_1_BINDINGS) {
      expect(() => canonicalizeBinding(entry.binding, true)).not.toThrow();
      expect(() => canonicalizeBinding(entry.binding, false)).not.toThrow();
    }
  });

  it('contains no internal collisions when registered all at once', () => {
    for (const isMac of [true, false]) {
      const keymap = new Keymap(() => isMac);
      expect(() => {
        for (const entry of PHASE_1_BINDINGS) keymap.register(entry);
      }).not.toThrow();
      expect(keymap.list()).toHaveLength(PHASE_1_BINDINGS.length);
    }
  });

  it('deliberately omits the two Phase-4-marked entries (Step back, Command palette)', () => {
    const ids = PHASE_1_BINDINGS.map((e) => e.commandId);
    expect(ids).not.toContain('sim.stepBack');
    expect(ids.some((id) => id.toLowerCase().includes('palette'))).toBe(false);
  });

  it('merges the Shift+/ / ? collision into a single ? -> help.cheatsheet entry', () => {
    const helpEntries = PHASE_1_BINDINGS.filter((e) => e.commandId === 'help.cheatsheet');
    expect(helpEntries).toHaveLength(1);
    expect(helpEntries[0]!.binding).toBe('?');
    expect(PHASE_1_BINDINGS.some((e) => e.binding === 'Shift+/')).toBe(false);
  });

  it('includes all nine brush-size bindings with the matching numeric arg', () => {
    const sizeEntries = PHASE_1_BINDINGS.filter((e) => e.commandId === 'brush.setSize');
    expect(sizeEntries).toHaveLength(9);
    for (let i = 1; i <= 9; i++) {
      expect(sizeEntries.find((e) => e.binding === String(i))?.arg).toBe(i);
    }
  });
});

describe('attachDefaultBindings', () => {
  it('registers nothing against an empty registry', () => {
    const keymap = new Keymap(() => false);
    const count = attachDefaultBindings(keymap, new CommandRegistry());
    expect(count).toBe(0);
    expect(keymap.list()).toHaveLength(0);
  });

  it('registers only the entries whose command exists today (the 8 tool.select.* commands)', () => {
    const registry = new CommandRegistry();
    for (const id of ['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'select', 'stamp']) {
      registry.register(fixtureCommand(`tool.select.${id}`));
    }
    const keymap = new Keymap(() => false);
    const count = attachDefaultBindings(keymap, registry);
    expect(count).toBe(8);
    expect(keymap.match(['B'])?.commandId).toBe('tool.select.brush');
    expect(keymap.match(['[' /* sim.speedDown */])).toBeUndefined(); // not registered: command doesn't exist
  });

  it('registers every entry once every command in the table exists (nothing silently missed)', () => {
    const registry = new CommandRegistry();
    for (const entry of PHASE_1_BINDINGS) {
      if (!registry.get(entry.commandId)) registry.register(fixtureCommand(entry.commandId));
    }
    const keymap = new Keymap(() => false);
    const count = attachDefaultBindings(keymap, registry);
    expect(count).toBe(PHASE_1_BINDINGS.length);
  });

  it('end-to-end: createAppContext()\'s real registry wires up and dispatches a real tool.select binding', async () => {
    const { context, registry } = createAppContext();
    const keymap = new Keymap(() => false);
    const registeredCount = attachDefaultBindings(keymap, registry);
    expect(registeredCount).toBe(8); // only the tool.select.* commands exist today

    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    attachKeymap(keymap, target, bus);

    target.dispatch(key('g')); // 'G' -> tool.select.fill
    // attachKeymap's bus.run() is fire-and-forget internally; give the microtask a tick.
    await Promise.resolve();
    expect(context.toolRegistry.active?.id).toBe('fill');

    target.dispatch(key('s')); // 'S' -> tool.select.select
    await Promise.resolve();
    expect(context.toolRegistry.active?.id).toBe('select');
  });
});
