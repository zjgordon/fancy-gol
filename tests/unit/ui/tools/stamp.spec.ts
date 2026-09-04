import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { DEAD } from '@shared/types';
import type { ToolPoint } from '@ui/input/router';
import { decodeRLE } from '@ui/tools/select';
import { BUILTIN_STAMPS, StampTool, type StampDefinition } from '@ui/tools/stamp';
import type { ToolContext } from '@ui/tools/tool';

function ctxAt(x: number, y: number, shift = false): ToolContext {
  const point: ToolPoint = { x, y, pressure: 0.5, timeMs: 0 };
  return {
    event: {
      phase: 'move',
      pointerId: 1,
      pointerType: 'mouse',
      point,
      coalesced: [point],
      modifiers: { shift, ctrl: false, alt: false, meta: false },
    },
  };
}

describe('BUILTIN_STAMPS', () => {
  it('covers the ten named Phase 1 patterns, each with a unique id and decodable RLE', () => {
    const expectedIds = [
      'glider',
      'lwss',
      'blinker',
      'toad',
      'beacon',
      'pulsar',
      'r-pentomino',
      'acorn',
      'gosper-gun',
      'block',
    ];
    const ids = BUILTIN_STAMPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(BUILTIN_STAMPS.length); // no duplicate ids
    for (const id of expectedIds) expect(ids).toContain(id);

    for (const stamp of BUILTIN_STAMPS) {
      expect(() => decodeRLE(stamp.rle)).not.toThrow();
    }
  });

  it('decodes each stamp to its known correct population', () => {
    const populations: Record<string, number> = {
      block: 4,
      blinker: 3,
      glider: 5,
      toad: 6,
      beacon: 8,
      lwss: 9,
      'r-pentomino': 5,
      acorn: 7,
      pulsar: 48,
      'gosper-gun': 36,
    };
    for (const stamp of BUILTIN_STAMPS) {
      expect(decodeRLE(stamp.rle).cells).toHaveLength(populations[stamp.id]!);
    }
  });
});

