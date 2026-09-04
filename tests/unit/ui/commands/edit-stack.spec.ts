import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Mulberry32 } from '@engine/rng';
import { Simulation } from '@engine/simulation';
import type { PaintOp } from '@shared/types';
import { DEFAULT_DEPTH_CAP, EditStack, editFromChangeSet } from '@ui/commands/edit-stack';

function sortOps(ops: readonly PaintOp[]): PaintOp[] {
  return [...ops].sort((a, b) => a.x - b.x || a.y - b.y);
}

describe('editFromChangeSet', () => {
  it('unpacks a real ChangeSet into matching forward (to) and inverse (from) PaintOps', () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32, seed: 1 });
    const cs = sim.paint([
      { x: 2, y: 3, state: 1 },
      { x: 5, y: 5, state: 1 },
    ]);
    const { forward, inverse } = editFromChangeSet(cs);

    expect(sortOps(forward)).toEqual(
      sortOps([
        { x: 2, y: 3, state: 1 },
        { x: 5, y: 5, state: 1 },
      ]),
    );
    expect(sortOps(inverse)).toEqual(
      sortOps([
        { x: 2, y: 3, state: 0 },
        { x: 5, y: 5, state: 0 },
      ]),
    );
  });

  it('a no-op paint (repainting the same state) produces an empty ChangeSet and empty ops', () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 8, height: 8, seed: 1 });
    sim.paint([{ x: 1, y: 1, state: 1 }]);
    const cs = sim.paint([{ x: 1, y: 1, state: 1 }]); // already state 1
    const { forward, inverse } = editFromChangeSet(cs);
    expect(forward).toHaveLength(0);
    expect(inverse).toHaveLength(0);
  });

  it('copies eagerly: a later paint reusing the ChangeSet\'s typed arrays does not corrupt an already-extracted entry', () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 16, height: 16, seed: 1 });
    const csA = sim.paint([{ x: 0, y: 0, state: 1 }]);
    const entryA = editFromChangeSet(csA);

    // A second paint reuses/overwrites the engine's internal ChangeSet buffers.
    sim.paint([{ x: 9, y: 9, state: 1 }]);

    expect(entryA.forward).toEqual([{ x: 0, y: 0, state: 1 }]);
    expect(entryA.inverse).toEqual([{ x: 0, y: 0, state: 0 }]);
  });
});

