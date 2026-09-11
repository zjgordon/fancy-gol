import { describe, expect, it } from 'vitest';
import { packCell } from '@engine/grid/coords';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { StatsCollector } from '@engine/stats/collector';
import { ZobristHasher, zobristCellKey } from '@engine/stats/zobrist';
import { DEAD, type ChangeSet, type GridView } from '@engine/types';

function bruteAbs(view: GridView): number {
  let h = 0;
  const bounds = view.bounds();
  if (bounds.width <= 0 || bounds.height <= 0) return 0;
  view.forEachChunkInRect(bounds, (chunk) => {
    if (chunk.population === 0) return;
    const ox = chunk.cx * 32;
    const oy = chunk.cy * 32;
    for (let i = 0; i < 1024; i++) {
      const st = chunk.at(i);
      if (st === DEAD) continue;
      h ^= zobristCellKey(ox + (i & 31), oy + (i >>> 5), st);
    }
  });
  return h >>> 0;
}

function cs(
  tick: number,
  cells: Array<readonly [x: number, y: number, from: number, to: number]>,
): ChangeSet {
  const n = cells.length;
  const coords = new Int32Array(n);
  const from = new Uint8Array(n);
  const to = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = cells[i]!;
    coords[i] = packCell(c[0], c[1]);
    from[i] = c[2];
    to[i] = c[3];
  }
  return { tick, coords, from, to, count: n, dirtyChunks: new Int32Array(0) };
}

describe('zobristCellKey', () => {
  it('is stable, non-zero, and distinguishes nearby cells and states', () => {
    const a = zobristCellKey(0, 0, 1);
    const b = zobristCellKey(0, 0, 1);
    expect(a).toBe(b);
    expect(a).not.toBe(0);
    expect(zobristCellKey(0, 0, 1)).not.toBe(zobristCellKey(1, 0, 1));
    expect(zobristCellKey(0, 0, 1)).not.toBe(zobristCellKey(0, 1, 1));
    expect(zobristCellKey(0, 0, 1)).not.toBe(zobristCellKey(0, 0, 2));
    expect(zobristCellKey(0, 0, 1)).not.toBe(zobristCellKey(4096, 0, 1));
    expect(zobristCellKey(-1, 0, 1)).not.toBe(zobristCellKey(0, 0, 1));
  });
});

describe('ZobristHasher', () => {
  it('empty field hashes to 0 and a birth XOR a death returns to 0', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 32,
      height: 32,
    });
    const hasher = new ZobristHasher();
    hasher.reset(sim.view(), { x: 0, y: 0, width: 0, height: 0 });
    expect(hasher.absHash).toBe(0);

    hasher.apply(cs(1, [[3, 4, 0, 1]]), {
      originX: 0,
      originY: 0,
      newOriginX: 3,
      newOriginY: 4,
    });
    expect(hasher.absHash).toBe(zobristCellKey(3, 4, 1));

    hasher.apply(cs(2, [[3, 4, 1, 0]]), {
      originX: 3,
      originY: 4,
      newOriginX: 0,
      newOriginY: 0,
    });
    expect(hasher.absHash).toBe(0);
  });

  it('incremental abs hash matches a brute XOR of live cells after random applies', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'toroidal' },
      width: 48,
      height: 48,
      seed: 0xc0ffee,
    });
    sim.seedRandom(0.37, 0xc0ffee);
    const collector = new StatsCollector();
    collector.reset(sim.view(), 0);
    expect(collector.hasher.absHash).toBe(bruteAbs(sim.view()));
    expect(collector.sample().hash).toBe(collector.hasher.absHash);

    for (let i = 0; i < 40; i++) {
      collector.apply(sim.step(), sim.view());
      expect(collector.hasher.absHash, `tick ${sim.tick}`).toBe(bruteAbs(sim.view()));
    }
  });

  it('two hashers do not share running hashes', () => {
    const simA = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 16,
      height: 16,
    });
    const simB = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 16,
      height: 16,
    });
    simA.set(1, 1, 1);
    simB.set(4, 4, 1);
    const a = new ZobristHasher();
    const b = new ZobristHasher();
    a.reset(simA.view(), { x: 1, y: 1, width: 1, height: 1 });
    b.reset(simB.view(), { x: 4, y: 4, width: 1, height: 1 });
    const frozen = b.absHash;
    expect(a.absHash).not.toBe(b.absHash);

    a.apply(cs(1, [[2, 1, 0, 1]]), {
      originX: 1,
      originY: 1,
      newOriginX: 1,
      newOriginY: 1,
    });
    expect(b.absHash).toBe(frozen);
    expect(a.absHash).not.toBe(frozen);
  });

  it('recomputeWindow on an empty field is 0', () => {
    const sim = new Simulation({
      ruleset: { ...CONWAY, boundary: 'bounded' },
      width: 16,
      height: 16,
    });
    const hasher = new ZobristHasher();
    hasher.reset(sim.view(), { x: 0, y: 0, width: 0, height: 0 });
    hasher.recomputeWindow(sim.view());
    expect(hasher.windowHash).toBe(0);
    expect(hasher.windowPop).toBe(0);
  });
});
