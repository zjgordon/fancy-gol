import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import type { RuleSet } from '@engine/types';

function stamp(sim: Simulation, cells: Array<readonly [number, number]>, ox = 0, oy = 0): void {
  for (const [x, y] of cells) sim.set(ox + x, oy + y, 1);
}

function cellsOf(pattern: string[]): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  pattern.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === 'O') out.push([x, y]);
    });
  });
  return out;
}

const GLIDER = cellsOf(['.O.', '..O', 'OOO']);

function liveInRect(
  sim: Simulation,
  x0: number,
  y0: number,
  width: number,
  height: number,
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      if (sim.get(x, y) !== 0) out.push([x, y]);
    }
  }
  return out;
}

function packed(cells: Array<readonly [number, number]>): string[] {
  return cells.map(([x, y]) => `${x},${y}`).sort();
}

describe('P0-E-2 boundary modes', () => {
  it.each([
    // Wall sits inside the 32×32 page — the halo memcpy would miss this.
    { size: 24, start: 8 },
    // Wall sits on the chunk seam — the fast neighbour-page path.
    { size: 32, start: 12 },
  ] as const)(
    'bounded $size×$size: a glider aimed at a wall dies there and never wraps',
    ({ size, start }) => {
      const rs: RuleSet = { ...CONWAY, boundary: 'bounded' };
      const sim = new Simulation({ ruleset: rs, width: size, height: size });
      stamp(sim, GLIDER, start, start);

      let sawFarSide = false;
      const farSide = () =>
        liveInRect(sim, 0, 0, 4, size).length > 0 || liveInRect(sim, 0, 0, size, 4).length > 0;

      for (let i = 0; i < 8; i++) sim.step();
      expect(sim.stats.population).toBe(5); // still a glider, inland
      expect(farSide()).toBe(false);

      for (let i = 0; i < 100; i++) {
        sim.step();
        if (farSide()) sawFarSide = true;
      }

      expect(sawFarSide).toBe(false);
      // Conway physics: a SE glider crashing into a dead wall settles into a
      // 2×2 block *on that wall*. The spaceship is gone; it did not wrap.
      const leftover = liveInRect(sim, 0, 0, size, size);
      expect(leftover).toHaveLength(4);
      for (const [x, y] of leftover) {
        expect(x).toBeGreaterThanOrEqual(size - 4);
        expect(y).toBeGreaterThanOrEqual(size - 4);
      }
      const before = packed(leftover);
      sim.step();
      sim.step();
      expect(packed(liveInRect(sim, 0, 0, size, size))).toEqual(before);
    },
  );

  it('toroidal: a glider on a 32×32 torus returns to its exact starting cells at generation 128', () => {
    const rs: RuleSet = { ...CONWAY, boundary: 'toroidal' };
    const sim = new Simulation({ ruleset: rs, width: 32, height: 32 });
    stamp(sim, GLIDER, 0, 0);
    const start = packed(liveInRect(sim, 0, 0, 32, 32));
    expect(start).toEqual(packed(GLIDER));

    for (let i = 0; i < 128; i++) {
      sim.step();
      expect(sim.stats.population).toBe(5);
    }

    expect(sim.tick).toBe(128);
    expect(packed(liveInRect(sim, 0, 0, 32, 32))).toEqual(start);
  });

  it('toroidal: wrap is at the world edge, even when that edge is inside a chunk', () => {
    const rs: RuleSet = { ...CONWAY, boundary: 'toroidal' };
    const sim = new Simulation({ ruleset: rs, width: 16, height: 16 });
    stamp(sim, GLIDER, 0, 0);
    const start = packed(liveInRect(sim, 0, 0, 16, 16));

    for (let i = 0; i < 64; i++) sim.step(); // 16 cells × period 4

    expect(packed(liveInRect(sim, 0, 0, 16, 16))).toEqual(start);
    expect(sim.stats.population).toBe(5);
  });

  it(
    'infinite: a glider run 10,000 generations lands on the translated coordinate without a trailing chunk tax',
    { timeout: 30_000 },
    () => {
      const sim = new Simulation({ ruleset: { ...CONWAY, boundary: 'infinite' } });
      stamp(sim, GLIDER, 0, 0);

      const WINDOW = 400;
      for (let i = 0; i < 100; i++) sim.step();
      const t0 = performance.now();
      for (let i = 0; i < WINDOW; i++) sim.step();
      const earlyMs = performance.now() - t0;

      while (sim.tick < 10_000 - WINDOW) sim.step();
      const t1 = performance.now();
      for (let i = 0; i < WINDOW; i++) sim.step();
      const lateMs = performance.now() - t1;

      expect(sim.tick).toBe(10_000);
      expect(sim.stats.population).toBe(5);

      const shift = 10_000 / 4; // one cell diagonally per period
      expect(packed(liveInRect(sim, shift, shift, 4, 4))).toEqual(
        packed(GLIDER.map(([x, y]) => [x + shift, y + shift])),
      );

      // Reclamation: a glider occupies at most a 2×2 chunk neighbourhood, not a
      // 2,500-cell trail of empty pages behind it.
      const box = sim.bounds();
      expect(box.width).toBeLessThanOrEqual(64);
      expect(box.height).toBeLessThanOrEqual(64);
      expect(box.x).toBeGreaterThan(shift - 64);

      expect(lateMs).toBeLessThanOrEqual(earlyMs * 1.2);
    },
  );
});
