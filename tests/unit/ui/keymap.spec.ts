import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@ui/commands/bus';
import { CommandRegistry, type AppCommand, type AppContext } from '@ui/commands/registry';
import {
  attachKeymap,
  canonicalizeBinding,
  Keymap,
  SYSTEM_IS_MAC,
  type KeymapTarget,
  type Timers,
} from '@ui/input/keymap';
import { ToolRegistry } from '@ui/tools/registry';

/** A minimal but functionally real keydown-capable target — same discipline as `gestures.spec.ts`'s `FakeSurface`. */
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
  get listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeTimers implements Timers {
  private handles = new Map<number, () => void>();
  private nextHandle = 1;

  setTimeout(fn: () => void, _ms: number): number {
    const handle = this.nextHandle++;
    this.handles.set(handle, fn);
    return handle;
  }
  clearTimeout(handle: number): void {
    this.handles.delete(handle);
  }
  /** Fires every currently-pending timer, as if its full delay elapsed. */
  fireAll(): void {
    const fns = [...this.handles.values()];
    this.handles.clear();
    for (const fn of fns) fn();
  }
  get pendingCount(): number {
    return this.handles.size;
  }
}

function key(k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target: EventTarget }> = {}) {
  return {
    key: k,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    target: mods.target ?? null,
    preventDefault: () => {},
  };
}

function fixtureRegistryAndContext(commands: readonly AppCommand[]): { registry: CommandRegistry; context: AppContext } {
  const registry = new CommandRegistry();
  for (const c of commands) registry.register(c);
  return { registry, context: { toolRegistry: new ToolRegistry() } };
}

function cmd(id: string, run: (ctx: AppContext, arg?: unknown) => void): AppCommand {
  return { id, title: id, category: 'Tools', noBinding: true, run };
}

describe('canonicalizeBinding', () => {
  it('a bare letter is a single step', () => {
    expect(canonicalizeBinding('B', false)).toEqual(['B']);
  });

  it('resolves Mod to Cmd on macOS and Ctrl elsewhere', () => {
    expect(canonicalizeBinding('Mod+Z', true)).toEqual(['Cmd+Z']);
    expect(canonicalizeBinding('Mod+Z', false)).toEqual(['Ctrl+Z']);
  });

  it('Mod+Z and Mod+Shift+Z canonicalise distinctly', () => {
    expect(canonicalizeBinding('Mod+Z', false)).not.toEqual(canonicalizeBinding('Mod+Shift+Z', false));
  });

  it('accepts literal Ctrl/Cmd/Alt/Shift modifier names, not only Mod', () => {
    expect(canonicalizeBinding('Ctrl+K', false)).toEqual(['Ctrl+K']);
    expect(canonicalizeBinding('Cmd+K', false)).toEqual(['Cmd+K']);
    expect(canonicalizeBinding('Alt+K', false)).toEqual(['Alt+K']);
  });

  it('a chord splits into multiple steps', () => {
    expect(canonicalizeBinding('g g', false)).toEqual(['G', 'G']);
  });

  it('an unknown modifier throws', () => {
    expect(() => canonicalizeBinding('Fn+Z', false)).toThrow(/unknown modifier/);
  });

  it('a bare "+" (the zoom-in binding) is its own key, not an empty modifier split', () => {
    // '+' is both the modifier separator and a valid key in its own right — splitting a bare
    // '+' on '+' naively yields two empty strings, not a one-element key array.
    expect(canonicalizeBinding('+', false)).toEqual(['+']);
  });
});

describe('Keymap', () => {
  it('registers and matches a binding', () => {
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'B', commandId: 'tool.select.brush' });
    expect(keymap.match(['B'])?.commandId).toBe('tool.select.brush');
  });

  it('is shift-agnostic for bare letters: "B" and "b" collide', () => {
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'B', commandId: 'a' });
    expect(() => keymap.register({ binding: 'b', commandId: 'b' })).toThrow(/conflict/);
  });

  it('rejects a duplicate binding registration — the exact acceptance criterion', () => {
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'Mod+Z', commandId: 'edit.undo' });
    expect(() => keymap.register({ binding: 'Mod+Z', commandId: 'something.else' })).toThrow(/conflict/);
  });

  it('a bare key and a chord starting with it do not conflict', () => {
    const keymap = new Keymap(() => false);
    expect(() => {
      keymap.register({ binding: 'G', commandId: 'tool.select.fill' });
      keymap.register({ binding: 'g x', commandId: 'fixture.chord' });
    }).not.toThrow();
  });

  it('hasPrefix recognises both an exact match and a genuine longer prefix', () => {
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'g g', commandId: 'fixture.chord' });
    expect(keymap.hasPrefix(['G'])).toBe(true);
    expect(keymap.hasPrefix(['G', 'G'])).toBe(true);
    expect(keymap.hasPrefix(['X'])).toBe(false);
  });
});

