import { describe, expect, it, vi } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import type { PaintOp } from '@shared/types';
import type { ToolEvent, ToolEventPhase } from '@ui/input/router';
import { ToolRegistry } from '@ui/tools/registry';
import type { Tool, ToolContext } from '@ui/tools/tool';

function toolEvent(phase: ToolEventPhase, x: number, y: number): ToolEvent {
  const point = { x, y, pressure: 0.5, timeMs: 0 };
  return {
    phase,
    pointerId: 1,
    pointerType: 'mouse',
    point,
    coalesced: [point],
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
  };
}

/**
 * A fixture tool proving P1-B-2's extensibility claim: this is the *only* new file a brand new
 * tool needs (P1-B-3's real brush/eraser will look exactly like this in shape), registered with
 * exactly one call — `registry.register(new FixtureTool())` — and nothing else touched.
 */
class FixtureTool implements Tool {
  readonly cursor = 'crosshair';
  downCount = 0;
  moveCount = 0;
  private anchor: { x: number; y: number } | null = null;

  constructor(readonly id = 'fixture') {}

  onDown(ctx: ToolContext): void {
    this.downCount++;
    this.anchor = { x: Math.round(ctx.event.point.x), y: Math.round(ctx.event.point.y) };
  }

  onMove(): void {
    this.moveCount++;
  }

  onUp(): readonly PaintOp[] {
    const ops = this.anchor ? [{ x: this.anchor.x, y: this.anchor.y, state: 1 }] : [];
    this.anchor = null;
    return ops;
  }

  onCancel(): void {
    this.anchor = null;
  }

  preview(): readonly PaintOp[] {
    return this.anchor ? [{ x: this.anchor.x, y: this.anchor.y, state: 1 }] : [];
  }
}

