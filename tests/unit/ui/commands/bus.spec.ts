import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@ui/commands/bus';
import { CommandRegistry, type AppCommand, type AppContext } from '@ui/commands/registry';
import { ToolRegistry } from '@ui/tools/registry';

function fixtureContext(): AppContext {
  return { toolRegistry: new ToolRegistry() };
}

function command(overrides: Partial<AppCommand> & Pick<AppCommand, 'run'>): AppCommand {
  return {
    id: 'fixture.command',
    title: 'Fixture command',
    category: 'Tools',
    noBinding: true,
    ...overrides,
  };
}

describe('CommandBus', () => {
  it('runs an enabled command, passing the context and arg through', async () => {
    const ctx = fixtureContext();
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register(command({ run }));
    const bus = new CommandBus(registry, ctx);

    await bus.run('fixture.command', 7);
    expect(run).toHaveBeenCalledWith(ctx, 7);
  });

  it('awaits an async command before resolving', async () => {
    const ctx = fixtureContext();
    const registry = new CommandRegistry();
    let resolved = false;
    registry.register(
      command({
        run: async () => {
          await Promise.resolve();
          resolved = true;
        },
      }),
    );
    const bus = new CommandBus(registry, ctx);

    await bus.run('fixture.command');
    expect(resolved).toBe(true);
  });

  it('throws for an unknown command id — a genuine programmer error, not a soft failure', async () => {
    const bus = new CommandBus(new CommandRegistry(), fixtureContext());
    await expect(bus.run('does.not.exist')).rejects.toThrow(RangeError);
  });

  describe('a disabled command', () => {
    it('is a no-op with a debug-level log, never a throw', async () => {
      const ctx = fixtureContext();
      const registry = new CommandRegistry();
      const run = vi.fn();
      registry.register(command({ run, isEnabled: () => false }));
      const bus = new CommandBus(registry, ctx);
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      await expect(bus.run('fixture.command')).resolves.toBeUndefined();
      expect(run).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy.mock.calls[0]![0]).toMatch(/fixture\.command/);

      debugSpy.mockRestore();
    });

    it('a command with no isEnabled at all is always enabled', async () => {
      const registry = new CommandRegistry();
      const run = vi.fn();
      registry.register(command({ run })); // no isEnabled
      const bus = new CommandBus(registry, fixtureContext());

      await bus.run('fixture.command');
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe('the edit-stack and "recent" seams (both no-ops by default)', () => {
    it('notifies onUndoableRun only for undoable commands, and onRun for every successful run', async () => {
      const registry = new CommandRegistry();
      registry.register(command({ id: 'plain', run: () => {} }));
      registry.register(command({ id: 'undoable', run: () => {}, undoable: true }));
      const onUndoableRun = vi.fn();
      const onRun = vi.fn();
      const bus = new CommandBus(registry, fixtureContext(), { onUndoableRun, onRun });

      await bus.run('plain');
      expect(onUndoableRun).not.toHaveBeenCalled();
      expect(onRun).toHaveBeenCalledWith('plain');

      await bus.run('undoable', 'the-arg');
      expect(onUndoableRun).toHaveBeenCalledWith('undoable', 'the-arg');
      expect(onRun).toHaveBeenCalledWith('undoable');
    });

    it('neither seam fires for a disabled command', async () => {
      const registry = new CommandRegistry();
      registry.register(command({ run: () => {}, undoable: true, isEnabled: () => false }));
      const onUndoableRun = vi.fn();
      const onRun = vi.fn();
      const bus = new CommandBus(registry, fixtureContext(), { onUndoableRun, onRun });

      await bus.run('fixture.command');
      expect(onUndoableRun).not.toHaveBeenCalled();
      expect(onRun).not.toHaveBeenCalled();
    });

    it('default to no-ops when no options are supplied', async () => {
      const registry = new CommandRegistry();
      registry.register(command({ run: () => {}, undoable: true }));
      const bus = new CommandBus(registry, fixtureContext());
      await expect(bus.run('fixture.command')).resolves.toBeUndefined();
    });
  });
});