describe('EditStack', () => {
  it('undo/redo round-trip through record()', () => {
    const stack = new EditStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);

    stack.record({ forward: [{ x: 0, y: 0, state: 1 }], inverse: [{ x: 0, y: 0, state: 0 }] });
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);

    expect(stack.undo()).toEqual([{ x: 0, y: 0, state: 0 }]);
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);

    expect(stack.redo()).toEqual([{ x: 0, y: 0, state: 1 }]);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it('undo/redo on an empty stack return undefined without throwing', () => {
    const stack = new EditStack();
    expect(stack.undo()).toBeUndefined();
    expect(stack.redo()).toBeUndefined();
  });

  it('redo is invalidated by a new edit, and canRedo reflects that immediately', () => {
    const stack = new EditStack();
    stack.record({ forward: [{ x: 0, y: 0, state: 1 }], inverse: [{ x: 0, y: 0, state: 0 }] });
    stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.record({ forward: [{ x: 1, y: 1, state: 1 }], inverse: [{ x: 1, y: 1, state: 0 }] });
    expect(stack.canRedo).toBe(false);
    expect(stack.redo()).toBeUndefined();
  });

  it('is depth-capped at the default of 200, evicting the oldest', () => {
    const stack = new EditStack();
    for (let i = 0; i < DEFAULT_DEPTH_CAP + 50; i++) {
      stack.record({ forward: [{ x: i, y: 0, state: 1 }], inverse: [{ x: i, y: 0, state: 0 }] });
    }
    expect(stack.depth).toBe(DEFAULT_DEPTH_CAP);
    // The oldest 50 are gone: undoing DEFAULT_DEPTH_CAP times reaches entry #50, not #0.
    let last: readonly PaintOp[] | undefined;
    for (let i = 0; i < DEFAULT_DEPTH_CAP; i++) last = stack.undo();
    expect(last).toEqual([{ x: 50, y: 0, state: 0 }]);
    expect(stack.canUndo).toBe(false);
  });

  it('honours a custom depth cap', () => {
    const stack = new EditStack({ depthCap: 3 });
    for (let i = 0; i < 5; i++) {
      stack.record({ forward: [{ x: i, y: 0, state: 1 }], inverse: [{ x: i, y: 0, state: 0 }] });
    }
    expect(stack.depth).toBe(3);
  });

  it('is byte-capped, evicting the oldest entries once the estimate is exceeded', () => {
    // 3 ops/edit, ~32 bytes/op/array, forward+inverse -> ~192 bytes/edit. Cap at 500 bytes
    // allows roughly 2 edits before eviction kicks in.
    const stack = new EditStack({ byteCap: 500, depthCap: 1000 });
    const bigOps = (n: number): PaintOp[] => Array.from({ length: 3 }, (_, i) => ({ x: n * 10 + i, y: 0, state: 1 }));
    for (let i = 0; i < 10; i++) {
      stack.record({ forward: bigOps(i), inverse: bigOps(i) });
    }
    expect(stack.depth).toBeLessThan(10);
    expect(stack.depth).toBeGreaterThan(0);
  });

  it('clear() drops all undo and redo history', () => {
    const stack = new EditStack();
    stack.record({ forward: [{ x: 0, y: 0, state: 1 }], inverse: [{ x: 0, y: 0, state: 0 }] });
    stack.undo();
    expect(stack.canRedo).toBe(true);
    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  describe('acceptance: 200 random edits fully undone restores a byte-identical grid', () => {
    it('matches the pre-edit snapshot exactly after undoing all 200, in reverse order', () => {
      const sim = new Simulation({ ruleset: CONWAY, width: 64, height: 64, seed: 1 });
      const before = sim.snapshot();

      const stack = new EditStack();
      const rng = new Mulberry32(0xed17_57ac);
      for (let i = 0; i < 200; i++) {
        const x = Math.floor(rng.next() * 64);
        const y = Math.floor(rng.next() * 64);
        const state = rng.next() < 0.5 ? 1 : 0;
        const cs = sim.paint([{ x, y, state }]);
        stack.record(editFromChangeSet(cs));
      }

      expect(stack.depth).toBeGreaterThan(0);
      while (stack.canUndo) {
        const inverseOps = stack.undo()!;
        sim.paint(inverseOps);
      }

      const after = sim.snapshot();
      expect(after.tick).toBe(before.tick);
      expect(after.rngState).toBe(before.rngState);
      expect(after.chunkKeys).toEqual(before.chunkKeys);
      expect(after.chunkData).toEqual(before.chunkData);
    });
  });

  describe('acceptance: undo after a step undoes only the edit, leaving the generation count alone', () => {
    it('reverts the painted cells but does not change sim.tick', () => {
      const sim = new Simulation({ ruleset: CONWAY, width: 32, height: 32, seed: 1 });
      const stack = new EditStack();

      const cs = sim.paint([{ x: 10, y: 10, state: 1 }]);
      stack.record(editFromChangeSet(cs));
      expect(sim.get(10, 10)).toBe(1);

      sim.step(); // advance one generation
      const tickAfterStep = sim.tick;
      expect(tickAfterStep).toBe(1);

      const inverseOps = stack.undo()!;
      sim.paint(inverseOps);

      expect(sim.get(10, 10)).toBe(0); // the edit is reverted
      expect(sim.tick).toBe(tickAfterStep); // the generation count is untouched by undo
    });
  });
});
