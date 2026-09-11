import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalHash,
  canonicalize,
  dihedralImages,
  findCanonicalCollisions,
  type PatternCells,
} from '@engine/patterns/normalize';
import { decode } from '@shared/rle';
import type { RleCell } from '@shared/rle';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGUE = join(HERE, '../../../../patterns');

/** L-tetromino — chiral enough that all 8 D₄ images are distinct grids. */
const L: readonly RleCell[] = [
  { x: 0, y: 0, state: 1 },
  { x: 0, y: 1, state: 1 },
  { x: 0, y: 2, state: 1 },
  { x: 1, y: 2, state: 1 },
];

function rot90(cells: readonly RleCell[], height: number): RleCell[] {
  return cells.map((c) => ({ x: height - 1 - c.y, y: c.x, state: c.state }));
}

function flipH(cells: readonly RleCell[], width: number): RleCell[] {
  return cells.map((c) => ({ x: width - 1 - c.x, y: c.y, state: c.state }));
}

function shift(cells: readonly RleCell[], dx: number, dy: number): RleCell[] {
  return cells.map((c) => ({ x: c.x + dx, y: c.y + dy, state: c.state }));
}

/** Independently enumerate D₄ — not a reuse of normalize.ts's own generators. */
function eightOrientations(cells: readonly RleCell[], width: number, height: number): PatternCells[] {
  const out: PatternCells[] = [];
  let w = width;
  let h = height;
  let cur = [...cells];
  for (let r = 0; r < 4; r++) {
    out.push({ cells: cur });
    cur = rot90(cur, h);
    const nw = h;
    const nh = w;
    w = nw;
    h = nh;
  }
  w = width;
  h = height;
  cur = flipH(cells, width);
  for (let r = 0; r < 4; r++) {
    out.push({ cells: cur });
    cur = rot90(cur, h);
    const nw = h;
    const nh = w;
    w = nw;
    h = nh;
  }
  return out;
}

describe('pattern identity (P2-A-4)', () => {
  it('all 8 orientations of an asymmetric pattern share one canonical hash', () => {
    const hashes = eightOrientations(L, 2, 3).map((p) => canonicalHash(p));
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is invariant under translation, including negative offsets', () => {
    const base = canonicalHash({ cells: L });
    expect(canonicalHash({ cells: shift(L, 12, -7) })).toBe(base);
    expect(canonicalHash({ cells: shift(L, -3, 40) })).toBe(base);
  });

  it('keeps multi-state cells distinct from a two-state twin', () => {
    const two = canonicalHash({ cells: L });
    const multi = canonicalHash({
      cells: L.map((c, i) => (i === 0 ? { ...c, state: 3 } : c)),
    });
    expect(multi).not.toBe(two);
    const flippedMulti = canonicalHash({
      cells: flipH(
        L.map((c, i) => (i === 0 ? { ...c, state: 3 } : c)),
        2,
      ),
    });
    expect(flippedMulti).toBe(multi);
  });

  it('gives a block and a glider different hashes', () => {
    const block = decode(readFileSync(join(CATALOGUE, 'block.rle'), 'utf8'));
    const glider = decode(readFileSync(join(CATALOGUE, 'glider.rle'), 'utf8'));
    expect(canonicalHash(block)).not.toBe(canonicalHash(glider));
  });

  it('canonicalize is one of the eight origin-translated images', () => {
    const canon = canonicalize({ cells: L });
    const keys = new Set(
      dihedralImages({ cells: L }).map((p) => `${p.width}x${p.height}:${p.cells.map((c) => `${c.x},${c.y},${c.state}`).sort().join(';')}`),
    );
    const got = `${canon.width}x${canon.height}:${canon.cells.map((c) => `${c.x},${c.y},${c.state}`).sort().join(';')}`;
    expect(keys.has(got)).toBe(true);
  });

  it('the catalogue contains no two entries with the same canonical hash and different names', () => {
    const files = readdirSync(CATALOGUE).filter((f) => f.endsWith('.rle'));
    expect(files.length).toBeGreaterThan(0);
    const entries = files.map((file) => {
      const pattern = decode(readFileSync(join(CATALOGUE, file), 'utf8'));
      return { name: pattern.name ?? file, cells: pattern.cells };
    });
    expect(findCanonicalCollisions(entries)).toEqual([]);
  });

  it('reports a collision when two different names share an orientation', () => {
    const collisions = findCanonicalCollisions([
      { name: 'L', cells: L },
      { name: 'L-mirror', cells: flipH(L, 2) },
      { name: 'Block', cells: [{ x: 0, y: 0, state: 1 }, { x: 1, y: 0, state: 1 }, { x: 0, y: 1, state: 1 }, { x: 1, y: 1, state: 1 }] },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.names).toEqual(['L', 'L-mirror']);
  });

  it('hashes the empty pattern stably', () => {
    expect(canonicalHash({ cells: [] })).toBe(canonicalHash({ cells: [{ x: 4, y: 1, state: 0 }] }));
  });
});
