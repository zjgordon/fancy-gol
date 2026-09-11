/**
 * Pattern identity (P2-A-4). Translate live cells to the origin, then pick the
 * lexicographically smallest of the eight dihedral images (D₄: four rotations, and those
 * four of the horizontally flipped copy). The catalogue stores {@link canonicalHash} of
 * that form so "you just drew a loaf" and duplicate detection share one number.
 *
 * Engine-pure: no DOM, no I/O. The uniqueness gate over `patterns/` lives in the unit test
 * (and will be the same function P2-B-1's index builder calls).
 */
import type { RleCell } from '../../shared/rle.js';

export interface PatternCells {
  readonly cells: readonly RleCell[];
}

export interface CanonicalPattern {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly RleCell[];
}

interface Oriented {
  width: number;
  height: number;
  cells: RleCell[];
}

function translate(cells: readonly RleCell[]): Oriented {
  if (cells.length === 0) return { width: 0, height: 0, cells: [] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    if (c.state === 0) continue;
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  if (!Number.isFinite(minX)) return { width: 0, height: 0, cells: [] };
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    cells: cells
      .filter((c) => c.state !== 0)
      .map((c) => ({ x: c.x - minX, y: c.y - minY, state: c.state })),
  };
}

function rotate90(p: Oriented): Oriented {
  const { width, height, cells } = p;
  return {
    width: height,
    height: width,
    cells: cells.map((c) => ({ x: height - 1 - c.y, y: c.x, state: c.state })),
  };
}

function flipHorizontal(p: Oriented): Oriented {
  return {
    width: p.width,
    height: p.height,
    cells: p.cells.map((c) => ({ x: p.width - 1 - c.x, y: c.y, state: c.state })),
  };
}

function rotations(p: Oriented): Oriented[] {
  const r90 = rotate90(p);
  const r180 = rotate90(r90);
  const r270 = rotate90(r180);
  return [p, r90, r180, r270];
}

function serialize(p: { readonly width: number; readonly height: number; readonly cells: readonly RleCell[] }): string {
  const dense = new Uint8Array(p.width * p.height);
  for (const c of p.cells) dense[c.y * p.width + c.x] = c.state;
  return `${p.width}x${p.height}:${dense.join(',')}`;
}

/** The eight D₄ images, each translated to the origin. */
export function dihedralImages(input: PatternCells): CanonicalPattern[] {
  const base = translate(input.cells);
  const flipped = flipHorizontal(base);
  return [...rotations(base), ...rotations(flipped)].map((p) => ({
    width: p.width,
    height: p.height,
    cells: p.cells,
  }));
}

/** Origin-translated, lexicographically smallest dihedral image. */
export function canonicalize(input: PatternCells): CanonicalPattern {
  const images = dihedralImages(input);
  let best = images[0]!;
  let bestKey = serialize(best);
  for (let i = 1; i < images.length; i++) {
    const key = serialize(images[i]!);
    if (key < bestKey) {
      best = images[i]!;
      bestKey = key;
    }
  }
  return best;
}

/** Stable hex identity of {@link canonicalize}. FNV-1a 64-bit, no crypto. */
export function canonicalHash(input: PatternCells): string {
  return fnv1a64(serialize(canonicalize(input)));
}

export interface CatalogueEntry {
  readonly name: string;
  readonly cells: readonly RleCell[];
}

export interface CanonicalCollision {
  readonly hash: string;
  readonly names: readonly string[];
}

/**
 * Entries that share a canonical hash but not a name — the catalogue must not contain these.
 * Same name, same hash (two files of "Glider") is allowed.
 */
export function findCanonicalCollisions(entries: readonly CatalogueEntry[]): CanonicalCollision[] {
  const byHash = new Map<string, Set<string>>();
  for (const entry of entries) {
    const hash = canonicalHash(entry);
    let names = byHash.get(hash);
    if (!names) {
      names = new Set();
      byHash.set(hash, names);
    }
    names.add(entry.name);
  }
  const collisions: CanonicalCollision[] = [];
  for (const [hash, names] of byHash) {
    if (names.size > 1) collisions.push({ hash, names: [...names].sort() });
  }
  return collisions;
}

function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}