describe('StampTool', () => {
  describe('library substitutability (data, not code)', () => {
    it('defaults to BUILTIN_STAMPS', () => {
      const stamp = new StampTool();
      expect(stamp.list()).toBe(BUILTIN_STAMPS);
    });

    it('a wholly different library (Phase 2\'s eventual full catalogue, in miniature) works identically with zero tool changes', () => {
      const customLibrary: readonly StampDefinition[] = [
        { id: 'dot', name: 'Single cell', rle: 'x = 1, y = 1\no!' },
      ];
      const stamp = new StampTool({ library: customLibrary });
      expect(stamp.list()).toBe(customLibrary);

      stamp.select('dot');
      stamp.onDown(ctxAt(5, 5));
      const ops = stamp.onUp(ctxAt(5, 5));
      expect(ops).toEqual([{ x: 5, y: 5, state: 1 }]);

      expect(() => stamp.select('glider')).toThrow(/no stamp registered/); // not in this library
    });
  });

  describe('selection and placement', () => {
    it('select() enters placement mode; the ghost previews at the last known anchor', () => {
      const stamp = new StampTool();
      stamp.select('block');
      expect(stamp.selectedId).toBe('block');
      expect(stamp.preview()).toEqual([
        { x: 0, y: 0, state: 1 },
        { x: 1, y: 0, state: 1 },
        { x: 0, y: 1, state: 1 },
        { x: 1, y: 1, state: 1 },
      ]);
    });

    it('select() with an unknown id throws a clear error', () => {
      const stamp = new StampTool();
      expect(() => stamp.select('not-a-real-stamp')).toThrow(RangeError);
    });

    it('deselect() clears the active stamp and any pending placement', () => {
      const stamp = new StampTool();
      stamp.select('block');
      stamp.onDown(ctxAt(0, 0));
      stamp.deselect();
      expect(stamp.selectedId).toBeNull();
      expect(stamp.preview()).toHaveLength(0);
    });

    it('placement is sparse: only the pattern\'s own live cells, dead gaps left untouched', () => {
      const stamp = new StampTool();
      stamp.select('glider'); // has dead corners within its 3x3 bounding box
      stamp.onDown(ctxAt(0, 0));
      const ops = stamp.onUp(ctxAt(0, 0));
      expect(ops).toHaveLength(5); // glider's population, not 9 (the full 3x3 box)
      expect(ops.every((o) => o.state !== DEAD)).toBe(true);
    });

    it('the ghost follows onMove before a click commits it', () => {
      const stamp = new StampTool();
      stamp.select('block');
      stamp.onMove(ctxAt(10, 10));
      expect(stamp.preview().every((o) => o.x >= 10 && o.y >= 10)).toBe(true);

      stamp.onDown(ctxAt(20, 20));
      expect(stamp.preview().every((o) => o.x >= 20 && o.y >= 20)).toBe(true);
    });

    it('paints with the tool\'s configured state, not a hardcoded 1', () => {
      const stamp = new StampTool({ state: 2 });
      stamp.select('blinker');
      stamp.onDown(ctxAt(0, 0));
      const ops = stamp.onUp(ctxAt(0, 0));
      expect(ops.every((o) => o.state === 2)).toBe(true);
    });

    it('onCancel discards the pending placement with no return value, without deselecting', () => {
      const stamp = new StampTool();
      stamp.select('block');
      stamp.onDown(ctxAt(0, 0));
      expect(stamp.onCancel()).toBeUndefined();
      expect(stamp.selectedId).toBe('block'); // still selected, just this placement discarded
    });
  });

  describe('rotate / flip', () => {
    it('rotate changes the ghost\'s shape (bounding box swaps for a non-square pattern)', () => {
      const stamp = new StampTool();
      stamp.select('lwss'); // 5 wide x 4 tall
      const before = stamp.preview();
      const beforeWidth = Math.max(...before.map((o) => o.x)) - Math.min(...before.map((o) => o.x));

      stamp.rotate();
      const after = stamp.preview();
      const afterHeight = Math.max(...after.map((o) => o.y)) - Math.min(...after.map((o) => o.y));

      expect(afterHeight).toBe(beforeWidth); // what was width is now height
    });

    it('flipping and rotating with nothing selected is a safe no-op', () => {
      const stamp = new StampTool();
      expect(() => {
        stamp.rotate();
        stamp.flipHorizontally();
        stamp.flipVertically();
      }).not.toThrow();
      expect(stamp.preview()).toHaveLength(0);
    });
  });

  describe('Shift-click places repeatedly', () => {
    it('a plain click places once and deselects', () => {
      const stamp = new StampTool();
      stamp.select('block');
      stamp.onDown(ctxAt(0, 0));
      stamp.onUp(ctxAt(0, 0));
      expect(stamp.selectedId).toBeNull();
      expect(stamp.preview()).toHaveLength(0);
    });

    it('a Shift-click places and keeps the same stamp selected for the next placement', () => {
      const stamp = new StampTool();
      stamp.select('block');
      stamp.onDown(ctxAt(0, 0));
      const first = stamp.onUp(ctxAt(0, 0, true)); // shift held
      expect(first.length).toBeGreaterThan(0);
      expect(stamp.selectedId).toBe('block');

      stamp.onDown(ctxAt(10, 10));
      const second = stamp.onUp(ctxAt(10, 10)); // no shift this time -> deselects after
      expect(second).toEqual([
        { x: 10, y: 10, state: 1 },
        { x: 11, y: 10, state: 1 },
        { x: 10, y: 11, state: 1 },
        { x: 11, y: 11, state: 1 },
      ]);
      expect(stamp.selectedId).toBeNull();
    });
  });

  describe('a placed Gosper gun immediately produces gliders when run (integration)', () => {
    it('emits a real glider (measured by population growing by exactly 5 per 30-tick period) and live cells escape the gun\'s footprint', () => {
      const stamp = new StampTool();
      stamp.select('gosper-gun');

      const ORIGIN = 50;
      stamp.onDown(ctxAt(ORIGIN, ORIGIN));
      const ops = stamp.onUp(ctxAt(ORIGIN, ORIGIN));
      expect(ops).toHaveLength(36);

      const sim = new Simulation({ ruleset: CONWAY, width: 200, height: 200, seed: 1 });
      sim.paint(ops);
      expect(sim.stats.population).toBe(36);

      const populationEveryPeriod: number[] = [];
      for (let period = 0; period < 5; period++) {
        for (let i = 0; i < 30; i++) sim.step();
        populationEveryPeriod.push(sim.stats.population);
      }
      // One glider (5 live cells) is added net every full 30-tick period once the gun settles.
      for (let i = 1; i < populationEveryPeriod.length; i++) {
        expect(populationEveryPeriod[i]! - populationEveryPeriod[i - 1]!).toBe(5);
      }

      // And concretely: live cells now exist well outside the gun's own 36x9 footprint —
      // an escaped glider, not just internal population churn.
      const bounds = sim.bounds();
      let foundOutsideFootprint = false;
      for (let x = bounds.x; x < bounds.x + bounds.width && !foundOutsideFootprint; x++) {
        for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
          const insideGun = x >= ORIGIN - 2 && x <= ORIGIN + 37 && y >= ORIGIN - 2 && y <= ORIGIN + 10;
          if (!insideGun && sim.get(x, y) !== DEAD) {
            foundOutsideFootprint = true;
            break;
          }
        }
      }
      expect(foundOutsideFootprint).toBe(true);
    });
  });
});
