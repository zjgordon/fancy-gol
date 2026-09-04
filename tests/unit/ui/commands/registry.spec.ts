import { describe, expect, it } from 'vitest';
import { CommandRegistry, type AppCommand, type AppContext } from '@ui/commands/registry';
import { ToolRegistry } from '@ui/tools/registry';

function fixtureContext(): AppContext {
  return { toolRegistry: new ToolRegistry() };
}

/** A minimal, valid (has `noBinding: true`) fixture command, overridable field by field. */
function noBindingCommand(overrides: Partial<Omit<AppCommand, 'noBinding' | 'defaultBinding'>> = {}): AppCommand {
  return {
    id: 'fixture.command',
    title: 'Fixture command',
    category: 'Tools',
    noBinding: true,
    run: () => {},
    ...overrides,
  };
}

/** A minimal, valid (has `defaultBinding`) fixture command, overridable field by field. */
function boundCommand(
  defaultBinding: string,
  overrides: Partial<Omit<AppCommand, 'noBinding' | 'defaultBinding'>> = {},
): AppCommand {
  return {
    id: 'fixture.bound-command',
    title: 'Fixture bound command',
    category: 'Tools',
    defaultBinding,
    run: () => {},
    ...overrides,
  };
}

describe('CommandRegistry', () => {
  it('registers, gets, and lists a command', () => {
    const registry = new CommandRegistry();
    registry.register(noBindingCommand());
    expect(registry.get('fixture.command')?.title).toBe('Fixture command');
    expect(registry.list()).toHaveLength(1);
  });

  it('get() returns undefined for an unregistered id', () => {
    const registry = new CommandRegistry();
    expect(registry.get('nope')).toBeUndefined();
  });

  it('throws loudly on a duplicate id, rather than silently overwriting', () => {
    const registry = new CommandRegistry();
    registry.register(noBindingCommand());
    expect(() => registry.register(noBindingCommand())).toThrow(/already registered/);
    expect(registry.list()).toHaveLength(1); // the original survives
  });

  describe('the no-orphan-commands invariant', () => {
    it('accepts a command with defaultBinding and no noBinding', () => {
      const registry = new CommandRegistry();
      expect(() => registry.register(boundCommand('Space', { id: 'a' }))).not.toThrow();
    });

    it('accepts a command with noBinding: true and no defaultBinding', () => {
      const registry = new CommandRegistry();
      expect(() => registry.register(noBindingCommand({ id: 'b' }))).not.toThrow();
    });

    it('rejects a command with neither defaultBinding nor noBinding: true', () => {
      const registry = new CommandRegistry();
      const orphan: AppCommand = { id: 'c', title: 'Orphan', category: 'Tools', run: () => {} };
      expect(() => registry.register(orphan)).toThrow(/defaultBinding|noBinding/);
    });
  });

  it('a test enumerating every registered command finds each with a title, a category, and a binding-or-noBinding — no orphans', () => {
    const registry = new CommandRegistry();
    registry.register(boundCommand('Space', { id: 'sim.toggleRun', title: 'Play / Pause', category: 'Simulation' }));
    registry.register(boundCommand('B', { id: 'tool.select.brush', title: 'Brush tool', category: 'Tools' }));
    registry.register(
      noBindingCommand({ id: 'help.cheatsheet', title: 'Shortcut cheat sheet', category: 'Help' }),
    );

    for (const cmd of registry.list()) {
      expect(cmd.title.length).toBeGreaterThan(0);
      expect(cmd.category.length).toBeGreaterThan(0);
      expect(cmd.defaultBinding !== undefined || cmd.noBinding === true).toBe(true);
    }
  });

  describe('run() and context plumbing (exercised via a fixture command)', () => {
    it('run receives the AppContext and any arg', () => {
      const ctx = fixtureContext();
      let received: { ctx: AppContext; arg: unknown } | null = null;
      const registry = new CommandRegistry();
      registry.register(
        noBindingCommand({
          id: 'echo',
          run: (c, arg) => {
            received = { ctx: c, arg };
          },
        }),
      );
      void registry.get('echo')?.run(ctx, 42);
      expect(received).toEqual({ ctx, arg: 42 });
    });
  });
});
