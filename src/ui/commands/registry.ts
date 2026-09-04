/**
 * The command registry (Phase 1 §2.2): every user-triggerable action is a registered
 * `AppCommand`, never a button wired directly to a handler — a discipline this whole codebase
 * leans on from here forward, not just this task. Built once, consumed by four phases: P1-C-2
 * binds keys to `AppCommand.id`s, P1-D's toolbar/HUD components call `bus.run(id)` instead of
 * touching state directly, and Phase 4's palette/orphan-command sweep both read this registry.
 *
 * `AppContext` lives here (not in `client/app-context.ts`) because `AppCommand`'s methods are
 * typed against it and `ui/` cannot import `client/` (ADR-009) — `client/app-context.ts`'s job
 * is to *build* a real `AppContext` value, not to own its shape. It starts with just what P1-B-2
 * already shipped (`toolRegistry`); later tasks (the edit stack, a live worker client, the theme
 * registry, …) extend it as they land, each a pure addition, never a change to this interface's
 * existing fields.
 */
import type { ToolRegistry } from '@ui/tools/registry';

export type CommandCategory = 'Simulation' | 'Tools' | 'View' | 'Edit' | 'Ruleset' | 'Theme' | 'Help';

/**
 * A binding string in the notation the Phase 1 default-bindings table uses (`'Space'`,
 * `'Mod+Z'`, `'g g'` for a chord). Carried opaquely here — P1-C-2's `keymap.ts` owns parsing
 * this into actual key-matching logic; this registry never interprets it.
 */
export type KeyBinding = string;

export interface AppContext {
  readonly toolRegistry: ToolRegistry;
}

export interface AppCommand<A = void> {
  /** Stable id, e.g. `'sim.toggleRun'`, `'tool.select.brush'`. */
  readonly id: string;
  readonly title: string;
  readonly category: CommandCategory;
  /** Fuzzy-search aliases for Phase 4's command palette. */
  readonly keywords?: readonly string[];
  readonly defaultBinding?: KeyBinding;
  /** Required when `defaultBinding` is absent — an explicit "this one has none", not an omission. */
  readonly noBinding?: true;
  readonly icon?: string;
  isEnabled?(ctx: AppContext): boolean;
  /** For toggles: whether this command's effect is currently active. */
  isActive?(ctx: AppContext): boolean;
  run(ctx: AppContext, arg: A): void | Promise<void>;
  /** Whether a successful run should be recorded to P1-C-3's edit stack. */
  readonly undoable?: boolean;
}

export class CommandRegistry {
  private readonly commands = new Map<string, AppCommand<unknown>>();

  /**
   * Registers a command. Throws loudly (not a silent overwrite) on a duplicate id, and on a
   * command with neither `defaultBinding` nor `noBinding: true` — the "no orphan commands"
   * invariant enforced here, not left to a test to merely observe.
   */
  register<A = void>(command: AppCommand<A>): void {
    if (this.commands.has(command.id)) {
      throw new Error(`command "${command.id}" is already registered`);
    }
    if (command.defaultBinding === undefined && command.noBinding !== true) {
      throw new Error(
        `command "${command.id}" has neither a defaultBinding nor noBinding: true — every ` +
          'command must explicitly account for its keyboard reachability',
      );
    }
    this.commands.set(command.id, command);
  }

  get(id: string): AppCommand<unknown> | undefined {
    return this.commands.get(id);
  }

  list(): readonly AppCommand<unknown>[] {
    return [...this.commands.values()];
  }
}
