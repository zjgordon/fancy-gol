/**
 * Builds the real `AppContext` (its shape is owned by `ui/commands/registry.ts` — `ui/` can't
 * import `client/`, ADR-009) and a `CommandRegistry` pre-populated with the eight P1-B tools'
 * `tool.select.<id>` commands, exactly as P1-C-1's own follow-up note on P1-B-2 specified:
 * `Tool.id` was already chosen to match this naming, so no change to any `tools/*.ts` file was
 * needed to wire this up.
 *
 * `onPaint` is where a tool's finalised `PaintOp[]` (via `ToolRegistry.onCommit`) would reach a
 * real `WorkerClient.paint()` — that connection isn't made here. There is no live worker/
 * simulation composition root yet for it to reach; wiring one is a follow-up for whichever task
 * first boots the full app end-to-end (candidate: P1-D-1's layout shell). Until then, `onPaint`
 * defaults to a no-op so the tools are fully exercisable (selectable, usable, producing correct
 * `PaintOp[]`) without one.
 */
import type { PaintOp } from '@shared/types';
import { CommandRegistry, type AppCommand, type AppContext } from '@ui/commands/registry';
import { Brush } from '@ui/tools/brush';
import { EllipseTool } from '@ui/tools/ellipse';
import { Eraser } from '@ui/tools/eraser';
import { FillTool } from '@ui/tools/fill';
import { LineTool } from '@ui/tools/line';
import { RectTool } from '@ui/tools/rect';
import { SelectTool } from '@ui/tools/select';
import { StampTool } from '@ui/tools/stamp';
import { ToolRegistry } from '@ui/tools/registry';

export interface CreateAppContextOptions {
  /** Where a tool's finalised ops go once committed. Defaults to a no-op — see the module doc. */
  readonly onPaint?: (ops: readonly PaintOp[]) => void;
}

export interface AppContextBundle {
  readonly context: AppContext;
  readonly registry: CommandRegistry;
}

/** One `tool.select.<id>` command per Phase 1 default-bindings table entry (P1-C-2 §"Default bindings"). */
const TOOL_SELECT_BINDINGS: ReadonlyArray<{ readonly id: string; readonly title: string; readonly binding: string }> = [
  { id: 'brush', title: 'Brush', binding: 'B' },
  { id: 'eraser', title: 'Eraser', binding: 'E' },
  { id: 'line', title: 'Line', binding: 'L' },
  { id: 'rect', title: 'Rectangle', binding: 'U' },
  { id: 'ellipse', title: 'Ellipse', binding: 'O' },
  { id: 'fill', title: 'Fill', binding: 'G' },
  { id: 'select', title: 'Select', binding: 'S' },
  { id: 'stamp', title: 'Stamp', binding: 'M' },
];

function toolSelectCommand(toolId: string, title: string, binding: string): AppCommand {
  return {
    id: `tool.select.${toolId}`,
    title: `${title} tool`,
    category: 'Tools',
    defaultBinding: binding,
    isEnabled: (ctx) => ctx.toolRegistry.get(toolId) !== undefined,
    isActive: (ctx) => ctx.toolRegistry.active?.id === toolId,
    run: (ctx) => {
      ctx.toolRegistry.activate(toolId);
    },
  };
}

export function createAppContext(options: CreateAppContextOptions = {}): AppContextBundle {
  const onPaint = options.onPaint ?? (() => {});
  const toolRegistry = new ToolRegistry({ onCommit: onPaint });

  toolRegistry.register(new Brush());
  toolRegistry.register(new Eraser());
  toolRegistry.register(new LineTool());
  toolRegistry.register(new RectTool());
  toolRegistry.register(new EllipseTool());
  toolRegistry.register(new FillTool());
  toolRegistry.register(new SelectTool());
  toolRegistry.register(new StampTool());

  const context: AppContext = { toolRegistry };

  const registry = new CommandRegistry();
  for (const { id, title, binding } of TOOL_SELECT_BINDINGS) {
    registry.register(toolSelectCommand(id, title, binding));
  }

  return { context, registry };
}