describe('attachKeymap', () => {
  it('dispatches a bare-key binding through the CommandBus', () => {
    const run = vi.fn();
    const { registry, context } = fixtureRegistryAndContext([cmd('tool.select.brush', run)]);
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'B', commandId: 'tool.select.brush' });
    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    attachKeymap(keymap, target, bus);

    target.dispatch(key('b'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('resolves Mod to the injected platform and dispatches Ctrl/Cmd+Z distinctly from Ctrl/Cmd+Shift+Z', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const { registry, context } = fixtureRegistryAndContext([cmd('edit.undo', undo), cmd('edit.redo', redo)]);
    const keymap = new Keymap(() => false); // non-mac -> Ctrl
    keymap.register({ binding: 'Mod+Z', commandId: 'edit.undo' });
    keymap.register({ binding: 'Mod+Shift+Z', commandId: 'edit.redo' });
    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    attachKeymap(keymap, target, bus);

    target.dispatch(key('z', { ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();

    target.dispatch(key('Z', { ctrlKey: true, shiftKey: true }));
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('passes an arg through to the command (brush size)', () => {
    const run = vi.fn();
    const { registry, context } = fixtureRegistryAndContext([cmd('brush.setSize', run)]);
    const keymap = new Keymap(() => false);
    keymap.register({ binding: '5', commandId: 'brush.setSize', arg: 5 });
    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    attachKeymap(keymap, target, bus);

    target.dispatch(key('5'));
    expect(run).toHaveBeenCalledWith(context, 5);
  });

  it('never fires while focus is in a text input — Typing "[" in a text field does not change the speed', () => {
    const run = vi.fn();
    const { registry, context } = fixtureRegistryAndContext([cmd('sim.speedDown', run)]);
    const keymap = new Keymap(() => false);
    keymap.register({ binding: '[', commandId: 'sim.speedDown' });
    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    attachKeymap(keymap, target, bus);

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    target.dispatch(key('[', { target: input }));
    expect(run).not.toHaveBeenCalled();

    target.dispatch(key('[', { target: document.body }));
    expect(run).toHaveBeenCalledTimes(1);

    document.body.removeChild(input);
  });

  it('a textarea and a contentEditable element are also excluded; a checkbox input is not', () => {
    const run = vi.fn();
    const { registry, context } = fixtureRegistryAndContext([cmd('sim.step', run)]);
    const keymap = new Keymap(() => false);
    keymap.register({ binding: '.', commandId: 'sim.step' });
    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    attachKeymap(keymap, target, bus);

    const textarea = document.createElement('textarea');
    target.dispatch(key('.', { target: textarea }));
    expect(run).not.toHaveBeenCalled();

    // jsdom doesn't implement `isContentEditable` at all (it's `undefined` even with the
    // `contenteditable` attribute set) — stub the property directly so this tests our own
    // handling of it, not jsdom's coverage of a standard, well-supported browser API.
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    target.dispatch(key('.', { target: editable }));
    expect(run).not.toHaveBeenCalled();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    target.dispatch(key('.', { target: checkbox }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  describe('chords', () => {
    it('a two-step chord fires only once fully entered, and exposes the pending step meanwhile', () => {
      const run = vi.fn();
      const { registry, context } = fixtureRegistryAndContext([cmd('fixture.chord', run)]);
      const keymap = new Keymap(() => false);
      keymap.register({ binding: 'g g', commandId: 'fixture.chord' });
      const bus = new CommandBus(registry, context);
      const target = new FakeTarget();
      const controller = attachKeymap(keymap, target, bus);

      target.dispatch(key('g'));
      expect(run).not.toHaveBeenCalled();
      expect(controller.pendingChordSteps).toEqual(['G']);

      target.dispatch(key('g'));
      expect(run).toHaveBeenCalledTimes(1);
      expect(controller.pendingChordSteps).toEqual([]);
    });

    it('a three-step chord re-arms its timeout at each intermediate step, not just the first', () => {
      const run = vi.fn();
      const { registry, context } = fixtureRegistryAndContext([cmd('fixture.chord3', run)]);
      const keymap = new Keymap(() => false);
      keymap.register({ binding: 'g g g', commandId: 'fixture.chord3' });
      const bus = new CommandBus(registry, context);
      const target = new FakeTarget();
      const timers = new FakeTimers();
      const controller = attachKeymap(keymap, target, bus, { timers });

      target.dispatch(key('g'));
      expect(controller.pendingChordSteps).toEqual(['G']);
      expect(timers.pendingCount).toBe(1);

      target.dispatch(key('g')); // still just a prefix ('g g g' needs a third) -> timer replaced, not doubled
      expect(controller.pendingChordSteps).toEqual(['G', 'G']);
      expect(timers.pendingCount).toBe(1);
      expect(run).not.toHaveBeenCalled();

      target.dispatch(key('g'));
      expect(run).toHaveBeenCalledTimes(1);
      expect(controller.pendingChordSteps).toEqual([]);
    });

    it('the pending chord is dropped after the 1s timeout (injected timers, no real waiting)', () => {
      const run = vi.fn();
      const { registry, context } = fixtureRegistryAndContext([cmd('fixture.chord', run)]);
      const keymap = new Keymap(() => false);
      keymap.register({ binding: 'g g', commandId: 'fixture.chord' });
      const bus = new CommandBus(registry, context);
      const target = new FakeTarget();
      const timers = new FakeTimers();
      const controller = attachKeymap(keymap, target, bus, { timers });

      target.dispatch(key('g'));
      expect(controller.pendingChordSteps).toEqual(['G']);
      expect(timers.pendingCount).toBe(1);

      timers.fireAll();
      expect(controller.pendingChordSteps).toEqual([]);

      target.dispatch(key('g')); // starts a fresh chord, not a continuation of the old one
      expect(run).not.toHaveBeenCalled();
      expect(controller.pendingChordSteps).toEqual(['G']);
    });

    it('a key that does not continue the chord is dropped, then re-evaluated fresh', () => {
      const chord = vi.fn();
      const solo = vi.fn();
      const { registry, context } = fixtureRegistryAndContext([cmd('fixture.chord', chord), cmd('fixture.solo', solo)]);
      const keymap = new Keymap(() => false);
      keymap.register({ binding: 'g g', commandId: 'fixture.chord' });
      keymap.register({ binding: 'X', commandId: 'fixture.solo' });
      const bus = new CommandBus(registry, context);
      const target = new FakeTarget();
      const controller = attachKeymap(keymap, target, bus);

      target.dispatch(key('g'));
      expect(controller.pendingChordSteps).toEqual(['G']);

      target.dispatch(key('x'));
      expect(chord).not.toHaveBeenCalled();
      expect(solo).toHaveBeenCalledTimes(1); // 'x' fires fresh, not swallowed
      expect(controller.pendingChordSteps).toEqual([]);
    });
  });

  it('an unmatched key with no registered binding is inert (no command run, no crash)', () => {
    const { registry, context } = fixtureRegistryAndContext([]);
    const keymap = new Keymap(() => false);
    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    attachKeymap(keymap, target, bus);
    expect(() => target.dispatch(key('q'))).not.toThrow();
  });

  it('dispose removes the listener and clears any pending chord/timer', () => {
    const { registry, context } = fixtureRegistryAndContext([cmd('fixture.chord', vi.fn())]);
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'g g', commandId: 'fixture.chord' });
    const bus = new CommandBus(registry, context);
    const target = new FakeTarget();
    const timers = new FakeTimers();
    const controller = attachKeymap(keymap, target, bus, { timers });

    target.dispatch(key('g'));
    expect(timers.pendingCount).toBe(1);

    controller.dispose();
    expect(target.listenerCount).toBe(0);
    expect(timers.pendingCount).toBe(0);
  });
});

describe('SYSTEM_IS_MAC', () => {
  it('reflects navigator.platform when present', () => {
    const spy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    expect(SYSTEM_IS_MAC()).toBe(true);
    spy.mockRestore();
  });

  it('is false for a non-Mac platform', () => {
    const spy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    expect(SYSTEM_IS_MAC()).toBe(false);
    spy.mockRestore();
  });
});
