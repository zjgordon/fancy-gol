/**
 * Where tools are registered and dispatched to (Phase 1 §2.2: adding a tool is one new file
 * implementing `Tool` plus one `register()` call, never a change to this file or to the input
 * plumbing). Owns which tool is active, relays `router.ts`'s `ToolEvent`s to it, and — via
 * `onCommit` — is the seam P1-C-1's `CommandBus` plugs into once it exists; until then, a
 * missing `onCommit` simply drops finalised ops on the floor, same as there being no bus yet.
 *
 * Also owns Escape-cancels-the-active-tool (`attachEscapeHandling`): that guarantee belongs
 * here, not to a future task, because it's meaningless without already knowing which tool is
 * active — the one piece of state only this module has.
 */
import type { PaintOp } from '@shared/types';
import type { ToolEvent, ToolEventHandlers } from '@ui/input/router';
import type { Tool, ToolContext } from './tool';

export interface ToolRegistryOptions {
  /** Called with a tool's finalised ops from `onUp`. Never called with an empty array. */
  readonly onCommit?: (ops: readonly PaintOp[]) => void;
}

/** The minimal keyboard surface `attachEscapeHandling` needs — real `Window`/`Element` shaped. */
export interface KeySurface {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private activeId: string | null = null;
  private readonly onCommit: (ops: readonly PaintOp[]) => void;

  constructor(options: ToolRegistryOptions = {}) {
    this.onCommit = options.onCommit ?? (() => {});
  }

  /** Registers a tool. The first tool ever registered becomes active automatically. */
  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`tool "${tool.id}" is already registered`);
    }
    this.tools.set(tool.id, tool);
    this.activeId ??= tool.id;
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  list(): readonly Tool[] {
    return [...this.tools.values()];
  }

  get active(): Tool | undefined {
    return this.activeId === null ? undefined : this.tools.get(this.activeId);
  }

  /** Switches the active tool, cancelling whatever the previously active one had mid-gesture. */
  activate(id: string): void {
    if (!this.tools.has(id)) {
      throw new RangeError(`no tool registered with id "${id}"`);
    }
    this.active?.onCancel();
    this.activeId = id;
  }

  /** Cancels the active tool's in-progress gesture, if any. What Escape calls. */
  cancelActive(): void {
    this.active?.onCancel();
  }

  /** Pass directly to `attachInputRouter` — relays every phase to whichever tool is active. */
  get handlers(): ToolEventHandlers {
    return {
      onDown: (e: ToolEvent) => this.active?.onDown(toContext(e)),
      onMove: (e: ToolEvent) => this.active?.onMove(toContext(e)),
      onUp: (e: ToolEvent) => {
        const ops = this.active?.onUp(toContext(e)) ?? [];
        if (ops.length > 0) this.onCommit(ops);
      },
      onCancel: () => this.active?.onCancel(),
    };
  }

  /** Escape cancels whatever tool is mid-gesture. Returns a dispose function. */
  attachEscapeHandling(target: KeySurface): () => void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.cancelActive();
    };
    target.addEventListener('keydown', onKeyDown);
    return () => target.removeEventListener('keydown', onKeyDown);
  }
}

function toContext(event: ToolEvent): ToolContext {
  return { event };
}