describe('ToolRegistry', () => {
  describe('registration and extensibility', () => {
    it('a brand new tool needs exactly one registry line: register(), then it is fully live', () => {
      const registry = new ToolRegistry();
      registry.register(new FixtureTool()); // <- the one line

      expect(registry.get('fixture')).toBeInstanceOf(FixtureTool);
      expect(registry.list()).toHaveLength(1);
      expect(registry.active?.id).toBe('fixture'); // first-registered tool auto-activates

      const committed: (readonly PaintOp[])[] = [];
      const withCommit = new ToolRegistry({ onCommit: (ops) => committed.push(ops) });
      withCommit.register(new FixtureTool());
      withCommit.handlers.onDown?.(toolEvent('down', 3, 4));
      withCommit.handlers.onUp?.(toolEvent('up', 3, 4));

      expect(committed).toEqual([[{ x: 3, y: 4, state: 1 }]]);
    });

    it('the first registered tool becomes active automatically; later registrations do not steal activation', () => {
      const registry = new ToolRegistry();
      const first = new FixtureTool();
      const second = new FixtureTool('second');
      registry.register(first);
      registry.register(second);
      expect(registry.active).toBe(first);
    });

    it('rejects a duplicate tool id', () => {
      const registry = new ToolRegistry();
      registry.register(new FixtureTool());
      expect(() => registry.register(new FixtureTool())).toThrow(/already registered/);
    });
  });

  describe('activation', () => {
    it('activate() switches the active tool and cancels whatever the previous one had in progress', () => {
      const registry = new ToolRegistry();
      const brush = new FixtureTool();
      const eraser = new FixtureTool('eraser');
      registry.register(brush);
      registry.register(eraser);

      registry.handlers.onDown?.(toolEvent('down', 1, 1));
      expect(brush.preview()).toHaveLength(1);

      registry.activate('eraser');
      expect(registry.active?.id).toBe('eraser');
      expect(brush.preview()).toHaveLength(0); // cancelled, not left dangling
    });

    it('activate() with an unknown id throws and leaves the current tool active', () => {
      const registry = new ToolRegistry();
      registry.register(new FixtureTool());
      expect(() => registry.activate('nope')).toThrow(RangeError);
      expect(registry.active?.id).toBe('fixture');
    });
  });

  describe('handlers (router.ts wiring)', () => {
    it('relays down/move/up to the active tool, converting ToolEvent to ToolContext', () => {
      const registry = new ToolRegistry();
      const tool = new FixtureTool();
      registry.register(tool);

      registry.handlers.onDown?.(toolEvent('down', 10, 20));
      registry.handlers.onMove?.(toolEvent('move', 11, 20));
      expect(tool.downCount).toBe(1);
      expect(tool.moveCount).toBe(1);

      const ops = tool.preview();
      expect(ops).toEqual([{ x: 10, y: 20, state: 1 }]);
    });

    it('calls onCommit only when onUp actually produces ops — never with an empty array', () => {
      const onCommit = vi.fn();
      const registry = new ToolRegistry({ onCommit });
      registry.register(new FixtureTool());

      registry.handlers.onUp?.(toolEvent('up', 0, 0)); // no prior onDown: nothing to commit
      expect(onCommit).not.toHaveBeenCalled();

      registry.handlers.onDown?.(toolEvent('down', 5, 5));
      registry.handlers.onUp?.(toolEvent('up', 5, 5));
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith([{ x: 5, y: 5, state: 1 }]);
    });

    it('does nothing (and does not throw) when no tool is registered at all', () => {
      const registry = new ToolRegistry();
      expect(() => {
        registry.handlers.onDown?.(toolEvent('down', 0, 0));
        registry.handlers.onMove?.(toolEvent('move', 0, 0));
        registry.handlers.onUp?.(toolEvent('up', 0, 0));
        registry.handlers.onCancel?.(toolEvent('cancel', 0, 0));
      }).not.toThrow();
    });

    it('defaults onCommit to a no-op when none is supplied', () => {
      const registry = new ToolRegistry();
      registry.register(new FixtureTool());
      expect(() => {
        registry.handlers.onDown?.(toolEvent('down', 1, 1));
        registry.handlers.onUp?.(toolEvent('up', 1, 1));
      }).not.toThrow();
    });
  });

  describe('Escape cancels the active tool, leaving the grid byte-identical (P1-B-2)', () => {
    it('escape mid-drag: preview clears and a real Simulation is never touched', () => {
      const committed: (readonly PaintOp[])[] = [];
      const registry = new ToolRegistry({ onCommit: (ops) => committed.push(ops) });
      const tool = new FixtureTool();
      registry.register(tool);

      const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32, seed: 1 });
      const before = sim.snapshot();

      registry.handlers.onDown?.(toolEvent('down', 5, 5));
      registry.handlers.onMove?.(toolEvent('move', 6, 5));
      expect(tool.preview()).toHaveLength(1); // a real in-progress gesture, not a no-op

      registry.cancelActive(); // what attachEscapeHandling's keydown ultimately calls

      expect(tool.preview()).toHaveLength(0);
      expect(committed).toHaveLength(0); // onUp/onCommit never fired — nothing to apply

      // Nothing the tool produced ever reached the engine, so it is byte-identical, not just
      // "probably fine": tick, RNG state, and every live chunk's bytes are unchanged.
      const after = sim.snapshot();
      expect(after.tick).toBe(before.tick);
      expect(after.rngState).toBe(before.rngState);
      expect(after.chunkKeys).toEqual(before.chunkKeys);
      expect(after.chunkData).toEqual(before.chunkData);
    });

    it('contrast: an uncancelled drag does commit, and does change the simulation', () => {
      const committed: (readonly PaintOp[])[] = [];
      const registry = new ToolRegistry({ onCommit: (ops) => committed.push(ops) });
      registry.register(new FixtureTool());

      const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32, seed: 1 });
      const before = sim.snapshot();

      registry.handlers.onDown?.(toolEvent('down', 5, 5));
      registry.handlers.onUp?.(toolEvent('up', 5, 5));
      expect(committed).toEqual([[{ x: 5, y: 5, state: 1 }]]);

      sim.paint(committed[0]!);
      const after = sim.snapshot();
      expect(after.chunkData).not.toEqual(before.chunkData);
    });
  });

  describe('attachEscapeHandling', () => {
    class FakeKeySurface {
      private readonly listeners = new Set<(event: KeyboardEvent) => void>();
      addEventListener(_type: 'keydown', listener: (event: KeyboardEvent) => void): void {
        this.listeners.add(listener);
      }
      removeEventListener(_type: 'keydown', listener: (event: KeyboardEvent) => void): void {
        this.listeners.delete(listener);
      }
      dispatch(key: string): void {
        for (const fn of this.listeners) fn({ key } as KeyboardEvent);
      }
      get size(): number {
        return this.listeners.size;
      }
    }

    it('Escape cancels the active tool; other keys do nothing', () => {
      const registry = new ToolRegistry();
      const tool = new FixtureTool();
      registry.register(tool);
      registry.handlers.onDown?.(toolEvent('down', 1, 1));

      const surface = new FakeKeySurface();
      registry.attachEscapeHandling(surface);

      surface.dispatch('a');
      expect(tool.preview()).toHaveLength(1);

      surface.dispatch('Escape');
      expect(tool.preview()).toHaveLength(0);
    });

    it('the returned dispose function removes the listener', () => {
      const registry = new ToolRegistry();
      const surface = new FakeKeySurface();
      const dispose = registry.attachEscapeHandling(surface);
      expect(surface.size).toBe(1);
      dispose();
      expect(surface.size).toBe(0);
    });
  });
});
