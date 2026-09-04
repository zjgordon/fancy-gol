import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../src/client/app-context';
import { CommandBus } from '@ui/commands/bus';

const EXPECTED_TOOLS: ReadonlyArray<{ readonly id: string; readonly title: string; readonly binding: string }> = [
  { id: 'brush', title: 'Brush tool', binding: 'B' },
  { id: 'eraser', title: 'Eraser tool', binding: 'E' },
  { id: 'line', title: 'Line tool', binding: 'L' },
  { id: 'rect', title: 'Rectangle tool', binding: 'U' },
  { id: 'ellipse', title: 'Ellipse tool', binding: 'O' },
  { id: 'fill', title: 'Fill tool', binding: 'G' },
  { id: 'select', title: 'Select tool', binding: 'S' },
  { id: 'stamp', title: 'Stamp tool', binding: 'M' },
];

describe('createAppContext', () => {
  it('registers all eight tools, each gettable from the context', () => {
    const { context } = createAppContext();
    for (const { id } of EXPECTED_TOOLS) {
      expect(context.toolRegistry.get(id)).toBeDefined();
    }
  });

  it('registers one tool.select.<id> command per tool, matching the Phase 1 default-bindings table', () => {
    const { registry } = createAppContext();
    for (const { id, title, binding } of EXPECTED_TOOLS) {
      const cmd = registry.get(`tool.select.${id}`);
      expect(cmd).toBeDefined();
      expect(cmd?.title).toBe(title);
      expect(cmd?.category).toBe('Tools');
      expect(cmd?.defaultBinding).toBe(binding);
    }
    expect(registry.list()).toHaveLength(EXPECTED_TOOLS.length);
  });

  it('no orphan commands: every registered command has a title, a category, and a binding-or-noBinding', () => {
    const { registry } = createAppContext();
    for (const cmd of registry.list()) {
      expect(cmd.title.length).toBeGreaterThan(0);
      expect(cmd.category.length).toBeGreaterThan(0);
      expect(cmd.defaultBinding !== undefined || cmd.noBinding === true).toBe(true);
    }
  });

  it('running tool.select.<id> through the CommandBus actually activates that tool', async () => {
    const { context, registry } = createAppContext();
    const bus = new CommandBus(registry, context);

    await bus.run('tool.select.eraser');
    expect(context.toolRegistry.active?.id).toBe('eraser');

    await bus.run('tool.select.select');
    expect(context.toolRegistry.active?.id).toBe('select');
  });

  it('isActive reflects the currently active tool', () => {
    const { context, registry } = createAppContext();
    context.toolRegistry.activate('line');
    expect(registry.get('tool.select.line')?.isActive?.(context)).toBe(true);
    expect(registry.get('tool.select.brush')?.isActive?.(context)).toBe(false);
  });

  describe('onPaint (the ToolRegistry.onCommit seam)', () => {
    it('is called with a tool\'s finalised ops once a stroke commits', () => {
      const onPaint = vi.fn();
      const { context } = createAppContext({ onPaint });

      context.toolRegistry.activate('brush');
      const point = { x: 3, y: 4, pressure: 0.5, timeMs: 0 };
      const event = {
        phase: 'down' as const,
        pointerId: 1,
        pointerType: 'mouse',
        point,
        coalesced: [point],
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      };
      context.toolRegistry.handlers.onDown?.(event);
      context.toolRegistry.handlers.onUp?.({ ...event, phase: 'up' });

      expect(onPaint).toHaveBeenCalledWith([{ x: 3, y: 4, state: 1 }]);
    });

    it('defaults to a harmless no-op when not supplied', () => {
      const { context } = createAppContext();
      context.toolRegistry.activate('brush');
      const point = { x: 0, y: 0, pressure: 0.5, timeMs: 0 };
      const event = {
        phase: 'down' as const,
        pointerId: 1,
        pointerType: 'mouse',
        point,
        coalesced: [point],
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      };
      expect(() => {
        context.toolRegistry.handlers.onDown?.(event);
        context.toolRegistry.handlers.onUp?.({ ...event, phase: 'up' });
      }).not.toThrow();
    });
  });
});
