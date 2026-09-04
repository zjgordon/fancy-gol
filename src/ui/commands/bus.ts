/**
 * `bus.run(id, arg)`: resolves `isEnabled` first, dispatches, and notifies two seams for
 * later tasks to hook into — `onUndoableRun` (P1-C-3's edit stack) and `onRun` (Phase 4's
 * "recent" list in the command palette). Neither exists yet, so both default to no-ops; wiring
 * a real edit stack in is a pure addition here, not a change to this file's shape.
 */
import type { AppCommand, AppContext, CommandRegistry } from './registry';

export interface CommandBusOptions {
  readonly onUndoableRun?: (id: string, arg: unknown) => void;
  readonly onRun?: (id: string) => void;
}

export class CommandBus {
  private readonly onUndoableRun: (id: string, arg: unknown) => void;
  private readonly onRun: (id: string) => void;

  constructor(
    private readonly registry: CommandRegistry,
    private readonly context: AppContext,
    options: CommandBusOptions = {},
  ) {
    this.onUndoableRun = options.onUndoableRun ?? (() => {});
    this.onRun = options.onRun ?? (() => {});
  }

  /**
   * Runs a command by id. An unknown id is a genuine programmer error and throws (matching
   * `ToolRegistry.activate`'s precedent); a disabled command is never an error — it's a no-op
   * with a debug-level log, since a stale keybinding or a palette entry firing while its
   * command is momentarily disabled is an expected, harmless race, not a bug to surface loudly.
   */
  async run<A = void>(id: string, arg?: A): Promise<void> {
    const command = this.registry.get(id) as AppCommand<A> | undefined;
    if (!command) {
      throw new RangeError(`no command registered with id "${id}"`);
    }
    if (command.isEnabled && !command.isEnabled(this.context)) {
      console.debug(`command "${id}" is disabled; ignoring`);
      return;
    }
    await command.run(this.context, arg as A);
    if (command.undoable) this.onUndoableRun(id, arg);
    this.onRun(id);
  }
}
